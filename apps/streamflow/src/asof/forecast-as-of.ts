import type { KnowabilityAxis, StoredForecast } from '../types';

/**
 * The clock a weather row is judged by under `axis`.
 *
 * **This mapping is written out by hand on purpose, and it must stay that way
 * (AC-R8a).** `KnowabilityAxis` names which knowability mode a slot is running
 * in, not a column name. For an observation the archive mode column really is
 * `validTime`, which is why `reconstructAsOf` can index `row[axis]` and be
 * right. For a forecast it is `issuedAt`: the question the archive mode asks is
 * when the forecast was issued, not when the weather it describes was due.
 *
 * A `StoredForecast` carries a `validTime` as well, so `row[axis]` compiles
 * here and typechecks and is wrong. That is the whole hazard. It fails in a
 * direction worth knowing: `issuedAt` is `validTime` minus a lead of at least
 * 24 hours, so it is always the earlier of the two, and reading `validTime`
 * instead can only ever hide a row that was genuinely visible. It cannot leak.
 * It starves. A rain window is drawn from the hours after the issue time, so
 * every row in it has a `validTime` after `T`, and the wrong lookup would hide
 * the whole window and turn every rain feature null (AC-R10) rather than
 * returning a wrong number. Loud, but only once something consumes it.
 */
export function forecastKnowableAt(
  row: StoredForecast,
  axis: KnowabilityAxis = 'recordedAt',
): Date {
  return axis === 'validTime' ? row.issuedAt : row.recordedAt;
}

/**
 * The weather rows visible at `asOf` on `axis`: `recordedAt` at or before it on
 * the live axis, `issuedAt` at or before it on the archive axis (AC-R8).
 *
 * The default is the strict `recordedAt` rule, so a caller that passes nothing
 * gets the rule every live read uses. Only the hindcast passes the archive
 * axis, exactly as for the other three reads; a second caller on it is a review
 * failure.
 *
 * **This is visibility only. It does not reduce, and its result must not be
 * summed or counted as it stands.** AC-R8 makes the two steps separate: the
 * axis decides which rows may be seen, and AC-R7's reduction to one row per
 * hour, the greatest visible `recordedAt` for each `validTime`, then picks
 * which of them stands for its hour. The table is append only, so a revised
 * hour appears here more than once by design. Summing this set double counts
 * every hour that was ever revised, and counting it can pad a short window up
 * to the length AC-R10 requires. The reduction belongs to the rain feature
 * builder, which is the only thing that should be aggregating these rows.
 *
 * The `at or before` bound is inclusive at both ends of the axis, matching
 * `reconstructAsOf`: a row whose clock reads exactly `asOf` was knowable then.
 *
 * Returns the rows in the order they arrived, since nothing here depends on
 * order and the reduction downstream keys by hour rather than by position.
 */
export function forecastsVisibleAt(
  rows: readonly StoredForecast[],
  asOf: Date,
  axis: KnowabilityAxis = 'recordedAt',
): StoredForecast[] {
  return rows.filter(
    (row) => forecastKnowableAt(row, axis).getTime() <= asOf.getTime(),
  );
}
