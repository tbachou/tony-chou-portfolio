import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OriginCheckGuard } from './origin-check.guard';

/**
 * A minimal ExecutionContext. Only `getType` and the http request are read, so
 * the rest of the interface is deliberately absent rather than stubbed.
 */
function contextFor(
  request: { method?: string; headers?: Record<string, unknown> },
  type: 'http' | 'ws' = 'http',
): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

const ALLOWED = 'https://tonychou.dev';
const OTHER_ALLOWED = 'https://www.tonychou.dev';
const ATTACKER = 'https://evil.example';

describe('OriginCheckGuard', () => {
  const originalCorsOrigin = process.env.CORS_ORIGIN;
  let guard: OriginCheckGuard;

  beforeEach(() => {
    guard = new OriginCheckGuard();
    process.env.CORS_ORIGIN = `${ALLOWED}, ${OTHER_ALLOWED}`;
  });

  afterAll(() => {
    if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = originalCorsOrigin;
  });

  describe('state-changing requests', () => {
    it('rejects a cross-site POST from an origin that is not allowed', () => {
      // The finding this guard exists for: a multipart POST is CORS-safelisted,
      // so it is never preflighted and the handler would otherwise run with the
      // signed-in owner's SameSite=None session cookie attached.
      expect(() =>
        guard.canActivate(
          contextFor({
            method: 'POST',
            headers: { origin: ATTACKER, 'content-type': 'multipart/form-data' },
          }),
        ),
      ).toThrow(ForbiddenException);
    });

    it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
      'rejects a disallowed origin on %s',
      (method) => {
        expect(() =>
          guard.canActivate(contextFor({ method, headers: { origin: ATTACKER } })),
        ).toThrow(ForbiddenException);
      },
    );

    it('allows every configured origin, whitespace in the list included', () => {
      for (const origin of [ALLOWED, OTHER_ALLOWED]) {
        expect(
          guard.canActivate(contextFor({ method: 'POST', headers: { origin } })),
        ).toBe(true);
      }
    });

    it('allows a request with no Origin header', () => {
      // A browser cannot suppress Origin, so absence means a non-browser
      // caller: curl, a health probe, server to server. Not a CSRF vector, and
      // rejecting it would break tooling for nothing.
      expect(guard.canActivate(contextFor({ method: 'POST', headers: {} }))).toBe(
        true,
      );
      expect(guard.canActivate(contextFor({ method: 'POST' }))).toBe(true);
      expect(
        guard.canActivate(contextFor({ method: 'POST', headers: { origin: '' } })),
      ).toBe(true);
    });

    it('does not treat a prefix of an allowed origin as allowed', () => {
      expect(() =>
        guard.canActivate(
          contextFor({
            method: 'POST',
            headers: { origin: `${ALLOWED}.evil.example` },
          }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('matches the method case-insensitively', () => {
      expect(() =>
        guard.canActivate(contextFor({ method: 'post', headers: { origin: ATTACKER } })),
      ).toThrow(ForbiddenException);
    });
  });

  describe('everything else passes through', () => {
    it('ignores reads, which carry no CSRF risk', () => {
      for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        expect(
          guard.canActivate(
            contextFor({ method, headers: { origin: ATTACKER } }),
          ),
        ).toBe(true);
      }
    });

    it('treats a request with no method as a read', () => {
      expect(guard.canActivate(contextFor({ headers: { origin: ATTACKER } }))).toBe(
        true,
      );
    });

    it('allows a context with no request object at all', () => {
      // The guard optional-chains through the request; without this case that
      // chaining is unpinned, and dropping it passes every other test.
      const context = {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => undefined }),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(context)).toBe(true);
    });

    it('ignores non-http contexts', () => {
      expect(
        guard.canActivate(
          contextFor({ method: 'POST', headers: { origin: ATTACKER } }, 'ws'),
        ),
      ).toBe(true);
    });
  });

  describe('with CORS_ORIGIN unset (local dev)', () => {
    it('allows the localhost default and nothing else', () => {
      delete process.env.CORS_ORIGIN;

      expect(
        guard.canActivate(
          contextFor({
            method: 'POST',
            headers: { origin: 'http://localhost:3000' },
          }),
        ),
      ).toBe(true);
      expect(() =>
        guard.canActivate(
          contextFor({ method: 'POST', headers: { origin: ATTACKER } }),
        ),
      ).toThrow(ForbiddenException);
    });
  });
});
