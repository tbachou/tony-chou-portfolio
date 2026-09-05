import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
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
    verdict: perDimensionVerdict.optional(),
    /**
     * Why this measured phase has no delta, and WHICH RUN it cannot be
     * compared against.
     *
     * The reason alone was not checkable. Three attempts tried to infer what
     * an entry "should" have been compared to — the current baseline, the
     * newest phase, a candidate set — and each inference was wrong in its own
     * way, because the manifest never recorded the answer. So the entry
     * records it: `notComparableTo` names a committed results file, and the
     * loader confirms it really is a different instrument. The claim becomes
     * self describing, verified against data rather than reconstructed, and
     * stable forever — appending a later phase or moving the baseline cannot
     * change whether this row was telling the truth.
     */
    deltaUnavailable: z
      .object({
        /**
         * Rendered in place of the delta. Trimmed before the length check,
         * because `min(1)` alone rejected only the empty string: a space
         * satisfied it, HTML collapsed it, and the page showed the bold
         * heading followed by nothing. `String.trim` then still left U+200B,
         * U+2060 and U+2800, so the rule is stated as what it means — at
         * least one letter or digit. Capped because it is inlined verbatim
         * into statically generated HTML.
         */
        reason: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .refine((value) => /[\p{L}\p{N}]/u.test(value), {
            message: 'must contain a visible reason, not only whitespace or invisible characters'
          }),
        /** A committed results file, relative to the evals directory. */
        notComparableTo: z.string().min(1)
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((entry, ctx) => {
    // The comparison facts are required exactly when there is a measurement,
    // and forbidden when there is not: a phase that took no run has nothing
    // to compare, and a row carrying a delta with no results file behind it
    // would be the transcription this whole design refuses.
    //
    // `delta` and `verdict` are the exception, and phase three is why. A run
    // can be fully measured and still have NOTHING to compare against, when
    // the phase changed the dataset: the golden set went from 22 cases to 27,
    // the dataset hash moved, and a delta across that boundary is arithmetic
    // between two different instruments. The two honest shapes are a delta or
    // a stated reason there is none. A zero delta is NOT one of them — it
    // asserts "nothing moved", which is a claim, and the page would publish it
    // as one.
    const alwaysWhenMeasured = ['resultsFile', 'noiseBand'] as const;
    const comparisonOnly = ['delta', 'verdict'] as const;

    for (const key of alwaysWhenMeasured) {
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

    for (const key of comparisonOnly) {
      const present = entry[key] !== undefined;
      if (!entry.measured && present) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `phase ${entry.phase} is not measured, so ${key} must be absent`
        });
      }
    }

    const hasReason = entry.deltaUnavailable !== undefined;

    // A half stated comparison reads as a delta with no verdict on the page.
    // Checked FIRST and made exclusive, because the shape rule below reads a
    // half state as "no comparison at all" and would then tell the author to
    // explain why there is no delta while a delta sits in their file. Being
    // told to add the wrong field is worse than being told nothing.
    const halfStated =
      entry.measured && (entry.delta === undefined) !== (entry.verdict === undefined);
    if (halfStated) {
      ctx.addIssue({
        code: 'custom',
        path: ['verdict'],
        message: `phase ${entry.phase} must carry delta and verdict together or neither`
      });
    }

    // Exactly one of the two honest shapes, never both and never neither.
    // Without this, dropping a delta would silently become a way to publish a
    // measured phase with no comparison and no explanation, which is the same
    // omission the noise band exists to prevent.
    const hasComparison = entry.delta !== undefined && entry.verdict !== undefined;
    if (entry.measured && !halfStated && hasComparison === hasReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['deltaUnavailable'],
        message: hasReason
          ? `phase ${entry.phase} carries both a delta and a reason there is none; give one or the other`
          : `phase ${entry.phase} is measured but has no delta/verdict, so deltaUnavailable must say why not (e.g. the dataset hash changed)`
      });
    }
    if (!entry.measured && hasReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['deltaUnavailable'],
        message: `phase ${entry.phase} is not measured, so deltaUnavailable must be absent`
      });
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
  .loose()
  // A dimension marked scored with no numeric score is the one shape where
  // this module and the eval runner's own aggregate() disagree: the runner
  // sums it into a NaN mean, this module drops it and counts a judge error.
  // The doc comment on aggregateDimension promises the two projections cannot
  // disagree, so the malformed input is refused by name instead.
  .refine((d) => d.status !== 'scored' || typeof d.score === 'number', {
    message: 'a dimension with status "scored" must carry a numeric score'
  });

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
    datasetHash: z.string().min(1),
    /**
     * The retrieval corpus (spec 0012 phase three, AC-11). Optional because
     * every run recorded before retrieval existed has none.
     */
    corpusHash: z.string().min(1).optional()
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
  corpusHash?: string;
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
    corpusHash: meta.corpusHash,
    perDimension
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/**
 * Resolves a manifest supplied path and refuses one that leaves its base.
 *
 * The three path fields are meant to be simple relative names inside the eval
 * record, but the schema cannot express that and `path.join` resolves `..`
 * without complaint, so `writeupFile: '../../../../etc/hosts'` read that file
 * and the page rendered it. The manifest is committed and hand edited, which
 * sounds like a closed trust boundary and is not: the repo is public, and CI
 * runs this loader on pull requests from forks.
 *
 * Refusing here rather than in the schema keeps the check at the read site,
 * so a caller that reaches a loader directly is covered too.
 *
 * The check runs TWICE, and the second time is the one that matters. Comparing
 * resolved strings stops `..`, and stops nothing else: a symlink committed
 * inside the eval record keeps a path that is textually contained while
 * pointing anywhere on disk, and `readFileSync` follows it without comment.
 * Git stores symlinks and recreates them on checkout, so that is a file a
 * fork pull request can add. So the resolved path is compared again after
 * `realpathSync`, which is what actually answers "which file will be read".
 */
