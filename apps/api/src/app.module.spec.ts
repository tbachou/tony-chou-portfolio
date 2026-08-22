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

  it('does not let the guard be spread away behind a condition', () => {
    // Deleting the provider is one way to lose the guard; making it
    // conditional is the likelier one under deploy pressure, and the match
    // above cannot tell the two apart. A CSRF control with an off switch is
    // not a control.
    //
    // Asserting on the SHAPE of the providers block rather than pattern
    // matching the off switch, because the first version of this test did the
    // latter and missed the obvious multi-line form. Any conditional here has
    // to use a spread or a ternary, so banning both is the check that cannot
    // be worded around.
    const start = source.indexOf('providers: [');
    const providersBlock = source.slice(start, source.indexOf('],', start));

    expect(providersBlock).toContain(
      '{ provide: APP_GUARD, useClass: OriginCheckGuard },',
    );
    expect(providersBlock).not.toContain('...');
    expect(providersBlock).not.toContain('?');
  });
});
