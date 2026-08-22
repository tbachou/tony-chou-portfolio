import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A tripwire, not a behavioural test, and deliberately so.
 *
 * `origin-check.guard.spec.ts` proves the guard rejects a forged origin.
 * Nothing proved it was actually REGISTERED, and a working guard nobody wired
 * in protects nothing: deleting the provider would otherwise break no test.
 *
 * This reads the source rather than importing AppModule because that import
 * pulls in better-auth's ESM dist and the generated Prisma client, so an
 * import-based version needs a stack of mocks that break whenever an unrelated
 * dependency moves. Matching on the text is narrower than compiling the module,
 * and it fails for exactly one reason: someone removed the registration.
 */
describe('AppModule wiring', () => {
  const source = readFileSync(join(__dirname, 'app.module.ts'), 'utf8');

  it('registers OriginCheckGuard as a global guard, so CSRF cover is not per-controller', () => {
    expect(source).toContain('OriginCheckGuard');
    expect(source).toMatch(
      /provide:\s*APP_GUARD,\s*useClass:\s*OriginCheckGuard/,
    );
  });
});
