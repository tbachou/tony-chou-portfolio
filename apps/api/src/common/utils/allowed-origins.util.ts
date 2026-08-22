/** Fallback for local dev, where apps/web serves on :3000 and CORS_ORIGIN is unset. */
export const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:3000';

/**
 * The browser origins allowed to talk to this api.
 *
 * One resolver for two consumers on purpose: `main.ts` hands it to
 * `enableCors`, and `OriginCheckGuard` rejects state-changing requests from
 * anything outside it. Reading `CORS_ORIGIN` twice would let the CORS list and
 * the CSRF list drift apart, and a CSRF check that trusts an origin CORS does
 * not is worth nothing.
 *
 * Entries are trimmed so `a.com, b.com` behaves like `a.com,b.com`; an origin
 * with a stray leading space would otherwise never match a real `Origin`
 * header.
 */
export function resolveAllowedOrigins(): string[] {
  const raw = process.env.CORS_ORIGIN;
  if (raw === undefined) return [DEFAULT_ALLOWED_ORIGIN];

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}
