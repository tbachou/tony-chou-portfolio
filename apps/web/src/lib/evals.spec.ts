import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIMENSIONS,
  blobUrl,
  evalsRepoPath,
  isComparable,
  latestMeasured,
  loadPublished,
  loadRun,
  loadWriteup,
  resolveCommit
} from './evals';

/**
 * The loader is the only thing standing between a mistyped manifest and a
 * wrong number on a public page, so these tests are about what it REFUSES,
 * not only what it reads. Each fixture is a whole eval record on disk,
 * because the rules being checked are cross file rules.
 */

const scored = (score: number) => ({ status: 'scored', score, reason: 'because' });

function caseRow(
  scores: Partial<Record<(typeof DIMENSIONS)[number], { status: string; score?: number }>>,
  status = 'scored'
) {
  return {
    caseId: 'some-case',
    difficulty: 'simple',
    status,
    interviewerQuestion: 'a question the model wrote',
    tonyRaw: 'a first person answer the model wrote',
    tonyEmitted: 'a first person answer the model wrote',
    honestyLayers: { guard: { ok: true, reason: null } },
    dimensions: {
      honesty: scored(1),
      grounding: scored(1),
      persona: scored(1),
      ...scores
    }
  };
}

function runFile(overrides: {
  datasetHash?: string;
  gitDirty?: boolean;
  cases?: ReturnType<typeof caseRow>[];
}) {
  return {
    _readMeFirst: 'model authored text, not a claim by Tony Chou',
    meta: {
      date: '2026-08-30T04:39:16.206Z',
      gitCommit: 'bf4c88e45bbf27aa092b1d7341bb3fa03726e75c',
      gitDirty: overrides.gitDirty ?? false,
      provider: 'anthropic',
      generatorModel: 'claude-sonnet-5',
      judgeModel: 'claude-haiku-4-5',
      caseCount: (overrides.cases ?? [caseRow({})]).length,
      datasetHash: overrides.datasetHash ?? 'hash-a',
      estimatedCostUsd: 0.19
    },
    cases: overrides.cases ?? [caseRow({})]
  };
}

const measuredEntry = {
  phase: 1,
  phaseTitle: 'Context engineering pass',
  date: '2026-08-30',
  measured: true,
  resultsFile: 'results/run.json',
  writeupFile: 'phase-one.md',
  specPath: 'docs/specs/_root/0012-grounded-portfolio-agent/0012-context-engineering-pass.md',
  delta: { honesty: 0, grounding: 0, persona: 0 },
  noiseBand: { honesty: 0.05, grounding: 0, persona: 0.05 },
  verdict: {
    honesty: 'not-significant',
    grounding: 'not-significant',
    persona: 'not-significant'
  }
};

const unmeasuredEntry = {
  phase: 2,
  phaseTitle: 'Public evals page',
  date: '2026-08-30',
  measured: false,
  writeupFile: 'phase-two.md',
  specPath: 'docs/specs/_root/0012-grounded-portfolio-agent/0012-public-evals-page.md'
};

const created: string[] = [];

/**
 * Builds a throwaway repo shaped like the real one: the evals directory three
 * levels below a root, so the loader's spec path resolution is exercised
 * rather than stubbed.
 */
function fixture(options: {
  manifest?: unknown;
  results?: unknown;
  baseline?: unknown;
  writeups?: string[];
  specs?: string[];
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'evals-fixture-'));
  created.push(root);
  const evalsDir = path.join(root, 'docs', 'evals', 'interview');
  mkdirSync(path.join(evalsDir, 'results'), { recursive: true });

  for (const writeup of options.writeups ?? ['phase-one.md', 'phase-two.md']) {
    writeFileSync(path.join(evalsDir, writeup), `# ${writeup}\n`);
  }
  for (const spec of options.specs ?? [
    measuredEntry.specPath,
    unmeasuredEntry.specPath
  ]) {
    const absolute = path.join(root, spec);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, '# spec\n');
  }
  if (options.results !== null) {
    writeFileSync(
      path.join(evalsDir, 'results', 'run.json'),
      JSON.stringify(options.results ?? runFile({}))
    );
  }
  if (options.baseline) {
    writeFileSync(path.join(evalsDir, 'baseline.json'), JSON.stringify(options.baseline));
  }
  writeFileSync(
    path.join(evalsDir, 'published.json'),
    JSON.stringify(
      options.manifest ?? {
        publishedRuns: [measuredEntry, unmeasuredEntry],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    )
  );
  return evalsDir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  while (created.length) rmSync(created.pop() as string, { recursive: true, force: true });
});

