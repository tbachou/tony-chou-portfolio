/**
 * Case cap that samples across difficulty tiers (round robin in first-seen
 * tier order) instead of slicing the array prefix, so a capped CI run still
 * exercises hard and edge bait cases — the regressions the suite exists to
 * catch. Deterministic: the same cap always picks the same cases.
 */
export function selectCases<T extends { difficulty: string }>(
  all: T[],
  cap: number,
): T[] {
  if (cap >= all.length) return all;
  if (cap <= 0) return [];
  const tiers = new Map<string, T[]>();
  for (const item of all) {
    const tier = tiers.get(item.difficulty) ?? [];
    tier.push(item);
    tiers.set(item.difficulty, tier);
  }
  const buckets = [...tiers.values()];
  const picked: T[] = [];
  for (let round = 0; picked.length < cap; round += 1) {
    let took = false;
    for (const bucket of buckets) {
      if (picked.length >= cap) break;
      if (round < bucket.length) {
        picked.push(bucket[round]);
        took = true;
      }
    }
    if (!took) break;
  }
  return picked;
}
