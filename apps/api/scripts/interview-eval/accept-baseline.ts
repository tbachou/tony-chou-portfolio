/**
 * Accept an already measured results file as the baseline, with no new run.
 *
 * This does exactly what `run.ts --save-baseline` does at the end of a run,
 * minus the run: it carries the existing noise band over (the runner's own
 * default when --noise-from is absent) and regenerates the scoreboard through
 * renderScoreboard, so the file is the same projection the suite would have
 * written rather than something assembled by hand.
 *
 *   npx tsx scripts/interview-eval/accept-baseline.ts results/<file>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import type {
  BaselineFile,
  RunResults,
} from '../../src/modules/conversation/eval/eval-types';
import { renderScoreboard } from '../../src/modules/conversation/eval/scoreboard';

const EVALS = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'docs',
  'evals',
  'interview',
);

const runFile = process.argv[2];
if (!runFile) {
  console.error('usage: accept-baseline.ts results/<file>.json');
  process.exit(1);
}

const run: RunResults = JSON.parse(
  fs.readFileSync(path.join(EVALS, runFile), 'utf8'),
);
const baselinePath = path.join(EVALS, 'baseline.json');
const previous: BaselineFile = JSON.parse(
  fs.readFileSync(baselinePath, 'utf8'),
);

if (run.meta.datasetHash !== previous.run.meta.datasetHash) {
  console.error(
    `❌ dataset hash differs (${run.meta.datasetHash.slice(0, 12)}… vs ${previous.run.meta.datasetHash.slice(0, 12)}…). ` +
      'The carried over noise band would not apply; measure a new one from two identical runs.',
  );
  process.exit(1);
}
if (run.meta.partial) {
  console.error('❌ refusing a partial run as the baseline.');
  process.exit(1);
}

const baseline: BaselineFile = { noiseBand: previous.noiseBand, run };
fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
fs.writeFileSync(
  path.join(EVALS, 'scoreboard.md'),
  renderScoreboard(run, baseline),
);

console.log(`baseline.json  <- ${runFile}`);
console.log(
  `noise band carried over unchanged: ${JSON.stringify(previous.noiseBand)}`,
);
console.log('scoreboard.md regenerated via renderScoreboard');
