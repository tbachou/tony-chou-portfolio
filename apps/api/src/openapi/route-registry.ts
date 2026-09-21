/**
 * Every route `apps/api` serves, as spec 0016 describes it.
 *
 * This file lives in `src/` and not `scripts/` for one mechanical reason:
 * the runner's root is `src`, so a spec file beside `scripts/` would never be
 * collected. Four eval and retrieval files sit in `src/` for the same reason
 * (see `apps/api/AGENTS.md`). The thin wrappers stay in `scripts/`.
 *
 * What is hand written here and what is not:
 *
 * - Request bodies and path parameters are NEVER written here. A row names a
 *   zod export and the generator derives the schema, so what is published is
 *   what `ZodValidationPipe` enforces, `.strict()` and all.
 * - Method, path, auth, responses and prose ARE written here, because nothing
 *   can derive them. `controller-scan.ts` compares the first three against the
 *   controllers on every run of `check:openapi`, so they cannot drift quietly.
 *   Responses are unguarded: they can drift from the service return types, and
 *   spec 0016 records that as an accepted cost.
 *
 * Success statuses are Nest's defaults, which is why every POST here answers
 * 201 except the two SSE routes, which set 200 on the response themselves. No
 * handler carries `@HttpCode`.
 *
 * No numeric rate limit or window appears in this file. The limits are real
 * and they move; the document describes the shape of the limiting instead, and
 * `document.ts` holds that prose.
 */
import {
  betaPlanRequestSchema,
  conversationTurnRequestSchema,
  createFeedbackSchema,
  createGradePhotoSchema,
  gradeGuessRequestSchema,
  gradePhotoIdParamSchema,
  gradeProblemIdParamSchema,
  setPhotoActiveSchema,
} from '@portfolio/shared';
import type { JsonSchema, ResponseSpec, RouteEntry } from './types.js';

const JSON_TYPE = 'application/json';
const SSE_TYPE = 'text/event-stream';

/** Shorthand for a required object with no extra properties, matching `.strict()`. */
function object(
  properties: Record<string, JsonSchema>,
  optional: string[] = [],
): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties).filter((k) => !optional.includes(k)),
    additionalProperties: false,
  };
}

const STRING: JsonSchema = { type: 'string' };
const INTEGER: JsonSchema = { type: 'integer' };
const BOOLEAN: JsonSchema = { type: 'boolean' };

/**
 * The union of a schema and null.
 *
 * The plain `type: [x, 'null']` form only works for a schema whose `type` is a
 * single string. Spreading it over a `$ref` or a `oneOf` produced
 * `type: [undefined, 'null']`, which serialises to `[null, "null"]` and is not
 * valid JSON Schema, in a file nothing validates. `anyOf` is correct for the
 * rest, so each shape gets the form that holds.
 */
function nullable(schema: JsonSchema): JsonSchema {
  if (typeof schema.type === 'string') return { ...schema, type: [schema.type, 'null'] };
  return { anyOf: [schema, { type: 'null' }] };
}

function array(items: JsonSchema): JsonSchema {
  return { type: 'array', items };
}

// --- Responses reused across routes -----------------------------------------

/**
 * The 400 every validating route shares. `ZodValidationPipe` throws Nest's
 * `BadRequestException` with an array of messages, one per failed zod issue,
 * so `message` is a list here and a bare string on every other error.
 */
const VALIDATION_ERROR: ResponseSpec = {
  status: 400,
  description:
    'The request body or path parameter did not match the schema. `message` lists one entry per failed field, including an unknown property, which every contract rejects rather than dropping.',
  contentType: JSON_TYPE,
  schema: { $ref: '#/components/schemas/ValidationError' },
};

function error(status: number, description: string): ResponseSpec {
  return {
    status,
    description,
    contentType: JSON_TYPE,
    schema: { $ref: '#/components/schemas/Error' },
  };
}

const UNAUTHORIZED = error(
  401,
  'No valid better-auth session cookie was sent, or it has expired.',
);

const THROTTLED = error(
  429,
  'A rate limit was exceeded. See **Rate limiting** in the document description for which limit applies.',
);

// --- Response body shapes, read off the service return types ------------------

const STORY = object({
  id: STRING,
  title: STRING,
  ownership: { type: 'string', enum: ['solo', 'contributed', 'co-led'] },
  engagement: STRING,
  summary: STRING,
});

const TOPIC = object({ id: STRING, slug: STRING, label: STRING, description: STRING });

