import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * The api suite, moved off Jest because NestJS 12 is ESM only and Jest cannot
 * load ESM through its own module system (spec 0015).
 *
 * `unplugin-swc` is load bearing and not interchangeable with Vitest's default
 * esbuild transform: esbuild does not emit `design:paramtypes`, and NestJS
 * resolves constructor injection from exactly that metadata. Without it every
 * module test fails with "Nest can't resolve dependencies", which looks like a
 * DI bug rather than a transform setting.
 */
export default defineConfig({
  plugins: [
    swc.vite({
      // The builder `nest build` uses, so tests and the shipped build agree
      // about decorators rather than diverging silently.
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        // Mirrors apps/api/.swcrc. unplugin-swc does not read that file, so the
        // two are kept deliberately identical; `new Logger(SomeService.name)`
        // in a dozen services depends on this one.
        keepClassNames: true,
      },
    }),
  ],
  test: {
    // Matches Jest's behaviour so the 53 suites did not all need an import
    // line added in the same commit that changed the runner.
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
