import type { StoredObservation } from '../types';

/**
 * Whether a reading is old enough that the dashboard should stop presenting
 * it as current.
 *
 * The threshold is passed in rather than read from config, so the caller
 * names the rule and the test can vary it. `STALE_AFTER_HOURS` is the value
 * production passes; nothing here knows the number nine.
 *
 * The comparison is strictly greater than, so a reading sitting exactly on
 * the threshold is not yet stale. That boundary is arbitrary in the sense
 * that either side would be defensible, and load bearing in the sense that a
 * test pins it: an off by one here changes what a reader is told about a real
 * river.
 *
 * Spec 0010 child `0010-staleness-disclosure.md`, AC-S2.
 */
export function isStale(
  validTime: Date,
  now: Date,
  thresholdHours: number,
): boolean {
  const ageHours = (now.getTime() - validTime.getTime()) / 3_600_000;
  return ageHours > thresholdHours;
}

/**
 * The reading a forecast issued at `issuedAt` could actually have used.
 *
 * **Both bounds are load bearing, and dropping the `recordedAt` one is the
 * mistake this function exists to prevent.** The obvious version takes the
 * greatest `validTime` at or before `issuedAt` and stops there. That is
 * wrong, and it is wrong in the direction that defeats the feature.
 *
 * The rows handed in are one reconstruction as of *now*, not one as of
 * `issuedAt`: the dashboard reads them with `observationsAsOf(..., now, now)`.
 * Meanwhile `writeObservations` stamps a single `recordedAt` on a whole batch,
 * and gap recovery (the parent's AC-6) backfills a missed window long after
 * the fact. So after an outage recovers, rows whose `validTime` sits right up
 * against `issuedAt` exist in that snapshot carrying a `recordedAt` hours
 * later. A `validTime` only lookup would hand one of those back and report a
 * forecast issued blind during the outage as having had fresh input.
 *
 * Bounding on `recordedAt` as well excludes exactly those rows and falls
 * through to the reading that was genuinely knowable when the forecast was
 * made. It is not a full per `issuedAt` `reconstructAsOf`, so it can
 * occasionally treat a since superseded revision as unavailable and mark a
 * forecast stale that was marginally fresher than this says. That direction
 * is over warning, which is the safe one.
 *
 * Returns null when nothing qualifies. Callers must treat null as stale
 * rather than as fresh; see `isStaleInput`.
 *
 * Spec 0010 child `0010-staleness-disclosure.md`, AC-S6.
 */
export function inputReadingFor(
  rows: readonly StoredObservation[],
  issuedAt: Date,
): StoredObservation | null {
  const at = issuedAt.getTime();
  let best: StoredObservation | null = null;

  for (const row of rows) {
    if (row.validTime.getTime() > at) continue;
    // The bound the naive version omits. Not an optimisation.
    if (row.recordedAt.getTime() > at) continue;
    if (!best || row.validTime.getTime() > best.validTime.getTime()) {
      best = row;
    }
  }

  return best;
}

/**
 * Whether a forecast was issued from a reading too old to have seen the river
 * it is predicting.
 *
 * No qualifying reading at all counts as stale, not as fresh. The derivation
 * fails toward disclosure: a forecast whose input cannot be established is
 * exactly the one a reader should be told about, and returning false there
 * would silently launder the worst case into the clean one.
 *
 * Spec 0010 child `0010-staleness-disclosure.md`, AC-S5, AC-S6a.
 */
export function isStaleInput(
  rows: readonly StoredObservation[],
  issuedAt: Date,
  thresholdHours: number,
): boolean {
  const input = inputReadingFor(rows, issuedAt);
  if (!input) return true;
  return isStale(input.validTime, issuedAt, thresholdHours);
}
