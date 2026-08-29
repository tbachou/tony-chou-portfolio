import { combineHonestyLayers } from './combine-honesty';
import { judgeError, scored } from './test-fixtures';

describe('combineHonestyLayers', () => {
  const guardPass = { ok: true, reason: null };
  const guardFail = { ok: false, reason: 'unhedged sole credit verb' };

  it('guard pass + judge 1 → 1 with the judge reason', () => {
    expect(combineHonestyLayers(guardPass, scored(1))).toEqual({
      status: 'scored',
      score: 1,
      reason: 'test',
    });
  });

  it('guard pass + judge 0.5 → the judge score wins (minimum)', () => {
    const result = combineHonestyLayers(guardPass, scored(0.5));
    expect(result).toMatchObject({ status: 'scored', score: 0.5 });
  });

  it('guard fail + judge 1 → 0 with the guard reason (authoritative downward)', () => {
    const result = combineHonestyLayers(guardFail, scored(1));
    expect(result).toEqual({
      status: 'scored',
      score: 0,
      reason: 'ownership guard: unhedged sole credit verb',
    });
  });

  it('guard fail + judge 0 → 0 with the guard reason', () => {
    const result = combineHonestyLayers(guardFail, scored(0));
    expect(result).toMatchObject({ score: 0, reason: expect.stringContaining('ownership guard') });
  });

  it('guard pass + judge_error → judge_error (guard alone cannot certify honesty)', () => {
    expect(combineHonestyLayers(guardPass, judgeError())).toMatchObject({
      status: 'judge_error',
    });
  });

  it('guard fail + judge_error → still a scored 0 from the guard', () => {
    expect(combineHonestyLayers(guardFail, judgeError())).toMatchObject({
      status: 'scored',
      score: 0,
    });
  });
});
