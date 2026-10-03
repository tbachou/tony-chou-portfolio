/**
 * The one place a failed API response becomes a message a visitor can read.
 *
 * Four modules carried byte-identical copies of `extractServerMessage` plus an
 * identical bare `catch {}` around `res.json()`. The swallow is correct — a
 * proxy's own HTML 502 page makes `res.json()` reject, and the visitor needs
 * the generic sentence, not `Unexpected token <` — but four copies of a
 * deliberate swallow is four places to get it wrong, and a repo sweep flagged
 * it as such. It lives here now, with the reason attached once.
 *
 * Behaviour is pinned by `http-error.characterization.spec.ts`, written
 * against the four copies before they were replaced.
 */

/**
 * Pull the human-readable message out of a NestJS error body.
 *
 * NestJS sends `message` as a string for most failures and as an array for
 * validation errors, which is why both shapes are handled. Non-string entries
 * in that array are dropped; a server sending a number there would lose it
 * silently. That is existing behaviour, recorded in the characterization spec
 * rather than changed here — correcting it belongs in its own change.
 */
export function extractServerMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) {
    return message.filter((m): m is string => typeof m === 'string').join(' ');
  }
  return null;
}

/**
 * The server's own message for a failed response, or null when there isn't
 * one to show.
 *
 * Null covers three cases the caller treats identically: the body was not
 * JSON, it was JSON without a usable `message`, or reading it failed. Each
 * caller supplies its own fallback sentence, which is why this returns null
 * rather than inventing one.
 */
export async function readServerMessage(
  res: Pick<Response, 'json'>,
): Promise<string | null> {
  try {
    return extractServerMessage(await res.json());
  } catch {
    // The swallow this helper exists to hold: a non-JSON error body (a
    // proxy's HTML page, an empty 413) must not surface a parser error to
    // somebody who just wanted to know their request failed.
    return null;
  }
}