function assertInside(base: string, candidate: string, relative: string, label: string): void {
  const fence = base.endsWith(path.sep) ? base : base + path.sep;
  if (candidate !== base && !candidate.startsWith(fence)) {
    throw new Error(
      `${label}: resolves outside ${base}: ${relative} (reads ${candidate}). ` +
        'These fields name files inside the eval record; a path that climbs out of it, ' +
        'directly or through a symlink, is refused.'
    );
  }
}

function containedPath(base: string, relative: string, label: string): string {
  // `path.resolve` always returns an absolute path, so the base has to be made
  // absolute too or the comparison is between different kinds of thing and
  // every legitimate file looks like an escape. A caller passing a relative
  // directory got "resolves outside" for a file plainly inside it, which is
  // the most alarming possible wording for the most benign input.
  const absoluteBase = path.resolve(base);
  const resolved = path.resolve(absoluteBase, relative);
  assertInside(absoluteBase, resolved, relative, label);
  // A path that does not exist yet is the caller's problem to report, and
  // realpathSync would throw a worse error than "writeupFile does not exist".
  // A broken symlink and a symlink loop both land here too: existsSync follows
  // links and returns false for either, so neither reaches realpathSync.
  if (!existsSync(resolved)) return resolved;
  // The base is resolved as well: on macOS a temporary directory is itself a
  // symlink (/var -> /private/var), so comparing a real path against a
  // symlinked base would reject every legitimate read.
  assertInside(realpathSync(absoluteBase), realpathSync(resolved), relative, label);
  return resolved;
}

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
  // Read once, not once per measured entry: the baseline cannot change while
  // this loop runs, and re reading it made the cost grow with the number of
  // published phases for no gain.
  const baseline = loadBaselineSummary(evalsDir);
  for (const entry of manifest.publishedRuns) {
    const label = `publishedRuns phase ${entry.phase}`;

    const writeup = containedPath(evalsDir, entry.writeupFile, `${label}: writeupFile`);
    if (!existsSync(writeup)) {
      throw new Error(`${label}: writeupFile does not exist: ${writeup}`);
    }

    const spec = containedPath(repoRoot, entry.specPath, `${label}: specPath`);
    if (!existsSync(spec)) {
      throw new Error(`${label}: specPath does not exist: ${spec}`);
    }

    if (!entry.measured) continue;

    const results = containedPath(evalsDir, entry.resultsFile as string, `${label}: resultsFile`);
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
    checkRecordedDelta(entry, summarise(run), baseline, evalsDir);
  }

  return manifest;
}

/**
 * Reads the current baseline once per manifest load. Returns null when there
 * is no baseline file at all, which is not an error: a repo can publish runs
 * before it has a baseline. A baseline that exists but is malformed still
 * throws, because that is a broken file rather than an absent one.
 */
function loadBaselineSummary(evalsDir: string): RunSummary | null {
  const baselinePath = path.join(evalsDir, 'baseline.json');
  if (!existsSync(baselinePath)) return null;
  const parsed = baselineFileSchema.safeParse(readJson(baselinePath, 'The baseline'));
  if (!parsed.success) {
    throw new Error(
      `The baseline is malformed: ${baselinePath}\n${z.prettifyError(parsed.error)}`
    );
  }
  return summarise(parsed.data.run);
}

/**
 * A recorded delta can only be re checked while the baseline it was measured
 * against is still the baseline in force. Once the dataset changes, the run
 * it was compared to is gone and the recorded value has to stand on its own,
 * which is why it is recorded at all.
 */
