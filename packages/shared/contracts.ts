import { z } from 'zod';

/**
 * The HTTP contracts, as zod schemas, owned here and used by both sides.
 *
 * The api parses every request body and param through these (see
 * `ZodValidationPipe`), and the web app builds its payloads to the types
 * inferred from them. One definition per contract, so a field cannot be
 * tightened on one side and left alone on the other.
 *
 * Two rules for anything added here:
 *
 * 1. Every object is `.strict()`. That is what replaces the class-validator
 *    ValidationPipe's `forbidNonWhitelisted`: an unexpected property is a
 *    400 rather than something silently dropped. Nothing in this file may
 *    relax that.
 * 2. These schemas are the request surface, not the form surface. A form
 *    input is a string even when the field is a number, so the web app
 *    validates its own inputs and converts, then hands over a value these
 *    schemas accept. Type errors at that seam are the point.
 */

// ---------------------------------------------------------------------
// Beta — return-to-climbing rehab planner (spec 0004)
// ---------------------------------------------------------------------

export const INJURY_AREAS = [
  'finger_pulley',
  'elbow_tendinopathy',
  'shoulder_impingement',
] as const;
export type InjuryArea = (typeof INJURY_AREAS)[number];

export const SYMPTOMS = [
  // Red flag checkboxes (AC-2) — the screener hard-blocks on these.
  'sudden_pop_with_swelling',
  'numbness_or_tingling',
  'cannot_bear_weight_or_grip',
  'night_pain',
  // Common non-red-flag symptoms.
  'pain_with_specific_holds_or_moves',
  'pain_at_session_start_that_warms_up',
  'morning_stiffness',
  'mild_swelling',
  'tenderness_to_touch',
  'weakness_or_early_fatigue',
] as const;
export type Symptom = (typeof SYMPTOMS)[number];

/**
 * The four symptoms that hard-block a plan (AC-2).
 *
 * Here rather than in either app because both sides read it and they must
 * agree: the api blocks on this list in code before any model call, and the
 * form labels exactly these checkboxes "Warning sign — we'll stop and point
 * you to a pro". A symptom the form promises will stop the planner but the
 * api does not block is a visitor told to expect a professional handoff who
 * gets a rehab plan instead.
 */
export const RED_FLAG_SYMPTOMS = [
  'sudden_pop_with_swelling',
  'numbness_or_tingling',
  'cannot_bear_weight_or_grip',
  'night_pain',
] as const satisfies readonly Symptom[];
export type RedFlagSymptom = (typeof RED_FLAG_SYMPTOMS)[number];

export const PAIN_BEHAVIORS = [
  'none_at_rest_hurts_under_load',
  'warms_up_then_fine',
  'worsens_as_session_goes_on',
  'constant_even_at_rest',
] as const;
export type PainBehavior = (typeof PAIN_BEHAVIORS)[number];

