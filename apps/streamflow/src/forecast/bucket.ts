import type { Regime } from './regime';
import type { KnowabilityAxis } from '../types';

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
  /** The contributing prediction's own target instant, which is the time bound. */
  targetTime: Date;
  issueRegime: Regime | null;
  centralCfs: number;
}

export interface BucketCriteria {
  gaugeId: string;
  modelVersionId: string;
  horizonHours: number;
  /**
   * The instant the prediction being built is issued at. Nothing whose
   * outcome had not yet happened by then may enter the bucket.
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
  /**
   * Which knowability axis the caller is reading on.
   *
   * Recorded rather than acted on, and that is the point rather than an
   * oversight. The time bound used to be `actualRecordedAt`, which is an axis
   * dependent fact; it is now `targetTime`, which is the same property stated
   * in terms both axes can evaluate. So the answer is identical either way,
   * the tests prove it is, and the field is here to keep the axis visible at
   * the call site alongside the two reads where it does change the statement.
   */
  axis?: KnowabilityAxis;
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
 * Nothing whose outcome had not yet happened. A prediction learns only from
 * forecasts whose target instant had already passed when it was issued. For a
 * live prediction that holds anyway, since a forecast is not scored before
 * its target; for a hindcast prediction it holds only because it is stated,
 * as the central estimate goes through the as of reconstruction and cannot
 * see the future while the bucket query has no natural time bound of its own.
 *
 * This bound reads `targetTime` rather than `actualRecordedAt` because the
 * archive was imported in one pass: every hindcast score there names the same
 * import instant, so a bound on it is either always true or always false and
 * carries no information. `targetTime` says the same thing on an axis a walk
 * of the archive can actually evaluate, and it is correct on the live path
 * too, where a target in the past is a precondition of having been scored.
 * The cost is a narrow race, bounded by the scoring cadence: a prediction
 * issued at 06:00 can see a score whose target passed at 05:55 but whose
 * truth landed at 06:05. Minutes of a reading that was already true before
 * the forecast was made, and the price of a bucket that is not empty.
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
      row.targetTime.getTime() <= criteria.issuedAt.getTime() &&
      (criteria.issueRegime === undefined ||
        row.issueRegime === criteria.issueRegime),
  );

  // Filter then reduce, keeping the order the query uses. Every condition
  // above is now a property of the prediction rather than of one of its
  // scores, so both orders give the same answer and the query could safely
  // reduce first. Stated the same way in both places anyway, because the two
  // are only allowed to exist as long as they cannot drift.
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
