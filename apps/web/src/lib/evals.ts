import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Build time reader for the committed interview eval record (spec 0012 phase
 * two). Server only, and reached only from statically generated pages.
 *
 * The rule this module exists to keep: a number on the public evals page is
 * either computed here from a committed results file, or recorded by hand in
 * `published.json` and checked against the baseline wherever that check is
 * still meaningful. Nothing is transcribed, so the most likely wrong number
 * cannot exist. When the record is inconsistent this throws and the build
 * fails, because a page arguing that the measurement is disciplined cannot
 * render a hole.
 *
 * Case level content never leaves this module. `loadRun` returns run metadata
 * and per dimension aggregates only, so the model authored turns in
 * `results/*.json` cannot reach the page payload even by accident (AC-9).
 */

export const DIMENSIONS = ['honesty', 'grounding', 'persona'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/**
 * AC-16: every read resolves from this one constant rather than from a path
 * assembled at each call site, so the read sites stay analysable.
 *
 * It is discovered by walking up from the working directory because the two
 * callers start in different places: `next build` runs in `apps/web`, and
 * `npm run check:evals` runs at the repo root. The walk stops at the manifest
 * itself, so a missing manifest is reported as a missing manifest rather than
 * as a mysterious path failure.
 */
const MANIFEST = 'published.json';
const REPO_RELATIVE_EVALS_DIR = 'docs/evals/interview';
const REPO_BLOB_BASE = 'https://github.com/tbachou/tony-chou-portfolio/blob';

export const EVALS_DIR = resolveEvalsDir();

function resolveEvalsDir(): string {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, REPO_RELATIVE_EVALS_DIR);
    if (existsSync(path.join(candidate, MANIFEST))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find ${REPO_RELATIVE_EVALS_DIR}/${MANIFEST} in any directory above ${process.cwd()}. ` +
          'The evals page reads the committed eval record at build time; it cannot render without it.'
      );
    }
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const perDimensionNumbers = z
  .object({ honesty: z.number(), grounding: z.number(), persona: z.number() })
  .strict();

const verdictValue = z.enum(['significant', 'not-significant']);

const perDimensionVerdict = z
  .object({ honesty: verdictValue, grounding: verdictValue, persona: verdictValue })
  .strict();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO date, e.g. 2026-08-30');

const publishedRunSchema = z
  .object({
    phase: z.number().int().positive(),
    phaseTitle: z.string().min(1),
    date: isoDate,
    measured: z.boolean(),
    resultsFile: z.string().min(1).optional(),
    writeupFile: z.string().min(1),
    specPath: z.string().min(1),
    delta: perDimensionNumbers.optional(),
    noiseBand: perDimensionNumbers.optional(),
    verdict: perDimensionVerdict.optional()
  })
  .strict()
  .superRefine((entry, ctx) => {
    // The comparison facts are required exactly when there is a measurement,
    // and forbidden when there is not: a phase that took no run has nothing
    // to compare, and a row carrying a delta with no results file behind it
    // would be the transcription this whole design refuses.
    const measuredOnly = ['resultsFile', 'delta', 'noiseBand', 'verdict'] as const;
    for (const key of measuredOnly) {
      const present = entry[key] !== undefined;
      if (entry.measured && !present) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `phase ${entry.phase} is measured, so ${key} is required`
        });
      }
      if (!entry.measured && present) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `phase ${entry.phase} is not measured, so ${key} must be absent`
        });
      }
    }
  });

const baselineHistoryEntrySchema = z
  .object({
    date: isoDate,
    cases: z.number().int().positive(),
    reason: z.string().min(1),
    detail: z.string().min(1).optional()
  })
  .strict();

const manifestSchema = z
  .object({
    _readMeFirst: z.string().optional(),
    publishedRuns: z.array(publishedRunSchema).min(1),
    baselineHistory: z.array(baselineHistoryEntrySchema).min(1)
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Set<number>();
    let previous = 0;
    manifest.publishedRuns.forEach((entry, index) => {
      if (seen.has(entry.phase)) {
        ctx.addIssue({
          code: 'custom',
          path: ['publishedRuns', index, 'phase'],
          message: `phase ${entry.phase} appears more than once`
        });
      }
      seen.add(entry.phase);
      if (entry.phase < previous) {
        ctx.addIssue({
          code: 'custom',
          path: ['publishedRuns', index, 'phase'],
          message: `phases must be in ascending order; ${entry.phase} follows ${previous}`
        });
      }
      previous = entry.phase;
    });
    if (!manifest.publishedRuns.some((entry) => entry.measured)) {
      ctx.addIssue({
        code: 'custom',
        path: ['publishedRuns'],
        message: 'at least one published run must be measured; the page has no scores otherwise'
      });
    }
  });

export type PublishedRun = z.infer<typeof publishedRunSchema>;
export type BaselineHistoryEntry = z.infer<typeof baselineHistoryEntrySchema>;
export type PublishedManifest = z.infer<typeof manifestSchema>;

const dimensionResultSchema = z
  .object({ status: z.string(), score: z.number().optional() })
  .loose();

const caseSchema = z
  .object({
    status: z.string(),
    dimensions: z
      .object({
        honesty: dimensionResultSchema.optional(),
        grounding: dimensionResultSchema.optional(),
        persona: dimensionResultSchema.optional()
      })
      .loose()
  })
  .loose();

const runMetaSchema = z
  .object({
    date: z.string().min(1),
    gitCommit: z.string().min(1),
    gitDirty: z.boolean(),
    provider: z.string().min(1),
    generatorModel: z.string().min(1),
    judgeModel: z.string().min(1),
    caseCount: z.number().int().nonnegative(),
    datasetHash: z.string().min(1)
  })
  .loose();

const resultsFileSchema = z
  .object({ meta: runMetaSchema, cases: z.array(caseSchema) })
  .loose();

const baselineFileSchema = z
  .object({ run: resultsFileSchema })
  .loose();

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type DimensionAggregate = {
  mean: number | null;
  scoredCases: number;
  judgeErrors: number;
};

export type RunSummary = {
  date: string;
  gitCommit: string;
  gitDirty: boolean;
  provider: string;
  generatorModel: string;
  judgeModel: string;
  caseCount: number;
  datasetHash: string;
  perDimension: Record<Dimension, DimensionAggregate>;
};

type ParsedResults = z.infer<typeof resultsFileSchema>;

/**
 * The mean rule, fixed by AC-3 and deliberately identical to the eval
 * runner's own `aggregate()` in `apps/api`: a dimension's mean is the
 * unweighted mean over cases where that dimension was scored, a judge error
 * leaves the denominator and is counted on its own, and a case that never
 * reached scoring contributes to nothing. Two projections of the same
 * committed data must not be able to disagree.
 */
function aggregateDimension(results: ParsedResults, dimension: Dimension): DimensionAggregate {
  const entries = results.cases
    .filter((c) => c.status === 'scored')
    .map((c) => c.dimensions[dimension])
    .filter((d): d is NonNullable<typeof d> => d !== undefined);
  const scored = entries.filter((d) => d.status === 'scored' && typeof d.score === 'number');
  const judgeErrors = entries.length - scored.length;
  const mean =
    scored.length === 0
      ? null
      : scored.reduce((sum, d) => sum + (d.score as number), 0) / scored.length;
  return { mean, scoredCases: scored.length, judgeErrors };
}

function summarise(results: ParsedResults): RunSummary {
  const perDimension = {} as Record<Dimension, DimensionAggregate>;
  for (const dimension of DIMENSIONS) perDimension[dimension] = aggregateDimension(results, dimension);
  const { meta } = results;
  return {
    date: meta.date,
    gitCommit: meta.gitCommit,
    gitDirty: meta.gitDirty,
    provider: meta.provider,
    generatorModel: meta.generatorModel,
    judgeModel: meta.judgeModel,
    caseCount: meta.caseCount,
    datasetHash: meta.datasetHash,
    perDimension
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function readJson(absolutePath: string, label: string): unknown {
  if (!existsSync(absolutePath)) {
    throw new Error(`${label} is missing: ${absolutePath}`);
  }
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (cause) {
    throw new Error(`${label} is not valid JSON: ${absolutePath}`, { cause });
  }
}

function parseResults(absolutePath: string, label: string): ParsedResults {
  const parsed = resultsFileSchema.safeParse(readJson(absolutePath, label));
  if (!parsed.success) {
    throw new Error(`${label} is malformed: ${absolutePath}\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/**
 * Reads, validates, and cross checks the publish manifest. Throws on every
 * inconsistency AC-2 names, always with the offending path in the message,
 * because the person reading the failure is the person who edited the file.
 */
export function loadPublished(evalsDir: string = EVALS_DIR): PublishedManifest {
  const manifestPath = path.join(evalsDir, MANIFEST);
  const parsed = manifestSchema.safeParse(readJson(manifestPath, 'The publish manifest'));
  if (!parsed.success) {
    throw new Error(
      `The publish manifest is malformed: ${manifestPath}\n${z.prettifyError(parsed.error)}`
    );
  }
  const manifest = parsed.data;

  const repoRoot = path.resolve(evalsDir, '..', '..', '..');
  for (const entry of manifest.publishedRuns) {
    const label = `publishedRuns phase ${entry.phase}`;

    const writeup = path.join(evalsDir, entry.writeupFile);
    if (!existsSync(writeup)) {
      throw new Error(`${label}: writeupFile does not exist: ${writeup}`);
    }

    const spec = path.join(repoRoot, entry.specPath);
    if (!existsSync(spec)) {
      throw new Error(`${label}: specPath does not exist: ${spec}`);
    }

    if (!entry.measured) continue;

    const results = path.join(evalsDir, entry.resultsFile as string);
    if (!existsSync(results)) {
      throw new Error(`${label}: resultsFile does not exist: ${results}`);
    }
    const run = parseResults(results, `${label}: its results file`);
    if (run.meta.gitDirty) {
      throw new Error(
        `${label}: ${entry.resultsFile} was measured from a dirty working tree (meta.gitDirty is true). ` +
          'A dirty run is never published; re run it on a committed tree.'
      );
    }
    checkRecordedDelta(entry, summarise(run), evalsDir);
  }

  return manifest;
}

/**
 * A recorded delta can only be re checked while the baseline it was measured
 * against is still the baseline in force. Once the dataset changes, the run
 * it was compared to is gone and the recorded value has to stand on its own,
 * which is why it is recorded at all.
 */
function checkRecordedDelta(entry: PublishedRun, run: RunSummary, evalsDir: string): void {
  const baselinePath = path.join(evalsDir, 'baseline.json');
  if (!existsSync(baselinePath)) return;
  const baselineParsed = baselineFileSchema.safeParse(readJson(baselinePath, 'The baseline'));
  if (!baselineParsed.success) {
    throw new Error(
      `The baseline is malformed: ${baselinePath}\n${z.prettifyError(baselineParsed.error)}`
    );
  }
  const baseline = summarise(baselineParsed.data.run);
  if (baseline.datasetHash !== run.datasetHash) return;

  for (const dimension of DIMENSIONS) {
    const runMean = run.perDimension[dimension].mean;
    const baselineMean = baseline.perDimension[dimension].mean;
    if (runMean === null || baselineMean === null) continue;
    const recomputed = round4(runMean - baselineMean);
    const recorded = round4((entry.delta as Record<Dimension, number>)[dimension]);
    if (recomputed !== recorded) {
      throw new Error(
        `publishedRuns phase ${entry.phase}: recorded delta for ${dimension} is ${recorded}, ` +
          `but the delta recomputed from the current baseline is ${recomputed}. ` +
          `The dataset hashes match (${run.datasetHash.slice(0, 12)}…), so this comparison is still ` +
          'checkable and one of the two numbers is wrong.'
      );
    }
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Run metadata and per dimension aggregates only. No case level field (AC-9). */
export function loadRun(entry: PublishedRun, evalsDir: string = EVALS_DIR): RunSummary {
  if (!entry.measured || !entry.resultsFile) {
    throw new Error(`publishedRuns phase ${entry.phase} took no measurement; it has no run to load`);
  }
  return summarise(
    parseResults(
      path.join(evalsDir, entry.resultsFile),
      `publishedRuns phase ${entry.phase}: its results file`
    )
  );
}

export function loadWriteup(entry: PublishedRun, evalsDir: string = EVALS_DIR): string {
  const absolute = path.join(evalsDir, entry.writeupFile);
  if (!existsSync(absolute)) {
    throw new Error(`publishedRuns phase ${entry.phase}: writeupFile does not exist: ${absolute}`);
  }
  return readFileSync(absolute, 'utf8');
}

// ---------------------------------------------------------------------------
// Provenance links
// ---------------------------------------------------------------------------

export type CommitRef = { sha: string; pinned: boolean };

/**
 * The commit every provenance link is pinned to. Vercel sets
 * `VERCEL_GIT_COMMIT_SHA` on every build; a local build falls back to git;
 * anything else falls back to `main` and says so on the page, because an
 * unpinned link is still useful and a silently unpinned one is not.
 */
export function resolveCommit(): CommitRef {
  const fromVercel = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromVercel) return { sha: fromVercel, pinned: true };
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: EVALS_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (sha) return { sha, pinned: true };
  } catch {
    // no git, or not a checkout: fall through to the unpinned base
  }
  return { sha: 'main', pinned: false };
}

/** A GitHub blob URL for a repo relative path, at the resolved commit. Never throws. */
export function blobUrl(repoPath: string, commit: CommitRef = resolveCommit()): string {
  const clean = repoPath.replace(/^\/+/, '');
  return `${REPO_BLOB_BASE}/${commit.sha}/${clean}`;
}

/** The repo relative path of something named relative to `docs/evals/interview/`. */
export function evalsRepoPath(relative: string): string {
  return path.posix.normalize(path.posix.join(REPO_RELATIVE_EVALS_DIR, relative));
}

export { REPO_RELATIVE_EVALS_DIR };