const GRADE_PHOTO_ITEM = object(
  {
    id: STRING,
    trueGrade: INTEGER,
    source: STRING,
    sourceNote: nullable(STRING),
    note: nullable(STRING),
    active: BOOLEAN,
    createdAt: { type: 'string', format: 'date-time' },
    imageUrl: {
      type: 'string',
      description: 'A presigned object URL, valid for a limited window.',
    },
  },
  [],
);

const GRADE_MODEL_ANALYSIS = object({
  grade: INTEGER,
  confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  observations: array(STRING),
  reasoning: STRING,
});

const GRADE_REVEAL = object(
  {
    publicId: {
      ...STRING,
      description: 'Echoed back so a client can match a reveal to the problem it holds.',
    },
    trueGrade: INTEGER,
    model: {
      oneOf: [GRADE_MODEL_ANALYSIS, { type: 'null' }],
      description: 'Null while this problem’s vision call has not landed yet.',
    },
    guessCounts: array(INTEGER),
    plays: INTEGER,
    yourGuess: INTEGER,
    yourDistance: INTEGER,
    modelDistance: { ...nullable(INTEGER), description: 'Null whenever `model` is.' },
    note: STRING,
  },
  ['note'],
);

const USAGE_SUMMARY = object({
  dailyTotals: array(
    object({ date: { type: 'string', format: 'date' }, turnCount: INTEGER, tokenCount: INTEGER }),
  ),
  topSources: array(object({ hashedIp: STRING, tokenCount: INTEGER })),
});

// --- The registry -------------------------------------------------------------

