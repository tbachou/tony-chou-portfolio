/**
 * Builds the OpenAPI 3.1 document from the route registry (spec 0016).
 *
 * Both committed artifacts come from the single object this returns, so the
 * JSON and the Markdown cannot describe different surfaces.
 *
 * Determinism matters: `check:openapi` compares a fresh build against the
 * committed bytes, so everything here must be a pure function of the tree.
 * No clock, no environment, no iteration over an unordered set.
 *
 * There is deliberately no `servers` block. The api origin appears nowhere in
 * this repository and publishing it here would be the first time.
 */
import { toJSONSchema } from 'zod';
import type { ZodType } from 'zod';
import { ROUTES } from './route-registry.js';
import type { JsonSchema, RouteEntry } from './types.js';

/**
 * Bumped by hand. It is not read from `apps/api/package.json`, which still
 * carries the Nest scaffold's `0.0.1` and is not maintained.
 */
export const DOCUMENT_VERSION = '1.0.0';

export const DOCUMENT_TITLE = 'Tony Chou portfolio API';

const DOCUMENT_DESCRIPTION = [
  'The HTTP surface of `apps/api`, the NestJS service behind the portfolio’s AI features: the interview simulator, Beta the return to climbing planner, and Grade Guesser.',
  '',
  'This document is generated from the zod schemas that actually validate each request (`packages/shared/contracts.ts`) plus a route registry, and a CI check fails the build when either artifact stops matching the code. Run `npm run build:openapi --workspace=apps/api` to regenerate it.',
  '',
  '**What is described here.** Request bodies and path parameters are generated, so they are exactly what the service enforces, including the refusal of unknown properties. Responses are hand written from the service return types and are not machine checked, so treat them as documentation rather than as a contract.',
  '',
  '**Authentication.** Eleven routes are anonymous. The four under `/internal` require a better-auth session cookie and are the admin surface. Sign up is permanently closed; the single admin account is seeded directly.',
  '',
  '**Rate limiting.** A route that documents a `429` response is rate limited; a route that does not is not. There is no global limiter, so the static reads carry no limit of their own. Where a limit applies it is keyed per client on an address identity that collapses an IPv6 allocation to its /64 prefix, so rotating within one cannot buy more requests, and it comes in two layers: an in memory window that resets on deploy, and, for the routes that spend money on a model call, a persisted daily cap that does not. Exceeding a window answers 429; exhausting the shared daily budget for plans answers 503. The numbers are deliberately not copied here, because they move and a stale limit in a public document is worse than none. `check:openapi` compares each route\u2019s 429 against the code, so this paragraph cannot drift from it.',
  '',
  '**Not described here.** better-auth mounts its own sign in and session handlers, which are not Nest controller routes and so are outside both the registry and the check that guards it. `apps/web` also serves its own route handlers on the web origin; those are a separate surface and this document leaves them out on purpose.',
  '',
  '**No `servers` block.** The api origin is not published in this repository.',
].join('\n');

/** better-auth's default session cookie. Nothing here overrides the name. */
const SESSION_SCHEME = 'sessionCookie';

type OpenApiDocument = {
  openapi: string;
  jsonSchemaDialect: string;
  info: Record<string, unknown>;
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
};

const TAGS: { name: string; description: string }[] = [
  { name: 'service', description: 'Liveness and greeting.' },
  { name: 'content', description: 'The curated stories and interview topics.' },
  { name: 'conversation', description: 'The interview simulator.' },
  { name: 'beta', description: 'Beta, the return to climbing planner.' },
  { name: 'grade', description: 'Grade Guesser, the daily climbing grade game.' },
  { name: 'feedback', description: 'Visitor feedback.' },
  { name: 'internal', description: 'The admin surface, behind a better-auth session.' },
];

/**
 * Derived from the path, so the registry carries no presentation field.
 *
 * It throws on a prefix it does not know rather than falling through to a
 * default. The old fall through was `internal`, so any new route would have
 * been published under a heading reading "The admin surface, behind a
 * better-auth session" \u2014 a confidently wrong statement in a public file,
 * which is the one thing this document exists not to make.
 */
