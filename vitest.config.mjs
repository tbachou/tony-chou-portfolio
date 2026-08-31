import { defineConfig } from 'vitest/config';

/**
 * Root level tests, for the repo tooling under `scripts/`.
 *
 * The workspaces have their own runners (apps/web vitest, apps/api jest) and
 * neither reaches this directory, so `scripts/` had no coverage at all. That
 * mattered: `check-worktrees.mjs` decides whether to tell someone a directory
 * is safe to delete, and it shipped a path matching bug that recommended
 * deleting hand written files. Anything here that makes a destructive
 * recommendation, or gates spending, gets tests.
 */
export default defineConfig({
  test: {
    include: ['scripts/**/*.spec.mjs'],
    environment: 'node',
  },
});