export const ROUTES: RouteEntry[] = [
  {
    method: 'get',
    path: '/',
    anonymous: true,
    summary: 'Service greeting',
    description:
      'A plain text liveness greeting from the Nest root controller. Carries no state and is not the health check.',
    responses: [
      { status: 200, description: 'A greeting.', contentType: 'text/plain', schema: STRING },
    ],
  },
  {
    method: 'get',
    path: '/health',
    anonymous: true,
    summary: 'Health check',
    description: 'Answers as soon as the process is serving. It does not reach the database.',
    responses: [
      {
        status: 200,
        description: 'The service is up.',
        contentType: JSON_TYPE,
        schema: object({ status: { type: 'string', enum: ['ok'] } }),
      },
    ],
  },
  {
    method: 'get',
    path: '/stories',
    anonymous: true,
    summary: 'List the curated stories',
    description:
      'The verified work stories the interview simulator is grounded in. `ownership` is what the honesty guard enforces: a story marked `contributed` or `co-led` may not be claimed solo.',
    responses: [
      { status: 200, description: 'Every story.', contentType: JSON_TYPE, schema: array(STORY) },
    ],
  },
  {
    method: 'get',
    path: '/topics',
    anonymous: true,
    summary: 'List the interview topics',
    description: 'The topics a visitor can start a conversation on. `id` is what `POST /conversation/turn` takes.',
    responses: [
      { status: 200, description: 'Every topic.', contentType: JSON_TYPE, schema: array(TOPIC) },
    ],
  },
  {
    method: 'get',
    path: '/beta/status',
    anonymous: true,
    summary: 'Whether Beta can take a plan right now',
    description:
      'Lets a client show the daily cap before a visitor fills the form. `reason` is `daily_cap` when the shared budget for the day is spent.',
    responses: [
      {
        status: 200,
        description: 'Current availability.',
        contentType: JSON_TYPE,
        schema: object({
          available: BOOLEAN,
          reason: { type: 'string', enum: ['ok', 'daily_cap'] },
        }),
      },
      THROTTLED,
    ],
  },
  {
    method: 'post',
    path: '/beta/plan',
    anonymous: true,
    summary: 'Generate a return to climbing plan (streaming)',
    description: [
      'Runs a three agent pipeline, screener then drafter then coach, and streams the result as Server Sent Events.',
      '',
      'Beta is an educational demo. It is not medical advice, a diagnosis, or physical therapy. It screens for warning signs but does not ask about age, pregnancy, medication, surgery or other conditions, and the web app gates the form behind a fuller caveat that a direct caller of this route never sees.',
      '',
      'Every failure that can be known before the stream opens arrives as a plain HTTP error, including the rate limits and the daily budget. Once the stream is open the status is already 200, so later failures arrive as an `error` event instead.',
      '',
      'Nothing a visitor types here is stored or logged. The service keeps anonymous counters only.',
      '',
      '**Event sequence**',
      '',
      '| Event | Data | When |',
      '|---|---|---|',
      '| `status` | `{ stage: "screening" \\| "drafting" \\| "coaching" }` | Each time the pipeline enters a stage. |',
      '| `red_flag` | `{ category: string \\| null, message: string }` | A red flag was found: a checked warning sign, a pain pattern treated the same way, or the screener\u2019s own judgment. The pipeline stops; no plan follows. |',
      '| `plan_delta` | `{ text: string }` | A chunk of plan text. Append it to what you already hold. |',
      '| `plan_replace` | `{}` | Discard the text so far: the coach is rewriting the plan from the start. |',
      '| `error` | `{ message: string }` | The pipeline stopped after the stream opened. No `done` follows. |',
      '| `done` | `{}` | The plan is complete. The stream then closes. |',
    ].join('\n'),
    requestSchema: betaPlanRequestSchema,
    responses: [
      {
        status: 200,
        description:
          'The stream opened. Events follow in the sequence above; a plan that fails mid stream still answers 200 and reports the failure as an `error` event.',
        contentType: SSE_TYPE,
      },
      VALIDATION_ERROR,
      THROTTLED,
      error(
        500,
        'The service is not configured to reach the model provider. Raised before the stream opens.',
      ),
      error(
        503,
        'The shared daily budget for plans is spent. It resets the next day.',
      ),
    ],
  },
  {
    method: 'post',
    path: '/conversation/turn',
    anonymous: true,
    summary: 'Generate the next interview turn pair (streaming)',
    description: [
      'Generates one turn pair, an interviewer question and an answer in Tony’s voice, and streams both as Server Sent Events. Every generated answer passes the ownership guard before a single token reaches the visitor.',
      '',
      'Omit `conversationId` to start a conversation; the first `turn_end` carries the id to send back on the next call. The transcript is rebuilt from persisted rows and is never echoed by the client.',
      '',
      'No visitor text is stored. The service persists anonymous counters and a hashed address only.',
      '',
      '**Event sequence**',
      '',
      '| Event | Data | When |',
      '|---|---|---|',
      '| `turn_start` | `{ role: "interviewer" \\| "tony" }` | A speaker begins. Sent twice per turn pair. |',
      '| `token` | `{ text: string }` | A chunk of the current speaker’s text. |',
      '| `turn_end` | `{ conversationId: string, turnIndex: number, isFinal: boolean }` | The pair is complete. `isFinal` marks the last turn of the conversation. |',
      '| `turn_error` | `{ message: string }` | Generation failed after the stream opened. No `turn_end` follows. |',
    ].join('\n'),
    requestSchema: conversationTurnRequestSchema,
    responses: [
      {
        status: 200,
        description:
          'The stream opened. Events follow in the sequence above; a turn that fails mid stream still answers 200 and reports the failure as a `turn_error` event.',
        contentType: SSE_TYPE,
      },
      VALIDATION_ERROR,
      THROTTLED,
      error(
        500,
        'The topic has no mapped stories, or the service is not configured to reach the model provider. Raised before the stream opens.',
      ),
    ],
  },
  {
    method: 'post',
    path: '/feedback',
    anonymous: true,
    summary: 'Submit feedback',
    description:
      'Accepts a short message from a visitor. This is the one place the service stores visitor typed text on purpose; it is stored and forwarded for classification, and it is never written to a log.',
    requestSchema: createFeedbackSchema,
    responses: [
      {
        status: 201,
        description: 'Accepted.',
        contentType: JSON_TYPE,
        schema: object({ id: STRING }),
      },
      VALIDATION_ERROR,
      THROTTLED,
    ],
  },
  {
    method: 'get',
    path: '/grade/problems',
    anonymous: true,
    summary: 'List today’s problem ids',
    description:
      'Public ids only, in play order. Images are minted one at a time by the route below rather than all at once.',
    conditionalOn: 'GRADE_GAME_ENABLED',
    responses: [
      {
        status: 200,
        description: 'The ordered problem ids and how many there are.',
        contentType: JSON_TYPE,
        schema: object({ problems: array(object({ publicId: STRING })), count: INTEGER }),
      },
      THROTTLED,
    ],
  },
  {
    method: 'get',
    path: '/grade/problems/{publicId}/image',
    anonymous: true,
    summary: 'Get a problem’s image URL',
    description:
      'Mints a presigned object URL at the moment the problem is shown. A problem that is not licensed for display answers 404 rather than 403, so an excluded photo is indistinguishable from one that does not exist.',
    conditionalOn: 'GRADE_GAME_ENABLED',
    paramSchema: gradeProblemIdParamSchema,
    responses: [
      {
        status: 200,
        description: 'A presigned URL for the image.',
        contentType: JSON_TYPE,
        schema: object({ imageUrl: STRING }),
      },
      VALIDATION_ERROR,
      error(404, 'No such problem, or the problem is not licensed for display.'),
      error(410, 'The problem exists but is no longer active.'),
      THROTTLED,
    ],
  },
  {
    method: 'post',
    path: '/grade/guess',
    anonymous: true,
    summary: 'Submit a guess and get the reveal',
    description:
      'Records the guess and answers with the true grade, the histogram of every guess so far, and the model’s own attempt when it has landed.',
    conditionalOn: 'GRADE_GAME_ENABLED',
    requestSchema: gradeGuessRequestSchema,
    responses: [
      {
        status: 201,
        description: 'The reveal for this problem.',
        contentType: JSON_TYPE,
        schema: GRADE_REVEAL,
      },
      VALIDATION_ERROR,
      error(404, 'No such problem, or the problem is not licensed for display.'),
      THROTTLED,
      error(503, 'The problem’s stats row could not be read back. Retry.'),
    ],
  },
  {
    method: 'get',
    path: '/internal/usage/summary',
    anonymous: false,
    summary: 'Usage totals for the admin dashboard',
    description:
      'A rolling window of daily turn and token totals, plus the heaviest sources by hashed address. Addresses are hashed at the boundary and never stored raw.',
    responses: [
      {
        status: 200,
        description: 'The usage summary.',
        contentType: JSON_TYPE,
        schema: USAGE_SUMMARY,
      },
      UNAUTHORIZED,
    ],
  },
  {
    method: 'get',
    path: '/internal/grade-photos',
    anonymous: false,
    summary: 'List the Grade Guesser photo pool',
    description:
      'Every photo in the pool, active or not, each with a presigned URL the browser can load. Registered whatever `GRADE_GAME_ENABLED` is set to, so the pool can be curated while the game is off.',
    responses: [
      {
        status: 200,
        description: 'The whole pool.',
        contentType: JSON_TYPE,
        schema: array(GRADE_PHOTO_ITEM),
      },
      UNAUTHORIZED,
    ],
  },
  {
    method: 'post',
    path: '/internal/grade-photos',
    anonymous: false,
    summary: 'Add a photo to the pool',
    description:
      'A multipart upload: the fields below plus the image itself. The image is re-encoded before it is stored.',
    requestSchema: createGradePhotoSchema,
    requestContentType: 'multipart/form-data',
    multipartFile: {
      name: 'file',
      description:
        'The image. Required. Rejected with 413 above the size limit and 415 when it cannot be decoded as an image.',
    },
    fieldNotes: {
      trueGrade:
        'Arrives as a string over multipart and is coerced to an integer. The generated schema says `integer`, which is what the field becomes, not what the wire carries.',
    },
    responses: [
      {
        status: 201,
        description: 'The stored photo.',
        contentType: JSON_TYPE,
        schema: GRADE_PHOTO_ITEM,
      },
      VALIDATION_ERROR,
      UNAUTHORIZED,
      error(409, 'A photo with this id is already in the pool.'),
      error(413, 'The image is larger than the upload limit.'),
      error(415, 'The upload could not be decoded as an image.'),
    ],
  },
  {
    method: 'patch',
    path: '/internal/grade-photos/{id}/active',
    anonymous: false,
    summary: 'Activate or retire a photo',
    description:
      'Toggles whether a photo can be served to players. Retiring one does not delete it.',
    paramSchema: gradePhotoIdParamSchema,
    requestSchema: setPhotoActiveSchema,
    fieldNotes: {
      active:
        'Accepts the strings `"true"` and `"false"` as well as a real boolean, because the admin form sends a string. The generated schema says `boolean`, which is what the field becomes.',
    },
    responses: [
      {
        status: 200,
        description: 'The updated photo.',
        contentType: JSON_TYPE,
        schema: GRADE_PHOTO_ITEM,
      },
      VALIDATION_ERROR,
      UNAUTHORIZED,
      error(404, 'No photo with this id.'),
    ],
  },
];
