#!/usr/bin/env node
/**
 * Validates the committed interview eval record before a deploy is attempted
 * (spec 0012 phase two, AC-2b).
 *
 * The site build already refuses to render an inconsistent record, but a
 * build failure names a page, not a manifest. This runs the exact same
 * loader as a named check so the person who mistyped `published.json` sees
 * that, first, and does not have to read a Next.js build log to find it.
 *
 * It imports the loader rather than restating its rules, because two copies
 * of a validation are exactly the drift this whole phase argues against.
 * Node 22.18 and later strip TypeScript types on import with no flag, which
 * is what lets a plain .mjs script reuse the app's module directly.
 */
import { loadPublished, loadRun, loadWriteup } from '../apps/web/src/lib/evals.ts';

try {
  const manifest = loadPublished();
  for (const entry of manifest.publishedRuns) {
    loadWriteup(entry);
    if (entry.measured) loadRun(entry);
  }
  const measured = manifest.publishedRuns.filter((entry) => entry.measured).length;
  console.log(
    `check:evals ok — ${manifest.publishedRuns.length} published run(s), ${measured} measured, ` +
      `${manifest.baselineHistory.length} baseline history entries.`
  );
} catch (error) {
  console.error('check:evals failed\n');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
