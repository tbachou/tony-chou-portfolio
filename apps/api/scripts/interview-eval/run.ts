/**
 * Interview simulator eval suite — CLI entry (spec 0011, AC-1).
 *
 *   npm run eval:interview --workspace=apps/api -- --cases 2     # smoke run
 *   npm run eval:interview --workspace=apps/api                  # full set
 *   npm run eval:interview -- --concurrency 3 --max-cost 1.5
 *   npm run eval:interview -- --save-baseline --noise-from docs/evals/interview/results/<prior>.json
 *
 * Runs the golden dataset through the production `generateTurnPair` path
 * (real model calls, persistence mocked, no HTTP server, no database), writes
 * a results JSON file and regenerates the scoreboard markdown. Costs real
 * API spend, bounded by --max-cost (default 2 USD).
 *
 * Thin by design: flag parsing, env loading, and orchestration only. The
 * testable logic lives in `src/modules/conversation/eval/`; the per case
 * execution lives in `harness.ts`.
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

loadEnv({ path: path.resolve(__dirname, '..', '..', '.env') });

import { AnthropicService } from '../../src/modules/anthropic/anthropic.service';
import { BedrockAnthropicService } from '../../src/modules/anthropic/bedrock-anthropic.service';
import {
  resolveConfiguredProvider,
  type AiProvider,
} from '../../src/modules/anthropic/ai-provider.interface';
import { hashDataset } from '../../src/modules/conversation/eval/dataset-hash';
import {
  estimateCostUsd,
  PRICE_TABLE,
} from '../../src/modules/conversation/eval/pricing';
import { aggregate } from '../../src/modules/conversation/eval/aggregate';
import { computeNoiseBand } from '../../src/modules/conversation/eval/baseline';
import { renderScoreboard } from '../../src/modules/conversation/eval/scoreboard';
import {
  RESULTS_PROVENANCE,
  type BaselineFile,
  type CaseResult,
  type RunResults,
  type TokenTotals,
} from '../../src/modules/conversation/eval/eval-types';
import { selectCases } from '../../src/modules/conversation/eval/select-cases';
import { GOLDEN_CASES, type EvalCase } from './golden';
import { datasetHashPayload, runCase } from './harness';
import { JUDGE_MODEL } from './scorers/judge-client';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/**
 * Numeric flag with validation: a malformed value must fail loudly, never
 * silently disable a bound (NaN compares false against everything, which
 * would turn off --max-cost, and NaN workers would run zero cases "green").
 */
function numFlag(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.error(`❌ --${name} needs a number, got "${raw}"`);
    process.exit(1);
  }
  return value;
}

