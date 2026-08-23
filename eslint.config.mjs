// Root ESLint flat config for the npm-workspaces monorepo.
// - apps/web: Next.js 16 rules, imported directly. eslint-config-next ships a
//   native flat config as of 16, so the old FlatCompat.extends() wrapper is
//   gone (feeding a flat config to the eslintrc compat layer throws).
// - apps/api + packages: typescript-eslint recommended (deliberately NOT the
//   type-checked variant, to keep lint fast and free of tsconfig coupling).
import path from 'node:path';

import js from '@eslint/js';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const webFiles = ['apps/web/**/*.{js,jsx,ts,tsx}'];
const nodeTsFiles = [
  'apps/api/**/*.ts',
  'apps/streamflow/**/*.ts',
  'packages/**/*.ts',
  'infra/lambda/**/*.ts',
];

// Scope every config in next/core-web-vitals to apps/web only, preserving
// eslint-config-next's own overrides (e.g. TS parser for *.ts?(x)).
const nextConfigs = nextCoreWebVitals
  // Drop the config's own global-ignores entry: unscoped it would apply
  // monorepo-wide, and the root ignores block below already covers .next,
  // build output and next-env.d.ts. Match only an entry whose SOLE key is
  // `ignores` — in flat config `{ ignores, rules }` with no `files` is a
  // legal "every file except these" block, and dropping one of those would
  // silently lose its rules if a later eslint-config-next ships one.
  .filter((config) => !(config.ignores && Object.keys(config).length === 1))
  .map((config) => ({
    ...config,
    files: config.files
      ? config.files.map((pattern) => `apps/web/${pattern}`)
      : webFiles,
  }));

const apiConfigs = [js.configs.recommended, ...tseslint.configs.recommended].map(
  (config) => ({
    ...config,
    files: nodeTsFiles,
  }),
);

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      // Prisma client output — large generated code, never lint it.
      'apps/api/src/generated/**',
      'apps/streamflow/src/generated/**',
      'apps/web/next-env.d.ts',
    ],
  },

  // --- apps/web (Next.js 16 + React 19) ---
  ...nextConfigs,
  {
    files: webFiles,
    settings: {
      // Tell @next/next rules where the Next app lives (monorepo layout).
      // Absolute so it resolves regardless of the cwd eslint runs from.
      next: { rootDir: path.join(import.meta.dirname, 'apps/web') },
    },
    rules: {
      // New in eslint-plugin-react-hooks 7, which arrived with
      // eslint-config-next 16 and errors by default. It flags 11 existing
      // effects (theme hydration, fetch-on-mount, the DeskScene measure
      // pass) that predate the rule and are not a regression from the Next
      // 16 upgrade. Demoted to a warning so the debt stays visible without
      // the upgrade turning into an effects refactor; fix the sites, then
      // delete this override.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // --- apps/api (NestJS 11) + packages ---
  ...apiConfigs,
  {
    files: nodeTsFiles,
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
];
