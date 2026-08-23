/** Longest error text kept on a run row. Enough to diagnose, not a stack dump. */
const MAX_ERROR_LENGTH = 500;

/**
 * Matches a database connection string in any of the forms a driver error is
 * likely to quote it in.
 */
const CONNECTION_STRING = /\b(postgres(?:ql)?|prisma):\/\/[^\s'"]*/gi;

/**
 * Turns a thrown value into text safe to store on a `PipelineRun`.
 *
 * Run history is public on the dashboard, and the connection string is the one
 * secret this pipeline holds. Driver errors quote it readily, so it is stripped
 * here rather than trusted not to appear.
 */
export function sanitizeError(cause: unknown): string {
  const raw =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : 'unknown error';

  const redacted = raw.replace(CONNECTION_STRING, '[redacted connection string]');

  return redacted.length > MAX_ERROR_LENGTH
    ? `${redacted.slice(0, MAX_ERROR_LENGTH)}...`
    : redacted;
}
