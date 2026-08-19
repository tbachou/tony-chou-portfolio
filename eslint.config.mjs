// Root ESLint flat config for the npm-workspaces monorepo.
// - apps/web: Next.js 15 rules (next/core-web-vitals) via FlatCompat, since
//   eslint-config-next still ships a legacy-format config.
// - apps/api + packages: typescript-eslint recommended (deliberately NOT the
//   type-checked variant, to keep lint fast and free of tsconfig coupling).
import path from 'node:path';

import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const webFiles = ['apps/web/**/*.{js,jsx,ts,tsx}'];
const nodeTsFiles = ['apps/api/**/*.ts', 'packages/**/*.ts'];

// Scope every config produced from next/core-web-vitals to apps/web only,
// preserving eslint-config-next's own overrides (e.g. TS parser for *.ts?(x)).
const nextConfigs = compat.extends('next/core-web-vitals').map((config) => ({
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
      'apps/web/next-env.d.ts',
    ],
  },

  // --- apps/web (Next.js 15 + React 19) ---
  ...nextConfigs,
  {
    files: webFiles,
    settings: {
      // Tell @next/next rules where the Next app lives (monorepo layout).
      // Absolute so it resolves regardless of the cwd eslint runs from.
      next: { rootDir: path.join(import.meta.dirname, 'apps/web') },
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
