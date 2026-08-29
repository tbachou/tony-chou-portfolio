import { renderScoreboard } from './scoreboard';
import { judgeError, makeCase, makeRun, scored } from './test-fixtures';
import type { BaselineFile } from './eval-types';

describe('renderScoreboard', () => {
  const run = makeRun([
    makeCase({
      caseId: 'a',
      difficulty: 'simple',
      dimensions: { honesty: scored(1), grounding: scored(0.5), persona: scored(1) },
    }),
    makeCase({
      caseId: 'b',
      difficulty: 'edge',
      guardFired: true,
      honestyLayers: {
        guard: { ok: false, reason: 'unhedged sole credit verb' },
        judge: scored(0),
      },
      dimensions: { honesty: scored(0), grounding: judgeError(), persona: scored(1) },
    }),
  ]);

  it('renders means with two decimals and the per difficulty breakdown', () => {
    const board = renderScoreboard(run, null);
    expect(board).toContain('| honesty | 0.50 |');
    expect(board).toContain('| grounding | 0.50 |');
    expect(board).toContain('| simple |');
    expect(board).toContain('| edge |');
    expect(board).toContain('_No committed baseline yet');
  });

  it('lists errored cases and guard firings', () => {
    const board = renderScoreboard(run, null);
    expect(board).toContain('`b`: judge_error on grounding');
    expect(board).toContain('unhedged sole credit verb');
  });

  it('shows the delta and noise band against a comparable baseline', () => {
    const baseline: BaselineFile = {
      noiseBand: { honesty: 0.05, grounding: 0.05, persona: 0.05 },
      run: makeRun([
        makeCase({
          caseId: 'a',
          dimensions: { honesty: scored(1), grounding: scored(1), persona: scored(1) },
        }),
      ]),
    };
    const board = renderScoreboard(run, baseline);
    expect(board).toContain('-0.50');
    expect(board).toContain('**significant**');
    expect(board).toContain('±0.05');
  });

  it('marks the delta not comparable when the dataset hash differs', () => {
    const baseline: BaselineFile = {
      noiseBand: null,
      run: makeRun([makeCase({ caseId: 'a' })], { datasetHash: 'other-hash' }),
    };
    const board = renderScoreboard(run, baseline);
    expect(board).toContain('not comparable');
  });

  it('flags an aborted run as partial', () => {
    const aborted = makeRun([makeCase({ caseId: 'a' })], { aborted: true });
    expect(renderScoreboard(aborted, null)).toContain('aborted by --max-cost');
  });
});