export function tagFor(path: string): string {
  const head = path.split('/')[1] ?? '';
  if (head === '' || head === 'health') return 'service';
  if (head === 'stories' || head === 'topics') return 'content';
  if (head === 'conversation') return 'conversation';
  if (head === 'beta') return 'beta';
  if (head === 'grade') return 'grade';
  if (head === 'feedback') return 'feedback';
  if (head === 'internal') return 'internal';
  throw new Error(
    `No tag for path "${path}". Add its prefix to tagFor() and a matching entry to TAGS in document.ts, so the route is grouped and described deliberately rather than by a default.`,
  );
}

/**
 * `toJSONSchema` stamps a `$schema` key on every result. Inside an OpenAPI 3.1
 * document the dialect is declared once at the top, so it is noise here.
 */
function generate(schema: ZodType): JsonSchema {
  const generated = toJSONSchema(schema, { target: 'draft-2020-12' }) as JsonSchema;
  delete generated.$schema;
  return generated;
}

/** `/grade/problems/{publicId}/image` -> `['publicId']`, in the order they appear. */
export function pathPlaceholders(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
}

function operationId(entry: RouteEntry): string {
  const parts = entry.path
    .split('/')
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith('{') ? `by-${segment.slice(1, -1)}` : segment,
    );
  return [entry.method, ...(parts.length ? parts : ['root'])].join('-');
}

/** Prose the schema cannot carry: the conditional gate, then the field notes. */
function describe(entry: RouteEntry): string | undefined {
  const blocks: string[] = [];
  if (entry.description) blocks.push(entry.description);
  if (entry.conditionalOn) {
    blocks.push(
      `**Conditional route.** This route exists only when \`${entry.conditionalOn}\` is set. The module that serves it is not registered otherwise, so it answers 404 rather than being disabled.`,
    );
  }
  const notes = Object.entries(entry.fieldNotes ?? {});
  if (notes.length > 0) {
    blocks.push(
      ['**Field notes**', '', ...notes.map(([field, note]) => `- \`${field}\`: ${note}`)].join('\n'),
    );
  }
  return blocks.length > 0 ? blocks.join('\n\n') : undefined;
}

function parametersFor(entry: RouteEntry): Record<string, unknown>[] | undefined {
  const where = `${entry.method.toUpperCase()} ${entry.path}`;
  const parameters: Record<string, unknown>[] = [];

  const placeholders = pathPlaceholders(entry.path);
  if (placeholders.length > 0) {
    if (!entry.paramSchema) {
      throw new Error(`${where} has path placeholders but no paramSchema`);
    }
    const properties = (generate(entry.paramSchema).properties ?? {}) as Record<string, JsonSchema>;
    for (const name of placeholders) {
      const schema = properties[name];
      if (!schema) {
        throw new Error(`${where}: paramSchema has no property "${name}"`);
      }
      parameters.push({ name, in: 'path', required: true, schema });
    }
  }

  if (entry.querySchema) {
    const generated = generate(entry.querySchema);
    const properties = (generated.properties ?? {}) as Record<string, JsonSchema>;
    const required = new Set((generated.required ?? []) as string[]);
    for (const [name, schema] of Object.entries(properties)) {
      parameters.push({ name, in: 'query', required: required.has(name), schema });
    }
  }

  return parameters.length > 0 ? parameters : undefined;
}

