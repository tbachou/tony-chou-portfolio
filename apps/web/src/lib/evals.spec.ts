import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  corpusHash?: string;
  gitDirty?: boolean;
  gitCommit?: string;
  date?: string;
  cases?: ReturnType<typeof caseRow>[];
}) {
  return {
    _readMeFirst: 'model authored text, not a claim by Tony Chou',
    meta: {
      date: overrides.date ?? '2026-08-30T04:39:16.206Z',
      gitCommit: overrides.gitCommit ?? 'bf4c88e45bbf27aa092b1d7341bb3fa03726e75c',
      gitDirty: overrides.gitDirty ?? false,
      provider: 'anthropic',
      generatorModel: 'claude-sonnet-5',
      judgeModel: 'claude-haiku-4-5',
      caseCount: (overrides.cases ?? [caseRow({})]).length,
      datasetHash: overrides.datasetHash ?? 'hash-a',
      ...(overrides.corpusHash !== undefined && { corpusHash: overrides.corpusHash }),
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
  /** Extra results files by name, for manifests with more than one run. */
  extraResults?: Record<string, unknown>;
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
  // Always present, on a genuinely different instrument, so a fixture that
  // states an honest "cannot be compared" claim has something true to name.
  writeFileSync(
    path.join(evalsDir, 'results', 'other.json'),
    JSON.stringify(runFile({ datasetHash: 'hash-OTHER', corpusHash: 'corpus-OTHER' }))
  );
  for (const [name, body] of Object.entries(options.extraResults ?? {})) {
    writeFileSync(path.join(evalsDir, 'results', name), JSON.stringify(body));
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
    const { resultsFile: _resultsFile, ...withoutResults } = measuredEntry;
    const dir = fixture({
      manifest: {
        publishedRuns: [withoutResults],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow(/is measured, so resultsFile is required/);
  });

  it('refuses a measured entry that drops the delta without saying why', () => {
    // Dropping a delta must not become a quiet way to publish a measured phase
    // with no comparison and no explanation.
    const { delta: _delta, verdict: _verdict, ...withoutComparison } = measuredEntry;
    const dir = fixture({
      manifest: {
        publishedRuns: [withoutComparison],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow(/deltaUnavailable must say why not/);
  });

  it('accepts a measured phase that states why it has no delta (phase three)', () => {
    // A phase that CHANGES the dataset has nothing to compare against. The
    // honest record is a stated reason, not a zero delta, which would publish
    // "nothing moved" as a measured claim.
    const { delta: _delta, verdict: _verdict, ...rest } = measuredEntry;
    const dir = fixture({
      manifest: {
        publishedRuns: [
          {
            ...rest,
            deltaUnavailable: { reason: 'the golden set went from 22 cases to 27, so the dataset hash changed', notComparableTo: 'results/other.json' }
          }
        ],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    const manifest = loadPublished(dir);
    expect(manifest.publishedRuns[0].delta).toBeUndefined();
    expect(manifest.publishedRuns[0].verdict).toBeUndefined();
    expect(manifest.publishedRuns[0].deltaUnavailable?.reason).toMatch(/dataset hash changed/);
  });

  /**
   * The exploit the pre-deploy gate's adversarial pass confirmed, landed as
   * the specification before the fix.
   *
   * `deltaUnavailable` is prose where `delta` is a number, and a number is
   * falsifiable: `checkRecordedDelta` recomputes it and refuses a mismatch.
   * The reason had no such check, so the same lie told in words passed where
   * told as a figure it was caught. That is not a hypothetical: it hides a
   * real regression behind "not comparable" on a page whose whole argument is
   * that a published number cannot drift from the record.
   */
  /**
   * The claim `deltaUnavailable` makes is "no delta was computable", and it
   * names the run it could not be computed against. That name is what makes it
   * checkable: the loader opens that committed file and confirms the
   * instrument really differs.
   *
   * Three earlier versions tried to INFER the run instead — the current
   * baseline, the newest phase, a candidate set — and each inference broke
   * differently. These cases are the failures those versions allowed, kept so
   * the inference cannot come back.
   */
  describe('the run a phase says it cannot be compared against', () => {
    const claiming = (notComparableTo: string) => {
      const { delta: _delta, verdict: _verdict, ...rest } = measuredEntry;
      return {
        ...rest,
        deltaUnavailable: {
          reason: 'The golden set grew from 22 cases to 27, so no comparison is possible.',
          notComparableTo
        }
      };
    };
    const history = [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }];

    it('accepts a claim naming a run whose instrument genuinely differs', () => {
      const dir = fixture({
        manifest: { publishedRuns: [claiming('results/other.json')], baselineHistory: history }
      });
      expect(() => loadPublished(dir)).not.toThrow();
    });

    it('refuses a claim naming a run that scored the SAME instrument', () => {
      // The original exploit: a real regression published behind "not
      // comparable" while the two runs share both hashes.
      const dir = fixture({
        manifest: { publishedRuns: [claiming('results/twin.json')], baselineHistory: history },
        results: runFile({
          datasetHash: 'hash-SAME',
          corpusHash: 'corpus-SAME',
          cases: [caseRow({ honesty: scored(0), grounding: scored(0), persona: scored(0) })]
        }),
        extraResults: {
          'twin.json': runFile({ datasetHash: 'hash-SAME', corpusHash: 'corpus-SAME' })
        }
      });
      expect(() => loadPublished(dir)).toThrow(/scored the SAME dataset/);
    });

    it('is not silenced by appending a later measured phase', () => {
      // The hole in the version scoped to "the newest measured phase": the
      // shield was an edit to the list rather than a fact about the run, and
      // both rows could be written in one commit. Position is now irrelevant.
      const dir = fixture({
        manifest: {
          publishedRuns: [
            claiming('results/twin.json'),
            {
              ...measuredEntry,
              phase: 4,
              phaseTitle: 'A later phase',
              writeupFile: 'phase-two.md',
              specPath: unmeasuredEntry.specPath,
              resultsFile: 'results/later.json'
            }
          ],
          baselineHistory: history
        },
        results: runFile({ datasetHash: 'hash-SAME', corpusHash: 'corpus-SAME' }),
        extraResults: {
          'twin.json': runFile({ datasetHash: 'hash-SAME', corpusHash: 'corpus-SAME' }),
          'later.json': runFile({ datasetHash: 'hash-MOVED' })
        }
      });
      expect(() => loadPublished(dir)).toThrow(/scored the SAME dataset/);
    });

    it('is not silenced by the baseline moving on afterwards', () => {
      // The time bomb in the version keyed to "is this run the current
      // baseline": an untouched older row must neither start failing nor stop
      // being checked when a later baseline lands. Here the claim is TRUE, so
      // it stays accepted no matter what the baseline does.
      const dir = fixture({
        manifest: { publishedRuns: [claiming('results/other.json')], baselineHistory: history },
        baseline: {
          noiseBand: { honesty: 0.05, grounding: 0.05, persona: 0.05 },
          run: runFile({
            datasetHash: 'hash-a',
            gitCommit: '9999999000000000000000000000000000000000',
            date: '2026-09-10T00:00:00.000Z'
          })
        }
      });
      expect(() => loadPublished(dir)).not.toThrow();
    });




    it('refuses a claim naming a file that does not exist', () => {
      const dir = fixture({
        manifest: { publishedRuns: [claiming('results/nope.json')], baselineHistory: history }
      });
      expect(() => loadPublished(dir)).toThrow(/notComparableTo does not exist/);
    });

    it('refuses a claim pointing outside the evals directory', () => {
      const dir = fixture({
        manifest: {
          publishedRuns: [claiming('../../../etc/passwd')],
          baselineHistory: history
        }
      });
      expect(() => loadPublished(dir)).toThrow();
    });

    it('still refuses the same lie when it is told as a number rather than prose', () => {
      // The control that made this a finding rather than a nitpick: told as a
      // number it was always caught, and the gap between the two is what the
      // whole mechanism closes.
      const dir = fixture({
        manifest: {
          publishedRuns: [{ ...measuredEntry, delta: { honesty: 0, grounding: 0, persona: 0 } }],
          baselineHistory: history
        },
        results: runFile({
          datasetHash: 'hash-SAME',
          cases: [caseRow({ honesty: scored(0), grounding: scored(0), persona: scored(0) })]
        }),
        baseline: {
          noiseBand: { honesty: 0.05, grounding: 0.05, persona: 0.05 },
          run: runFile({ datasetHash: 'hash-SAME', cases: [caseRow({})] })
        }
      });
      expect(() => loadPublished(dir)).toThrow(/recorded delta for honesty is 0/);
    });
  });

  it('refuses a reason that is only whitespace', () => {
    // `min(1)` rejects '' and nothing else, so a space satisfied it and the
    // page rendered "No delta is published for this phase." with the reason
    // collapsed to nothing by HTML — the blank cell the field exists to
    // prevent, wearing a heading.
    //
    // U+200B and friends are in this list because `String.trim` does not
    // strip them, so the first fix closed the space case and left the
    // zero-width one open — same blank cell, same heading.
    const { delta: _delta, verdict: _verdict, ...rest } = measuredEntry;
    for (const blank of [' ', '   \t\n  ', '​', '⁠', '⠀']) {
      const dir = fixture({
        manifest: {
          publishedRuns: [{ ...rest, deltaUnavailable: { reason: blank, notComparableTo: 'results/other.json' } }],
          baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
        }
      });
      expect(() => loadPublished(dir)).toThrow();
    }
  });

  it('refuses a reason long enough to swamp the page', () => {
    // Inlined verbatim into statically generated HTML; 50k took the page from
    // 15KB to 65KB. A ceiling, not a style rule.
    const { delta: _delta, verdict: _verdict, ...rest } = measuredEntry;
    const dir = fixture({
      manifest: {
        publishedRuns: [{ ...rest, deltaUnavailable: { reason: 'B'.repeat(50_000), notComparableTo: 'results/other.json' } }],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow();
  });

  it('tells a half-stated delta what is actually wrong with it', () => {
    // Telling the author to explain why there is no delta, when a delta is
    // sitting in their file, points at the wrong fix.
    const { verdict: _verdict, ...halfStated } = measuredEntry;
    const dir = fixture({
      manifest: {
        publishedRuns: [halfStated],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow(/delta and verdict together or neither/);
    expect(() => loadPublished(dir)).not.toThrow(/deltaUnavailable must say why not/);
  });

  it('refuses an entry carrying both a delta and a reason it has none', () => {
    const dir = fixture({
      manifest: {
        publishedRuns: [{ ...measuredEntry, deltaUnavailable: { reason: 'cannot be both', notComparableTo: 'results/other.json' } }],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow(/both a delta and a reason there is none/);
  });

  it('refuses a delta with no verdict beside it', () => {
    // Half a comparison renders as a number with nothing saying whether it
    // means anything, which is the reading the noise band exists to prevent.
    const { verdict: _verdict, ...halfStated } = measuredEntry;
    const dir = fixture({
      manifest: {
        publishedRuns: [halfStated],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow(/delta and verdict together or neither/);
  });

  it('refuses deltaUnavailable on a phase that took no measurement', () => {
    const dir = fixture({
      manifest: {
        publishedRuns: [
          measuredEntry,
          { ...unmeasuredEntry, deltaUnavailable: { reason: 'no run was taken', notComparableTo: 'results/other.json' } }
        ],
        baselineHistory: [{ date: '2026-08-29', cases: 20, reason: 'the original baseline' }]
      }
    });
    expect(() => loadPublished(dir)).toThrow(/is not measured, so deltaUnavailable must be absent/);
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
      // The retrieval corpus (spec 0012 phase three, AC-11). Present as a key
      // even for a run that predates retrieval, where its value is undefined.
      'corpusHash',
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

  it('accepts a RELATIVE evals directory, which is not an escape', () => {
    // path.resolve always returns an absolute path, so a relative base made
    // every legitimate file compare as outside and threw "resolves outside"
    // for a file plainly inside the record.
    const dir = fixture({});
    const previous = process.cwd();
    try {
      process.chdir(path.resolve(dir, '..', '..', '..'));
      expect(() => loadPublished(path.join('docs', 'evals', 'interview'))).not.toThrow();
    } finally {
      process.chdir(previous);
    }
  });

  it('refuses a SYMLINK inside the record whose target is outside it', () => {
    // The string check passes: the link's own path is contained. Only the
    // target escapes, and readFileSync follows targets. Git stores symlinks
    // and recreates them on checkout, so this is a file a fork PR can add.
    const dir = fixture({});
    const outside = path.resolve(dir, '..', '..', '..', 'secret.txt');
    writeFileSync(outside, 'must never reach the page\n');
    symlinkSync(outside, path.join(dir, 'escape.md'));
    const entry = { ...loadPublished(dir).publishedRuns[0], writeupFile: 'escape.md' };
    expect(() => loadWriteup(entry, dir)).toThrow(/outside/i);
  });

  it('refuses a symlinked results file too', () => {
    const dir = fixture({});
    const outside = path.resolve(dir, '..', '..', '..', 'secret.json');
    writeFileSync(outside, '{}\n');
    symlinkSync(outside, path.join(dir, 'results', 'escape.json'));
    const entry = {
      ...loadPublished(dir).publishedRuns[0],
      resultsFile: 'results/escape.json'
    };
    expect(() => loadRun(entry, dir)).toThrow(/outside/i);
  });

  it('allows a symlink whose target stays inside the record', () => {
    // Containment is about where the read lands, not about symlinks as such.
    const dir = fixture({});
    symlinkSync(path.join(dir, 'phase-one.md'), path.join(dir, 'alias.md'));
    const entry = { ...loadPublished(dir).publishedRuns[0], writeupFile: 'alias.md' };
    expect(loadWriteup(entry, dir)).toContain('phase-one.md');
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