/** Parses a results/baseline JSON with a loud, named failure (never a raw stack). */
function readJsonFile<T>(filePath: string, label: string): T {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    console.error(`❌ cannot read ${label}: ${filePath}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error(
      `❌ ${label} is not valid JSON (hand edit or merge conflict?): ${filePath}`,
    );
    process.exit(1);
  }
}

function gitInfo(): { commit: string; dirty: boolean } {
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    // The dirty flag answers "did the code that ran differ from this
    // commit?" — so it counts tracked modifications only, and ignores the
    // suite's own outputs under docs/evals (results, scoreboard, baseline),
    // which every run rewrites but which cannot change behavior.
    const dirty = execSync('git status --porcelain --untracked-files=no', {
      encoding: 'utf8',
    })
      .split('\n')
      .some((line) => line.trim().length > 0 && !line.includes('docs/evals/'));
    return { commit, dirty };
  } catch {
    return { commit: 'unknown', dirty: false };
  }
}

function resultsFileName(commit: string, dirty: boolean, dir: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const base = `${date}-${commit.slice(0, 7)}${dirty ? '-dirty' : ''}`;
  let name = `${base}.json`;
  for (let n = 1; fs.existsSync(path.join(dir, name)); n += 1) {
    name = `${base}-${n}.json`;
  }
  return name;
}

async function main(): Promise<void> {
  const providerFlag = arg('provider');
  if (process.env.AI_PROVIDER === 'bedrock' && !providerFlag) {
    console.error(
      '❌ AI_PROVIDER=bedrock is set. The eval suite pins the direct Anthropic API; pass --provider bedrock explicitly to run a Bedrock comparison.',
    );
    process.exit(1);
  }
  process.env.AI_PROVIDER = providerFlag ?? 'anthropic';

  // The no-key CI skip lives in the workflow's bash guard (one owner); here a
  // missing key is always a hard failure before any model call (AC-1).
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is not set (looked in apps/api/.env)');
    process.exit(1);
  }

  const caseCap = numFlag('cases', GOLDEN_CASES.length);
  const concurrency = Math.max(1, numFlag('concurrency', 2));
  const maxCostUsd = numFlag('max-cost', 2);
  const outDir = path.resolve(
    arg('out') ?? path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'evals', 'interview'),
  );

  const cases: EvalCase[] = selectCases(GOLDEN_CASES, caseCap);

  const { provider: providerName, model: generatorModel } =
    resolveConfiguredProvider();

  // --max-cost can only bind when every model in play is priced; say so
  // up front rather than letting the cap be silently inert (a Bedrock
  // comparison run is exactly the case with invisible spend).
  const unpriced = [generatorModel, JUDGE_MODEL].filter((m) => !PRICE_TABLE[m]);
  if (unpriced.length > 0) {
    console.warn(
      `⚠ not in the price table: ${unpriced.join(', ')} — cost cannot be estimated and --max-cost will NOT abort this run.`,
    );
  }
  const provider: AiProvider =
    providerName === 'bedrock'
      ? new BedrockAnthropicService()
      : new AnthropicService();

  const datasetHash = hashDataset(datasetHashPayload(GOLDEN_CASES));
  const { commit, dirty } = gitInfo();

  console.log(
    `Running ${cases.length}/${GOLDEN_CASES.length} case(s) · generator ${providerName}/${generatorModel} · judge ${JUDGE_MODEL} · concurrency ${concurrency} · max cost $${maxCostUsd}\n`,
  );

  const tokensByModel: Record<string, TokenTotals> = {
    [generatorModel]: { inputTokens: 0, outputTokens: 0 },
    [JUDGE_MODEL]: { inputTokens: 0, outputTokens: 0 },
  };
  const results: CaseResult[] = [];
  let aborted = false;

  const queue = [...cases];
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const cost = estimateCostUsd(tokensByModel);
      if (cost !== null && cost > maxCostUsd) {
        aborted = true;
        return;
      }
      const evalCase = queue.shift();
      if (!evalCase) return;
      try {
        const outcome = await runCase(provider, evalCase);
        tokensByModel[generatorModel].inputTokens +=
          outcome.generatorUsage.inputTokens;
        tokensByModel[generatorModel].outputTokens +=
          outcome.generatorUsage.outputTokens;
        tokensByModel[JUDGE_MODEL].inputTokens +=
          outcome.judgeUsage.inputTokens;
        tokensByModel[JUDGE_MODEL].outputTokens +=
          outcome.judgeUsage.outputTokens;
        results.push(outcome.result);
        logCase(outcome.result);
      } catch (error) {
        results.push({
          caseId: evalCase.id,
          difficulty: evalCase.difficulty,
          category: evalCase.category,
          status: 'generation_error',
          questionSource: evalCase.injectQuestion ? 'injected' : 'generated',
          interviewerQuestion: null,
          tonyRaw: null,
          tonyEmitted: null,
          guardFired: false,
          dimensions: {},
          // Error name only, never the raw message: this lands in a
          // committed public results file (apps/api convention).
          generationError: `harness threw: ${error instanceof Error ? error.name : 'unknown error'}`,
        });
        console.log(
          `💥 ${evalCase.id} threw: ${error instanceof Error ? error.name : 'unknown error'}`,
        );
      }
    }
  });
  await Promise.all(workers);

  if (aborted) {
    console.log(
      `\n⚠ Run aborted: estimated cost exceeded --max-cost $${maxCostUsd}. Results are partial.`,
    );
  }

  const tokenTotals = Object.values(tokensByModel).reduce(
    (sum, t) => ({
      inputTokens: sum.inputTokens + t.inputTokens,
      outputTokens: sum.outputTokens + t.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );

  const run: RunResults = {
    _readMeFirst: RESULTS_PROVENANCE,
    meta: {
      date: new Date().toISOString(),
      gitCommit: commit,
      gitDirty: dirty,
      provider: providerName,
      generatorModel,
      judgeModel: JUDGE_MODEL,
      caseCount: results.length,
      datasetHash,
      tokensByModel,
      tokenTotals,
      estimatedCostUsd: estimateCostUsd(tokensByModel),
      aborted,
      partial: aborted || results.length < GOLDEN_CASES.length,
    },
    cases: results,
  };

  const resultsDir = path.join(outDir, 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const fileName = resultsFileName(commit, dirty, resultsDir);
  const resultsPath = path.join(resultsDir, fileName);
  fs.writeFileSync(resultsPath, `${JSON.stringify(run, null, 2)}\n`);
  console.log(`\nWrote ${resultsPath}`);

  const baselinePath = path.join(outDir, 'baseline.json');
  let baseline: BaselineFile | null = null;
  if (fs.existsSync(baselinePath)) {
    baseline = readJsonFile<BaselineFile>(baselinePath, 'baseline.json');
    if (!baseline.run?.meta || !Array.isArray(baseline.run.cases)) {
      console.error(
        `❌ baseline.json has no run.meta/run.cases; restore it from git before comparing: ${baselinePath}`,
      );
      process.exit(1);
    }
  }

  // --save-baseline: a deliberate local step (AC-9); CI never passes it.
  if (process.argv.includes('--save-baseline')) {
    if (run.meta.partial) {
      console.error(
        '❌ refusing --save-baseline on a partial run (capped or aborted): the baseline must be a full-set run.',
      );
      process.exit(1);
    }
    const noiseFrom = arg('noise-from');
    let noiseBand = baseline?.noiseBand ?? null;
    if (noiseFrom) {
      // The npm script runs with cwd = apps/api; accept a path relative to
      // either the cwd or the repo root.
      const candidates = [
        path.resolve(noiseFrom),
        path.resolve(__dirname, '..', '..', '..', '..', noiseFrom),
      ];
      const noisePath = candidates.find((p) => fs.existsSync(p));
      if (!noisePath) {
        console.error(`❌ --noise-from file not found: ${noiseFrom}`);
        process.exit(1);
      }
      const other = readJsonFile<RunResults>(noisePath, '--noise-from run');
      if (!other.meta || !Array.isArray(other.cases)) {
        console.error(`❌ --noise-from file has no meta/cases: ${noisePath}`);
        process.exit(1);
      }
      if (other.meta.datasetHash !== datasetHash) {
        console.error(
          '❌ --noise-from run has a different dataset hash; the noise band must come from two identical runs.',
        );
        process.exit(1);
      }
      if (other.meta.partial) {
        console.error(
          '❌ --noise-from run is partial; the noise band must come from two full runs.',
        );
        process.exit(1);
      }
      noiseBand = computeNoiseBand(run, other);
    }
    baseline = { noiseBand, run };
    fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Wrote ${baselinePath} (commit it deliberately)`);
  }

  const scoreboardPath = path.join(outDir, 'scoreboard.md');
  fs.writeFileSync(scoreboardPath, renderScoreboard(run, baseline));
  console.log(`Wrote ${scoreboardPath}\n`);

  printSummary(run);
}