export const DISCIPLINES = [
  'bouldering',
  'sport',
  'trad',
  'indoor_gym',
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const EQUIPMENT_ACCESS = [
  'climbing_gym',
  'home_wall',
  'hangboard',
  'resistance_bands',
  'weights',
  'none',
] as const;
export type EquipmentAccess = (typeof EQUIPMENT_ACCESS)[number];

/** Constrained, not an enum: grades come in many systems (V5, 5.11a, 6b+). */
export const GRADE_TEXT_PATTERN = /^[A-Za-z0-9 .+/-]+$/;

/**
 * Free text is length-capped at the boundary, before any agent sees it
 * (spec 0004 key invariant; AC-7).
 */
export const betaPlanRequestSchema = z
  .object({
    injuryArea: z.enum(INJURY_AREAS),
    onsetWeeksAgo: z.number().int().min(0).max(520),
    symptoms: z.array(z.enum(SYMPTOMS)).max(SYMPTOMS.length),
    painBehavior: z.enum(PAIN_BEHAVIORS),
    preInjuryGrade: z
      .string()
      .min(1)
      .max(12)
      .regex(GRADE_TEXT_PATTERN, {
        error:
          'preInjuryGrade must be a plain climbing grade like V5, 5.11a, or 6b+',
      }),
    discipline: z.enum(DISCIPLINES),
    goals: z.string().max(200).optional(),
    sessionsPerWeek: z.number().int().min(0).max(14).optional(),
    equipmentAccess: z
      .array(z.enum(EQUIPMENT_ACCESS))
      .max(EQUIPMENT_ACCESS.length)
      .optional(),
  })
  .strict();

export type BetaPlanRequest = z.infer<typeof betaPlanRequestSchema>;

// ---------------------------------------------------------------------
// Conversation — the interview simulator (spec 0002)
// ---------------------------------------------------------------------

export const CONVERSATION_ROLES = ['interviewer', 'tony'] as const;
export type ConversationRole = (typeof CONVERSATION_ROLES)[number];

// The request carries no transcript. History is rebuilt server side from the
// persisted ConversationTurn rows for `conversationId` (spec 0012 phase one),
// so nothing a visitor types can reach a prompt. `.strict()` turns an old
// client's `history` field into a 400 rather than a silently ignored payload.
export const conversationTurnRequestSchema = z
  .object({
    topicId: z.string().min(1),
    // Absent means an opening turn.
    conversationId: z.uuid().optional(),
  })
  .strict();

export type ConversationTurnRequest = z.infer<
  typeof conversationTurnRequestSchema
>;

// ---------------------------------------------------------------------
// Feedback (spec 0005)
// ---------------------------------------------------------------------

export const FEEDBACK_SOURCES = ['beta', 'portfolio'] as const;
export type FeedbackSourceValue = (typeof FEEDBACK_SOURCES)[number];

export const FEEDBACK_CATEGORIES = ['bug', 'feature', 'other'] as const;
export type FeedbackCategoryValue = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_MESSAGE_MAX_LENGTH = 2000;

/**
 * AC-I1 / AC-I4: message is required, 1..2000 chars; category is optional;
 * source is required. AC-I2: no email, name, or account field exists here —
 * do not add one without a new spec.
 */
export const createFeedbackSchema = z
  .object({
    message: z.string().min(1).max(FEEDBACK_MESSAGE_MAX_LENGTH),
    category: z.enum(FEEDBACK_CATEGORIES).optional(),
    source: z.enum(FEEDBACK_SOURCES),
  })
  .strict();

export type CreateFeedback = z.infer<typeof createFeedbackSchema>;

// ---------------------------------------------------------------------
// Grade Guesser (spec 0006)
// ---------------------------------------------------------------------

export const GRADE_MIN = 0;
export const GRADE_MAX = 8;

export const PUBLIC_ID_LENGTH = 16;
export const PUBLIC_ID_PATTERN = new RegExp(`^[0-9a-f]{${PUBLIC_ID_LENGTH}}$`);

const publicId = z.string().regex(PUBLIC_ID_PATTERN, {
  error: `publicId must be ${PUBLIC_ID_LENGTH} lowercase hex characters`,
});

/**
 * The entire request body for POST /grade/guess (AC-8, AC-23).
 *
 * One validated integer and one machine-shaped id are the whole input
 * surface for the feature, which is the point: with no free-text field
 * anywhere, the game has no prompt injection surface and nothing a visitor
 * typed can reach the database or a log line by construction (AC-6). Do not
 * add a free-text field here without a spec change.
 *
 * `guess` is a plain `z.number()`, never coerced, so `"V5"` fails rather
 * than being converted — matching the old pipe, which did not enable
 * implicit conversion.
 */
export const gradeGuessRequestSchema = z
  .object({
    guess: z
      .number({ error: 'guess must be an integer V-grade' })
      .int({ error: 'guess must be an integer V-grade' })
      .min(GRADE_MIN, { error: `guess must be at least V${GRADE_MIN}` })
      .max(GRADE_MAX, { error: `guess must be at most V${GRADE_MAX}` }),
    publicId,
  })
  .strict();

export type GradeGuessRequest = z.infer<typeof gradeGuessRequestSchema>;

/** The path parameter for GET /grade/problems/:publicId/image (AC-23, AC-25). */
export const gradeProblemIdParamSchema = z.object({ publicId }).strict();

export type GradeProblemIdParam = z.infer<typeof gradeProblemIdParamSchema>;

// ---------------------------------------------------------------------
// Grade photo pool — internal admin (spec 0006, AC-17)
// ---------------------------------------------------------------------

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

export const GRADE_PHOTO_SOURCES = [
  'own_photo',
  'permission_given',
  'licensed',
  'unlicensed_test',
] as const;
export type GradePhotoSourceValue = (typeof GRADE_PHOTO_SOURCES)[number];

/**
 * The upload form (AC-17).
 *
 * Multipart, so every field arrives as a string: `trueGrade` coerces here,
 * exactly where `@Type(() => Number)` used to. Nothing else coerces.
 *
 * Note what is NOT here: `objectKey` and `contentType`. Both are produced by
 * the server — a random key and the image pipeline's own output — so there is
 * no field through which a client could name where its bytes land or claim a
 * media type the bytes are not (AC-17).
 */
export const createGradePhotoSchema = z
  .object({
    /**
     * The owner set slug, which is also the row's primary key and the daily
     * cycle's sort key. Lowercase, hyphens, 3 to 64 characters.
     */
    id: z.string().regex(SLUG_PATTERN, {
      error:
        'id must be 3 to 64 characters of lowercase letters, digits and hyphens, and may not start with a hyphen',
    }),
    /** The owner's gym grade for this problem. */
    trueGrade: z.coerce
      .number({ error: `trueGrade must be an integer ${GRADE_MIN} to ${GRADE_MAX}` })
      .int({ error: `trueGrade must be an integer ${GRADE_MIN} to ${GRADE_MAX}` })
      .min(GRADE_MIN)
      .max(GRADE_MAX),
    /**
     * Where the photo came from. Required, so provenance is data rather than
     * memory: an `unlicensed_test` row is kept out of the cycle once the game
     * is enabled (AC-18) instead of going live by being forgotten.
     */
    source: z.enum(GRADE_PHOTO_SOURCES, {
      error: `source must be one of: ${GRADE_PHOTO_SOURCES.join(', ')}`,
    }),
    /** Where it came from in prose: a URL, a photographer, a permission reference. */
    sourceNote: z.string().max(500).optional(),
    /** Location or credit line, shown to the visitor after the reveal. */
    note: z.string().max(200).optional(),
  })
  .strict();

/** The photo pool's id is a slug, minted at upload. Validated the same way as every other route input. */
export const gradePhotoIdParamSchema = z
  .object({ id: z.string().regex(SLUG_PATTERN) })
  .strict();

export type GradePhotoIdParam = z.infer<typeof gradePhotoIdParamSchema>;

export type CreateGradePhoto = z.infer<typeof createGradePhotoSchema>;

/**
 * The active toggle (AC-17).
 *
 * Deactivating is the only way a photo leaves the pool: rows are never
 * deleted, and GradeProblem's foreign key is onDelete: Restrict so the
 * database enforces that rather than a habit.
 *
 * JSON sends a real boolean; the string forms are accepted so the same
 * endpoint works from a form post without a second shape to maintain.
 */
export const setPhotoActiveSchema = z
  .object({
    active: z.preprocess(
      (value) => (value === 'true' ? true : value === 'false' ? false : value),
      z.boolean(),
    ),
  })
  .strict();

export type SetPhotoActive = z.infer<typeof setPhotoActiveSchema>;

// ---------------------------------------------------------------------
// Streamflow forecast pipeline (spec 0010)
// ---------------------------------------------------------------------

/**
 * Longest window the observations endpoint will serve, in days. Spec 0010
 * sets a hard maximum of 365 days; past that the endpoint answers 422 rather
 * than reading a year and a half of rows to draw a line nobody can see.
 */
export const OBSERVATIONS_MAX_WINDOW_DAYS = 365;

/** What the hydrograph asks for by default. */
export const OBSERVATIONS_DEFAULT_WINDOW_DAYS = 30;

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'must be an ISO 8601 date time',
  });

