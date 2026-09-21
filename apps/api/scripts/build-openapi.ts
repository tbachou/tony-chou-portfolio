/**
 * Writes `docs/api/openapi.json` and `docs/api/README.md` (spec 0016).
 *
 *   npm run build:openapi --workspace=apps/api
 *
 * A thin wrapper on purpose. Everything it calls lives in `src/openapi/`,
 * because jest's `rootDir` is `src` and will not collect a spec file beside
 * this one. `apps/api/AGENTS.md` lists four other files that sit in `src/` for
 * the same reason.
 *
 * Both artifacts are committed. `check-openapi.ts` regenerates them in CI and
 * fails if they differ, so a stale document cannot reach the public repository
 * quietly. Run this after any change to a route, a contract schema, or the
 * registry, and commit what it writes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { renderArtifacts } from '../src/openapi/artifacts.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');

function main(): void {
  for (const { path, contents } of renderArtifacts()) {
    const absolute = join(REPO_ROOT, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, contents, 'utf8');
    console.log(`wrote ${path} (${contents.length} bytes)`);
  }
  console.log('build:openapi done. Commit both files.');
}

main();
