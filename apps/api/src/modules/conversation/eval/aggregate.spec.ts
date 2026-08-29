import { aggregate } from './aggregate';
import { judgeError, makeCase, scored } from './test-fixtures';

describe('aggregate', () => {
  it('computes the unweighted mean per dimension', () => {
    const result = aggregate([
      makeCase({ caseId: 'a', dimensions: { honesty: scored(1), grounding: scored(0.5), persona: scored(1) } }),
      makeCase({ caseId: 'b', dimensions: { honesty: scored(0), grounding: scored(1), persona: scored(0.5) } }),
    ]);
    expect(result.perDimension.honesty.mean).toBe(0.5);
    expect(result.perDimension.grounding.mean).toBe(0.75);
    expect(result.perDimension.persona.mean).toBe(0.75);
    expect(result.perDimension.honesty.scoredCases).toBe(2);
  });

  it('excludes a judge_error from that dimension only; the rest of the case still counts', () => {
    const result = aggregate([
      makeCase({ caseId: 'a', dimensions: { honesty: scored(1), grounding: judgeError(), persona: scored(0) } }),
      makeCase({ caseId: 'b', dimensions: { honesty: scored(0), grounding: scored(1), persona: scored(1) } }),
    ]);
    expect(result.perDimension.grounding.mean).toBe(1);
    expect(result.perDimension.grounding.scoredCases).toBe(1);
    expect(result.perDimension.grounding.judgeErrors).toBe(1);
    expect(result.perDimension.honesty.mean).toBe(0.5);
    expect(result.perDimension.persona.mean).toBe(0.5);
    expect(result.judgeErrorCases).toEqual({ a: ['grounding'] });
  });

  it('excludes generation_error cases entirely and lists them', () => {
    const result = aggregate([
      makeCase({ caseId: 'ok', dimensions: { honesty: scored(1), grounding: scored(1), persona: scored(1) } }),
      makeCase({ caseId: 'broken', status: 'generation_error', dimensions: {} }),
    ]);
    expect(result.perDimension.honesty.mean).toBe(1);
    expect(result.perDimension.honesty.scoredCases).toBe(1);
    expect(result.generationErrors).toEqual(['broken']);
  });

  it('returns a null mean when nothing scored', () => {
    const result = aggregate([
      makeCase({ caseId: 'broken', status: 'generation_error', dimensions: {} }),
    ]);
    expect(result.perDimension.honesty.mean).toBeNull();
  });

  it('breaks scores down per difficulty', () => {
    const result = aggregate([
      makeCase({ caseId: 'a', difficulty: 'simple', dimensions: { honesty: scored(1), grounding: scored(1), persona: scored(1) } }),
      makeCase({ caseId: 'b', difficulty: 'edge', dimensions: { honesty: scored(0), grounding: scored(0.5), persona: scored(1) } }),
    ]);
    expect(result.perDifficulty.simple.honesty.mean).toBe(1);
    expect(result.perDifficulty.edge.honesty.mean).toBe(0);
    expect(result.perDifficulty.edge.grounding.mean).toBe(0.5);
    expect(result.perDifficulty.hard.honesty.mean).toBeNull();
  });
});
