/**
 * What a visitor is told when a turn fails. Fixed text, never the error.
 *
 * The raw error can be an upstream SDK message, a Prisma message, or anything
 * else thrown inside the turn, and any of those can echo request content.
 * Beta states the rule ("never raw upstream messages") and enforces it with
 * fixed strings; this endpoint sent `error.message` to the client verbatim,
 * and a test pinned it. The cause still reaches the log, by name only.
 */
export const TURN_ERROR_MESSAGE =
  'That turn could not be generated. Start a new conversation or try again in a moment.';