describe('loadPublished', () => {
  it('reads a manifest with a measured and an unmeasured phase (AC-3, AC-4)', () => {
    const dir = fixture({});
    const manifest = loadPublished(dir);

    expect(manifest.publishedRuns).toHaveLength(2);
    expect(latestMeasured(manifest)?.phase).toBe(1);
    expect(manifest.publishedRuns[1].measured).toBe(false);
    expect(manifest.publishedRuns[1].delta).toBeUndefined();
    expect(manifest.baselineHistory[0].cases).toBe(20);
  });

  it('rejects a recorded delta that disagrees with the current baseline (AC-2)', () => {
    const dir = fixture({
      results: runFile({ datasetHash: 'hash-a', cases: [caseRow({ persona: scored(1) })] }),
      baseline: {
        noiseBand: { honesty: 0, grounding: 0, persona: 0 },
        run: runFile({ datasetHash: 'hash-a', cases: [caseRow({ persona: scored(0) })] })
      }
    });

    // The run scores persona 1 against a baseline of 0, so the real delta is
    // +1 while the manifest records 0.
    expect(() => loadPublished(dir)).toThrow(/recorded delta for persona is 0.*recomputed.*is 1/s);
  });

  it('leaves a recorded delta alone when the dataset hash has moved on (AC-2)', () => {
    const dir = fixture({
      results: runFile({ datasetHash: 'hash-a', cases: [caseRow({ persona: scored(1) })] }),
      baseline: {
        noiseBand: { honesty: 0, grounding: 0, persona: 0 },
        run: runFile({ datasetHash: 'hash-b', cases: [caseRow({ persona: scored(0) })] })
      }
    });

    expect(() => loadPublished(dir)).not.toThrow();
  });

  it('refuses a manifest entry whose writeup does not exist (AC-2)', () => {
    const dir = fixture({ writeups: ['phase-two.md'] });
    expect(() => loadPublished(dir)).toThrow(/phase 1: writeupFile does not exist.*phase-one\.md/s);
  });

  it('refuses a manifest entry whose spec does not exist (AC-2)', () => {
    const dir = fixture({ specs: [unmeasuredEntry.specPath] });
    expect(() => loadPublished(dir)).toThrow(/phase 1: specPath does not exist/);
  });

  it('refuses a run measured from a dirty working tree (AC-2)', () => {
    const dir = fixture({ results: runFile({ gitDirty: true }) });
    expect(() => loadPublished(dir)).toThrow(/dirty working tree/);
  });

  it('refuses a measured entry with no comparison facts (AC-2)', () => {
    const { delta: _delta, ...withoutDelta } = measuredEntry;
    const dir = fixture({
      manifest: {
        publishedRuns: [withoutDelta],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow(/is measured, so delta is required/);
  });

  it('refuses an unmeasured entry that carries scores anyway (AC-2)', () => {
    const dir = fixture({
      manifest: {
        publishedRuns: [{ ...unmeasuredEntry, delta: { honesty: 1, grounding: 1, persona: 1 } }],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow(/is not measured, so delta must be absent/);
  });

  it('names the manifest path when the file is missing (AC-2)', () => {
    const dir = path.join(tmpdir(), 'evals-fixture-absent');
    expect(() => loadPublished(dir)).toThrow(/publish manifest is missing.*published\.json/s);
  });
});

describe('comparability and the latest row', () => {
  it('marks a measured run on a different case set as not comparable (AC-4)', () => {
    const dir = fixture({});
    const manifest = loadPublished(dir);
    const latest = latestMeasured(manifest) as (typeof manifest.publishedRuns)[number];
    const run = loadRun(latest, dir);

    expect(isComparable(run, run.datasetHash)).toBe(true);
    expect(isComparable(run, 'some-other-hash')).toBe(false);
  });

  it('gives an unmeasured row no comparability marker at all (AC-4)', () => {
    // It has no scores to compare, so "not comparable" would be a claim
    // about a measurement that was never taken.
    expect(isComparable(null, 'any-hash')).toBe(true);
  });

  it('builds the latest scores from the last measured entry, not the last entry (AC-3)', () => {
    const dir = fixture({});
    const manifest = loadPublished(dir);

    expect(manifest.publishedRuns.at(-1)?.phase).toBe(2);
    expect(latestMeasured(manifest)?.phase).toBe(1);
  });
});

describe('loadRun', () => {
  it('excludes a judge error from the denominator and counts it separately (AC-3)', () => {
    const dir = fixture({
      results: runFile({
        cases: [
          caseRow({ honesty: scored(1) }),
          caseRow({ honesty: { status: 'judge_error' } }),
          caseRow({ honesty: scored(0) })
        ]
      })
    });
    const run = loadRun(loadPublished(dir).publishedRuns[0], dir);

    // Two cases scored honesty, one errored: the mean is over the two, and
    // the error is reported rather than folded into the denominator, exactly
    // as the eval runner's own aggregate() does it.
    expect(run.perDimension.honesty).toEqual({ mean: 0.5, scoredCases: 2, judgeErrors: 1 });
    expect(run.perDimension.grounding).toEqual({ mean: 1, scoredCases: 3, judgeErrors: 0 });
  });

  it('drops a case that never reached scoring from every dimension (AC-3)', () => {
    const dir = fixture({
      results: runFile({
        cases: [caseRow({}), caseRow({}, 'generation_error')]
      })
    });
    const run = loadRun(loadPublished(dir).publishedRuns[0], dir);
    expect(run.perDimension.persona.scoredCases).toBe(1);
  });

  it('returns run metadata and aggregates only, never case level content (AC-9)', () => {
    const dir = fixture({});
    const run = loadRun(loadPublished(dir).publishedRuns[0], dir);

    expect(Object.keys(run).sort()).toEqual([
      'caseCount',
      'datasetHash',
      'date',
      'generatorModel',
      'gitCommit',
      'gitDirty',
      'judgeModel',
      'perDimension',
      'provider'
    ]);
    const serialized = JSON.stringify(run);
    for (const leaked of ['interviewerQuestion', 'tonyRaw', 'tonyEmitted', 'honestyLayers', 'reason']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('refuses to load a run for a phase that took no measurement', () => {
    const dir = fixture({});
    const unmeasured = loadPublished(dir).publishedRuns[1];
    expect(() => loadRun(unmeasured, dir)).toThrow(/took no measurement/);
  });
});

describe('loadWriteup', () => {
  it('reads the committed markdown for a phase', () => {
    const dir = fixture({});
    expect(loadWriteup(loadPublished(dir).publishedRuns[0], dir)).toContain('phase-one.md');
  });
});

/**
 * These fields name files inside the eval record. Nothing stops a manifest
 * from naming a file outside it, and `path.join` resolves `..` happily, so
 * before this check a writeupFile of `../../../../etc/hosts` read that file
 * and the page rendered its contents. The manifest is committed and hand
 * edited, but the repo is public and CI runs this loader on pull requests
 * from forks, so the trust boundary is not "only the owner edits it".
 */
describe('unverifiable numbers', () => {
  it('refuses a recorded delta for a dimension that has no mean at all', () => {
    // Every case errored on grounding, so there is no mean in either run and
    // nothing to recompute against. Accepting the recorded number would
    // publish it unchecked, which is the one thing this loader must not do.
    const errored = caseRow({ grounding: { status: 'judge_error' } });
    const dir = fixture({
      manifest: {
        publishedRuns: [
          { ...measuredEntry, delta: { honesty: 0, grounding: -99, persona: 0 } },
          unmeasuredEntry
        ],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      },
      results: runFile({ datasetHash: 'hash-a', cases: [errored] }),
      baseline: {
        noiseBand: { honesty: 0, grounding: 0, persona: 0 },
        run: runFile({ datasetHash: 'hash-a', cases: [errored] })
      }
    });
    expect(() => loadPublished(dir)).toThrow(/has no mean.*cannot be checked/s);
  });

  it('refuses a results file whose dimension is scored with no numeric score', () => {
    // This is the only input where this module and the eval runner's own
    // aggregate() produce different means, so it is rejected by name.
    const dir = fixture({
      results: runFile({ cases: [caseRow({ persona: { status: 'scored' } })] })
    });
    expect(() => loadPublished(dir)).toThrow(/numeric score/);
  });
});

describe('path containment', () => {
  const withEntry = (overrides: Record<string, unknown>) => ({
    publishedRuns: [{ ...measuredEntry, ...overrides }, unmeasuredEntry],
    baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
  });

  it('refuses a writeupFile that climbs out of the evals directory', () => {
    const dir = fixture({ manifest: withEntry({ writeupFile: '../../../../../../etc/hosts' }) });
    expect(() => loadPublished(dir)).toThrow(/outside/i);
  });

  it('refuses an absolute writeupFile', () => {
    const dir = fixture({ manifest: withEntry({ writeupFile: '/etc/hosts' }) });
    expect(() => loadPublished(dir)).toThrow(/outside/i);
  });

  it('refuses a resultsFile that climbs out', () => {
    const dir = fixture({ manifest: withEntry({ resultsFile: '../../../../../../etc/hosts' }) });
    expect(() => loadPublished(dir)).toThrow(/outside/i);
  });

  it('refuses a specPath that climbs out of the repo root', () => {
    const dir = fixture({ manifest: withEntry({ specPath: '../../../../../../../etc/hosts' }) });
    expect(() => loadPublished(dir)).toThrow(/outside/i);
  });

  it('refuses through loadWriteup directly, not only through loadPublished', () => {
    // loadWriteup is exported and called per row by the page, so the check has
    // to live at the read site rather than only in the manifest pass.
    const dir = fixture({});
    const entry = { ...loadPublished(dir).publishedRuns[0], writeupFile: '../../../etc/hosts' };
    expect(() => loadWriteup(entry, dir)).toThrow(/outside/i);
  });

  it('refuses through loadRun directly as well', () => {
    const dir = fixture({});
    const entry = { ...loadPublished(dir).publishedRuns[0], resultsFile: '../../../etc/hosts' };
    expect(() => loadRun(entry, dir)).toThrow(/outside/i);
  });

  it('still allows the ordinary nested paths the real record uses', () => {
    expect(() => loadPublished(fixture({}))).not.toThrow();
  });
});

describe('provenance links', () => {
  it('pins to the Vercel build commit when one is set (AC-7)', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'abc123');
    expect(resolveCommit()).toEqual({ sha: 'abc123', pinned: true });
    expect(blobUrl('docs/evals/interview/published.json')).toBe(
      'https://github.com/tbachou/tony-chou-portfolio/blob/abc123/docs/evals/interview/published.json'
    );
  });

  it('falls back to an unpinned main URL when neither Vercel nor git answers (AC-7)', () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    const commit = { sha: 'main', pinned: false };
    expect(blobUrl('/docs/evals/interview/baseline.json', commit)).toBe(
      'https://github.com/tbachou/tony-chou-portfolio/blob/main/docs/evals/interview/baseline.json'
    );
    expect(commit.pinned).toBe(false);
  });

  it('resolves a path named relative to the evals directory (AC-7)', () => {
    expect(evalsRepoPath('results/run.json')).toBe('docs/evals/interview/results/run.json');
    expect(evalsRepoPath('../../specs/_root/0011.md')).toBe('docs/specs/_root/0011.md');
  });
});