function checkRecordedDelta(
  entry: PublishedRun,
  run: RunSummary,
  baseline: RunSummary | null,
  evalsDir: string
): void {
  // An entry that publishes no delta still makes a CLAIM — "there was nothing
  // to compare" — and that claim is falsifiable, so it gets checked like any
  // other. Letting it through unchecked was the hole the pre-deploy gate
  // found: the same lie is caught when told as a number and passes when told
  // in prose, which is backwards, because the prose is what a reader believes.
  //
  // Falsifiable exactly when the baseline still in force scored the SAME
  // instrument and is a different run. The legitimate case this field exists
  // for is a phase that changed the dataset and thereby BECAME the baseline:
  // there, run and baseline agree on every hash and comparing the run to
  // itself would yield a meaningless zero. `gitCommit` plus `date` identify
  // that, and the committed record is exactly it — `baseline.json` is byte
  // identical to the phase three results file.
  if (entry.delta === undefined) {
    // The entry names the run it cannot be compared against, so this is one
    // comparison against committed data rather than a guess about which
    // baseline was in force. Three earlier versions inferred that and each
    // inference broke differently: keyed to the current baseline it accused an
    // untouched older row the moment the baseline advanced; keyed to the
    // newest phase the shield became an edit to the list, so appending a phase
    // silenced the row below it. Nothing here depends on position or on what
    // has happened since.
    const claim = entry.deltaUnavailable as { reason: string; notComparableTo: string };
    const againstPath = containedPath(
      evalsDir,
      claim.notComparableTo,
      `publishedRuns phase ${entry.phase}: deltaUnavailable.notComparableTo`
    );
    if (!existsSync(againstPath)) {
      throw new Error(
        `publishedRuns phase ${entry.phase}: deltaUnavailable.notComparableTo does not exist: ` +
          `${againstPath}. Name the committed results file this run cannot be compared against.`
      );
    }
    const against = summarise(
      parseResults(againstPath, `publishedRuns phase ${entry.phase}: its notComparableTo run`)
    );

    const sameInstrument =
      against.datasetHash === run.datasetHash &&
      !(
        against.corpusHash !== undefined &&
        run.corpusHash !== undefined &&
        against.corpusHash !== run.corpusHash
      );
    if (sameInstrument) {
      throw new Error(
        `publishedRuns phase ${entry.phase}: publishes no delta and names ${claim.notComparableTo} ` +
          'as the run it cannot be compared against, but that run scored the SAME dataset ' +
          `(${run.datasetHash.slice(0, 12)}…) and the same corpus, so the delta WAS computable. ` +
          'Publish delta and verdict, or name the run whose instrument actually differs.'
      );
    }
    return;
  }

  if (baseline === null) return;
  if (baseline === null) return;
  if (baseline.datasetHash !== run.datasetHash) return;
  // AC-11: two runs are comparable only when both hashes match. A run with no
  // corpusHash predates retrieval, and the committed baseline is one of those,
  // so a missing value means "unknown" and the delta stays checkable on the
  // dataset hash alone. Two runs that both name a corpus and disagree are not
  // comparable, and their recorded delta is not something to verify.
  if (
    baseline.corpusHash !== undefined &&
    run.corpusHash !== undefined &&
    baseline.corpusHash !== run.corpusHash
  ) {
    return;
  }

  for (const dimension of DIMENSIONS) {
    const runMean = run.perDimension[dimension].mean;
    const baselineMean = baseline.perDimension[dimension].mean;
    if (runMean === null || baselineMean === null) {
      // No mean means nothing to check against, so any recorded number here
      // would be published unverified. Refuse rather than accept it silently:
      // this function's whole job is that a recorded delta is either checked
      // or impossible.
      const recorded = (entry.delta as Record<Dimension, number>)[dimension];
      if (recorded !== 0) {
        throw new Error(
          `publishedRuns phase ${entry.phase}: recorded delta for ${dimension} is ${recorded}, ` +
            'but that dimension has no mean in the run or the baseline (every case errored), ' +
            'so the number cannot be checked. Record 0 or drop the phase from the manifest.'
        );
      }
      continue;
    }
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
  const label = `publishedRuns phase ${entry.phase}`;
  return summarise(
    parseResults(
      containedPath(evalsDir, entry.resultsFile, `${label}: resultsFile`),
      `${label}: its results file`
    )
  );
}

export function loadWriteup(entry: PublishedRun, evalsDir: string = EVALS_DIR): string {
  const absolute = containedPath(
    evalsDir,
    entry.writeupFile,
    `publishedRuns phase ${entry.phase}: writeupFile`
  );
  if (!existsSync(absolute)) {
    throw new Error(`publishedRuns phase ${entry.phase}: writeupFile does not exist: ${absolute}`);
  }
  return readFileSync(absolute, 'utf8');
}

/**
 * Whether a published row's scores can honestly be read next to the latest
 * ones (AC-4). Two runs are comparable only when they scored the same case
 * set: a changed dataset changes the hash, and comparing across one is how a
 * scoreboard tells a lie without anybody typing a wrong number.
 *
 * A phase that took no measurement is neither comparable nor incomparable.
 * It has no scores, so it carries no marker either.
 */
export function isComparable(run: RunSummary | null, latestDatasetHash: string): boolean {
  return run === null || run.datasetHash === latestDatasetHash;
}

/** The run a page's latest scores section is built from: the last measured entry (AC-3). */
export function latestMeasured(manifest: PublishedManifest): PublishedRun | undefined {
  return [...manifest.publishedRuns].reverse().find((entry) => entry.measured);
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