function requestBodyFor(entry: RouteEntry): Record<string, unknown> | undefined {
  if (!entry.requestSchema) return undefined;
  const contentType = entry.requestContentType ?? 'application/json';
  const schema = generate(entry.requestSchema);
  if (entry.multipartFile) {
    // The upload never reaches the zod schema (multer puts it on the request),
    // so it is added here rather than generated. It is the one part of a
    // request shape in this document that is hand written, and it is a file.
    const properties = {
      ...((schema.properties ?? {}) as Record<string, JsonSchema>),
      [entry.multipartFile.name]: {
        type: 'string',
        format: 'binary',
        description: entry.multipartFile.description,
      },
    };
    const required = [...((schema.required ?? []) as string[]), entry.multipartFile.name];
    return {
      required: true,
      content: { [contentType]: { schema: { ...schema, properties, required } } },
    };
  }
  return { required: true, content: { [contentType]: { schema } } };
}

function responsesFor(entry: RouteEntry): Record<string, unknown> {
  const responses: Record<string, unknown> = {};
  for (const response of entry.responses) {
    responses[String(response.status)] = response.schema
      ? {
          description: response.description,
          content: { [response.contentType ?? 'application/json']: { schema: response.schema } },
        }
      : response.contentType
        ? { description: response.description, content: { [response.contentType]: {} } }
        : { description: response.description };
  }
  return responses;
}

function operationFor(entry: RouteEntry): Record<string, unknown> {
  const description = describe(entry);
  const parameters = parametersFor(entry);
  const requestBody = requestBodyFor(entry);
  return {
    operationId: operationId(entry),
    summary: entry.summary,
    tags: [tagFor(entry.path)],
    ...(description ? { description } : {}),
    // Explicit on every route, both ways round: an empty list is OpenAPI for
    // "this one needs nothing". A public file that merely omits the marking
    // would leave a reader guessing which routes are open.
    security: entry.anonymous ? [] : [{ [SESSION_SCHEME]: [] }],
    ...(entry.conditionalOn ? { 'x-conditional-on': entry.conditionalOn } : {}),
    ...(parameters ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses: responsesFor(entry),
  };
}

export function buildDocument(routes: RouteEntry[] = ROUTES): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  const seenOperationIds = new Map<string, string>();
  for (const entry of routes) {
    paths[entry.path] ??= {};
    if (paths[entry.path][entry.method]) {
      throw new Error(`Duplicate registry entry: ${entry.method.toUpperCase()} ${entry.path}`);
    }
    const operation = operationFor(entry);
    // OpenAPI requires operationId to be unique, and the Markdown anchors are
    // built from it, so a collision makes the document invalid AND points two
    // index links at one section. Paths that differ only in where a hyphen
    // falls collide: /internal/grade-photos and /internal/grade/photos.
    const id = String(operation.operationId);
    const clash = seenOperationIds.get(id);
    if (clash) {
      throw new Error(
        `Two routes produce the same operationId "${id}": ${clash} and ${entry.method.toUpperCase()} ${entry.path}. Rename one path or give operationId() a disambiguating rule.`,
      );
    }
    seenOperationIds.set(id, `${entry.method.toUpperCase()} ${entry.path}`);
    paths[entry.path][entry.method] = operation;
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: {
      title: DOCUMENT_TITLE,
      version: DOCUMENT_VERSION,
      description: DOCUMENT_DESCRIPTION,
    },
    tags: TAGS,
    paths,
    components: {
      securitySchemes: {
        [SESSION_SCHEME]: {
          type: 'apiKey',
          in: 'cookie',
          name: 'better-auth.session_token',
          description:
            'The better-auth session cookie, set by signing in. In production it is served with the `__Secure-` prefix, `Secure`, and `SameSite=None`, because the site and the api are separate origins.',
        },
      },
      schemas: {
        ValidationError: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer', enum: [400] },
            message: {
              type: 'array',
              items: { type: 'string' },
              description: 'One entry per failed field, as `path: reason`.',
            },
            error: { type: 'string', enum: ['Bad Request'] },
          },
          required: ['statusCode', 'message', 'error'],
        },
        Error: {
          type: 'object',
          properties: {
            statusCode: { type: 'integer' },
            message: { type: 'string' },
            error: { type: 'string' },
          },
          required: ['statusCode', 'message'],
        },
      },
    },
  };
}

export type { OpenApiDocument };
