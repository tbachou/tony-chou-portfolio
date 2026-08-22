// The request enums and the message cap live in @portfolio/shared, next to
// the schema that validates them (spec 0005).
export {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  FEEDBACK_SOURCES,
  type FeedbackCategoryValue,
  type FeedbackSourceValue,
} from '@portfolio/shared';

// Feedback intake constants (spec 0005 child: feedback intake).

// Mirrors the Prisma FeedbackSource / FeedbackCategory enums exactly (values
// are lowercase to match schema.prisma). Kept as plain arrays, not an import
// from the generated Prisma client, so the DTO layer stays decoupled from
// the generated client (repo convention — see beta.constants.ts).



// Persisted cap: rows per hashedIp per UTC day. Count-based, not atomic
// (AC-I3 accepted race — see the module's Decision / inline rationale for
// why this differs from Beta's atomic reserve/refund convention).
export const FEEDBACK_IP_DAILY_CAP = 10;

// In-memory throttle (FeedbackThrottlerGuard, via @Throttle on the route).
export const FEEDBACK_THROTTLE_LIMIT = 5;
export const FEEDBACK_THROTTLE_TTL_MS = 3_600_000;

export const FEEDBACK_RATE_LIMIT_MESSAGE =
  'You have reached the daily limit of 10 feedback submissions. It resets at midnight UTC.';