/**
 * The hydrograph query.
 *
 * `from` and `to` bound `validTime`, which is when the reading was true at the
 * gauge. `asOf` bounds `recordedAt`, which is when this pipeline learned it,
 * and it is what lets the page show the store as it stood at a past moment
 * rather than as it stands now. Leaving `asOf` out means now.
 *
 * Both axes are separate on purpose: `from`/`to` move along the river's
 * history, `asOf` moves along ours.
 */
export const observationsQuerySchema = z
  .object({
    from: isoDateTime,
    to: isoDateTime,
    asOf: isoDateTime.optional(),
  })
  .strict()
  .refine((query) => Date.parse(query.from) <= Date.parse(query.to), {
    message: 'from must be at or before to',
    path: ['from'],
  })
  .refine(
    (query) =>
      Date.parse(query.to) - Date.parse(query.from) <=
      OBSERVATIONS_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    {
      message: `window must be ${OBSERVATIONS_MAX_WINDOW_DAYS} days or fewer`,
      path: ['to'],
    },
  );

export type ObservationsQuery = z.infer<typeof observationsQuerySchema>;

/** One point on the hydrograph, as the endpoint returns it. */
export interface ObservationPoint {
  /** When the reading was true at the gauge, ISO 8601 in UTC. */
  validTime: string;
  /** When this pipeline learned it, ISO 8601 in UTC. */
  recordedAt: string;
  valueCfs: number;
  qualifier: 'PROVISIONAL' | 'APPROVED';
}

export interface ObservationsResponse {
  gauge: {
    usgsSiteId: string;
    name: string;
    lat: number;
    lon: number;
    timezone: string;
  };
  /** The instant the store was read as of, echoed back so the page can show it. */
  asOf: string;
  from: string;
  to: string;
  points: ObservationPoint[];
}
