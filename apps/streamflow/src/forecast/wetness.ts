import { regimeInputs } from './regime';
import type { StoredObservation } from '../types';

/**
 * How wet the catchment already was when a prediction was issued.
 *
 * Rain falling on a saturated catchment reaches the channel; the same rain on
 * a dry one soaks in. A rain feature without this is missing half the question,
 * which is why it lands beside `rain.ts` rather than later.
 *
 * The quantity is the median discharge over the prior seven days, and it is
 * the same `m` the regime classifier already derives (AC-R11). It reuses
 * `regimeInputs` rather than restating the window, so the wetness feature and
 * the regime can never come to disagree about what seven days of history means.
 * Restating it would have been three lines and would have drifted the first
 * time either constant moved.
 *
 * **Trailing discharge is a weaker signal than observed antecedent rainfall,
 * and that is a deliberate trade.** Measured rain is an observation, and this
 * child exists to keep observations out of the model's inputs. The river's own
 * recent level is something a forecaster genuinely holds at issue time, so it
 * is safe in the way the honest thing usually is: less powerful. No rainfall
 * observation source is introduced here, on purpose.
 */

/**
 * The seven day median discharge as known at the issue instant, or null.
 *
 * **`history` must already be reconstructed as of the issue instant, on the
 * slot's axis.** This is the same contract `classifyRegime` has and the same
 * hazard: `regimeInputs` filters on `validTime` only, so it drops readings that
 * had not yet happened but keeps readings the pipeline had not yet received.
 * Passing a raw history therefore leaks quietly, with a plausible number rather
 * than an error. The axis is spent before a slot reaches here, which is why
 * this function does not take one, and why a caller reads through
 * `reconstructAsOf` or `asOfWalk` exactly as `predict.ts` does.
 *
 * Null wherever `regimeInputs` refuses, and it refuses in **three** cases, not
 * the two AC-R11 lists: fewer than 224 readings in the prior seven days, a non
 * positive median, and no reading within two hours of the twelve hour mark.
 * The third is about `d`, the twelve hour change, which wetness does not use
 * and which a median is perfectly well defined without. Inheriting it makes
 * this feature refuse a little more often than the criterion's prose implies.
 * That is the safe direction, since a refusal becomes AC-R10's skip rather than
 * a wrong number, and it is recorded here rather than quietly corrected because
 * reusing the function whole is what the criterion asks for.
 *
 * `valueAtIssue` reaches `regimeInputs` and changes nothing this function
 * returns: it feeds `d` alone, and `m` and all three refusals are properties of
 * the history. It is passed through rather than faked with a constant so the
 * two stay coupled. If a later refusal ever does read it, wetness inherits that
 * too instead of silently diverging.
 */
export function antecedentWetness(
  history: readonly StoredObservation[],
  issuedAt: Date,
  valueAtIssue: number,
): number | null {
  const inputs = regimeInputs(history, issuedAt, valueAtIssue);

  return inputs === null ? null : inputs.m;
}