function logCase(result: CaseResult): void {
  if (result.status === 'generation_error') {
    console.log(`💥 ${result.caseId.padEnd(28)} generation_error  ${result.generationError ?? ''}`);
    return;
  }
  const scores = (['honesty', 'grounding', 'persona'] as const)
    .map((d) => {
      const r = result.dimensions[d];
      if (!r) return `${d}:—`;
      return r.status === 'scored' ? `${d}:${r.score}` : `${d}:ERR`;
    })
    .join(' ');
  const guard = result.guardFired ? '  🚨 guard fired' : '';
  console.log(`✅ ${result.caseId.padEnd(28)} ${scores}${guard}`);
}

function printSummary(run: RunResults): void {
  const agg = aggregate(run.cases);
  console.log('──────── aggregate ────────');
  for (const [dimension, a] of Object.entries(agg.perDimension)) {
    console.log(
      `${dimension.padEnd(10)} mean=${a.mean === null ? '—' : a.mean.toFixed(2)}  scored=${a.scoredCases}  judge_errors=${a.judgeErrors}`,
    );
  }
  if (agg.generationErrors.length > 0) {
    console.log(`generation_errors: ${agg.generationErrors.join(', ')}`);
  }
  console.log(
    `estimated cost: ${
      run.meta.estimatedCostUsd === null
        ? 'n/a'
        : `$${run.meta.estimatedCostUsd.toFixed(4)}`
    }`,
  );
}

void main();
