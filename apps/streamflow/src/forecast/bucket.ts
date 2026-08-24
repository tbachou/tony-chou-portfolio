import type { Regime } from './regime';

/**
 * Which past errors a prediction's interval is allowed to learn from.
 *
 * This is the reference statement of the rule, in TypeScript. Production reads
 * the equivalent DISTINCT ON query in `bucket.repository.ts`, and
 * `scripts/verify-bucket.ts` checks the two agree against a real database.
 * The same split as the as of reconstruction, for the same reason: the rule
 * has four separate ways to go quietly wrong, and none of them are visible in
 * a query that returns plausible numbers.
 */

/** One score, carrying the fields of its prediction the rule needs. */
export interface BucketCandidate {
  scoreId: string;
  predictionId: string;
  actualCfs: number;
  actualRecordedAt: Date;
  gaugeId: string;
  modelVersionId: string;
  horizonHours: number;
  issueRegime: Regime | null;
  centralCfs: number;
}

export interface BucketCriteria {
  gaugeId: string;
  modelVersionId: string;
  horizonHours: number;
  /**
   * The instant the prediction being built is issued at. Nothing learned
   * after it may enter the bucket.
   */
  issuedAt: Date;
  /**
   * The regime to condition on. Leave it off for the pooled bucket, which is
   * this same rule with the condition dropped. Omitting it is not the same as
   * asking for rows whose issueRegime is null, and there is deliberately no
   * way to ask for those: an unclassifiable issue regime falls to pooled
   * rather than forming a bucket of its own.
   */
  issueRegime?: Regime;
}

/**
 * The ratios `actualCfs / centralCfs` that a bucket is made of.
 *
 * Four rules, each of which the interval is wrong without:
 *
 * One error per prediction. A prediction scored twice, because a revision
 * changed the truth under it, would otherwise weigh twice as much as one
 * scored once, and the predictions most likely to be re polled are the ones
 * during storms. The score kept is the one with the greatest
 * `actualRecordedAt`, ties broken on the greater id. The unique constraint on
 * (predictionId, actualRecordedAt) means a tie cannot occur in the store; the
 * rule is stated so that the query and this function cannot disagree.
 *
 * Nothing learned after the issue instant. For a live prediction this holds
 * for free, since no later score exists yet. For a hindcast prediction it
 * holds only because it is stated: the central estimate goes through the as
 * of reconstruction and cannot see the future, but the bucket query has no
 * natural time bound, so half the calculation would silently read ahead.
 *
 * No non positive central estimate. The ratio divides by it, and one zero
 * would poison the whole sample.
 *
 * Scoped by gauge as well as by model and horizon, for the reason the as of
 * reconstruction is: correct with one gauge, silently wrong with two.
 *
 * Hindcast rows are deliberately not excluded. They exist to fill this bucket.
 */
export function bucketRatios(
  rows: readonly BucketCandidate[],
  criteria: BucketCriteria,
): number[] {
  const eligible = rows.filter(
    (row) =>
      row.gaugeId === criteria.gaugeId &&
      row.modelVersionId === criteria.modelVersionId &&
      row.horizonHours === criteria.horizonHours &&
      row.centralCfs > 0 &&
      row.actualRecordedAt.getTime() <= criteria.issuedAt.getTime() &&
      (criteria.issueRegime === undefined ||
        row.issueRegime === criteria.issueRegime),
  );

  // Reduce after filtering, never before. A prediction whose newest score
  // arrived after the issue instant still contributes its older one; dropping
  // the prediction entirely would quietly shrink the bucket.
  const newestPerPrediction = new Map<string, BucketCandidate>();
  for (const row of eligible) {
    const held = newestPerPrediction.get(row.predictionId);
    if (
      !held ||
      row.actualRecordedAt.getTime() > held.actualRecordedAt.getTime() ||
      (row.actualRecordedAt.getTime() === held.actualRecordedAt.getTime() &&
        row.scoreId > held.scoreId)
    ) {
      newestPerPrediction.set(row.predictionId, row);
    }
  }

  return [...newestPerPrediction.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row.actualCfs / row.centralCfs);
}
