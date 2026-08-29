import { selectCases } from './select-cases';

type Item = { id: string; difficulty: string };

function make(difficulty: string, n: number, prefix: string): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    difficulty,
  }));
}

const DATASET: Item[] = [
  ...make('simple', 5, 's'),
  ...make('medium', 5, 'm'),
  ...make('hard', 5, 'h'),
  ...make('edge', 5, 'e'),
];

describe('selectCases', () => {
  it('returns everything when the cap covers the full set', () => {
    expect(selectCases(DATASET, 20)).toHaveLength(20);
    expect(selectCases(DATASET, 99)).toHaveLength(20);
  });

  it('samples every difficulty tier under a cap (never a prefix slice)', () => {
    const picked = selectCases(DATASET, 8);
    expect(picked).toHaveLength(8);
    const tiers = new Set(picked.map((c) => c.difficulty));
    expect(tiers).toEqual(new Set(['simple', 'medium', 'hard', 'edge']));
    // 8 across 4 tiers → exactly 2 per tier
    for (const tier of tiers) {
      expect(picked.filter((c) => c.difficulty === tier)).toHaveLength(2);
    }
  });

  it('is deterministic', () => {
    expect(selectCases(DATASET, 7)).toEqual(selectCases(DATASET, 7));
  });

  it('handles a cap that does not divide evenly (tier order wins)', () => {
    const picked = selectCases(DATASET, 5);
    expect(picked.map((c) => c.id)).toEqual(['s0', 'm0', 'h0', 'e0', 's1']);
  });

  it('drains uneven tiers without an infinite loop', () => {
    const uneven = [...make('simple', 1, 's'), ...make('edge', 3, 'e')];
    expect(selectCases(uneven, 3).map((c) => c.id)).toEqual(['s0', 'e0', 'e1']);
    expect(selectCases(uneven, 10)).toHaveLength(4);
  });

  it('returns nothing for a zero or negative cap', () => {
    expect(selectCases(DATASET, 0)).toEqual([]);
    expect(selectCases(DATASET, -1)).toEqual([]);
  });
});
