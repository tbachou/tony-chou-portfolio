import { describe, expect, it, vi, afterEach } from 'vitest';
import { BetaRequestError, streamBetaPlan } from './beta-api';
import { FeedbackRequestError, submitFeedback } from './feedback-api';

/**
 * CHARACTERIZATION tests, written before the refactor they protect.
 *
 * Four modules each carry a byte-identical `extractServerMessage` and an
 * identical `catch {}` around `res.json()` — the "non-JSON error body" swallow
 * a repo sweep flagged. Consolidating them into one helper is the change these
 * tests exist to make safe.
 *
 * They assert what the code DOES today, not what it should do. If one fails
 * after the consolidation, the consolidation changed behaviour — that is the
 * only thing they are here to tell us. Where today's behaviour is arguably
 * wrong, the oddity is written down rather than corrected: fixing it is a
 * separate change with its own reasoning.
 */

/** Drives streamBetaPlan far enough to hit its error path. */
async function drainBetaPlan(): Promise<void> {
  for await (const _event of streamBetaPlan({} as never)) {
    // The error path throws before any event is yielded.
  }
}

const FEEDBACK = {
  message: 'hi',
  source: 'beta' as const,
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** A proxy's own HTML error page: res.json() rejects. */
function nonJsonResponse(status: number) {
  return {
    ok: false,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('server error message extraction, as it behaves today', () => {
  describe('beta-api', () => {
    it('surfaces a string `message` from the error body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(429, { message: 'Slow down please' })),
      );

      await expect(drainBetaPlan()).rejects.toMatchObject({
        status: 429,
        message: 'Slow down please',
      });
    });

    it('joins an array `message` with single spaces', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          jsonResponse(400, { message: ['too short', 'too rude'] }),
        ),
      );

      await expect(drainBetaPlan()).rejects.toMatchObject({
        message: 'too short too rude',
      });
    });

    it('drops non-string entries from an array `message`', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(400, { message: ['keep', 7, null] })),
      );

      // Today's filter silently discards them. Recorded, not endorsed: a
      // server sending a number here would lose it without trace.
      await expect(drainBetaPlan()).rejects.toMatchObject({
        message: 'keep',
      });
    });

    it('falls back to the generic message when the body is not JSON', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => nonJsonResponse(502)));

      const error = await drainBetaPlan().catch((e) => e);
      expect(error).toBeInstanceOf(BetaRequestError);
      expect(error.status).toBe(502);
      // The swallow: the SyntaxError never reaches the caller.
      expect(error.message).not.toContain('Unexpected token');
    });

    it('falls back when the body is JSON but carries no message', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500, { oops: 1 })));

      const error = await drainBetaPlan().catch((e) => e);
      expect(error.status).toBe(500);
      expect(error.message).toBeTruthy();
    });

    it('falls back when the body is a bare JSON string', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, 'nope')));

      // `typeof body !== 'object'` short-circuits, so a string body yields
      // null rather than being used as the message.
      const error = await drainBetaPlan().catch((e) => e);
      expect(error.message).not.toBe('nope');
    });

    it('falls back when the body is null', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(400, null)));

      const error = await drainBetaPlan().catch((e) => e);
      expect(error.message).toBeTruthy();
    });
  });

  describe('feedback-api behaves the same way', () => {
    it('surfaces a string `message`', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(429, { message: 'Too many notes' })),
      );

      await expect(submitFeedback(FEEDBACK)).rejects.toMatchObject({
        message: 'Too many notes',
      });
    });

    it('swallows a non-JSON body identically', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => nonJsonResponse(413)));

      const error = await submitFeedback(FEEDBACK).catch((e) => e);
      expect(error).toBeInstanceOf(FeedbackRequestError);
      expect(error.message).not.toContain('Unexpected token');
    });
  });
});
