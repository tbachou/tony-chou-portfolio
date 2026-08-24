/** Longest error text kept on a run row. Enough to diagnose, not a stack dump. */
const MAX_ERROR_LENGTH = 500;

/**
 * Matches a database connection string in any of the forms a driver error is
 * likely to quote it in.
 */
const CONNECTION_STRING = /\b(postgres(?:ql)?|prisma):\/\/[^\s'"]*/gi;

/**
 * Matches the credential on its own, which is how an error quotes it when it
 * did not quote the whole url. Prisma Postgres passwords are `sk_` prefixed
 * keys, and the pattern above only ever fires on a recognised scheme, so
 * without this a bare key reaches PipelineRun.error and from there the public
 * /api/runs endpoint. The length floor keeps ordinary prose out.
 */
const API_KEY = /\bsk_[A-Za-z0-9_-]{8,}/g;

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

  const redacted = raw
    .replace(CONNECTION_STRING, '[redacted connection string]')
    .replace(API_KEY, '[redacted key]');

  return redacted.length > MAX_ERROR_LENGTH
    ? `${redacted.slice(0, MAX_ERROR_LENGTH)}...`
    : redacted;
}
