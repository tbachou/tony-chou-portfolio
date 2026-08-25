import type { KnowabilityAxis, StoredObservation } from '../types';

function key(row: StoredObservation): string {
  return `${row.gaugeId} ${row.validTime.getTime()}`;
}

/**
 * Reconstructs the observations as they were known at `asOf`.
 *
 * For each (gauge, validTime) it keeps the row with the greatest `recordedAt`
 * that the axis lets it see, and nothing beyond `asOf`. On the default
 * `recordedAt` axis this is the reference statement of AC-3: a revision that
 * landed after `asOf` must be invisible, because a model trained through this
 * function can then only ever have seen what it could have seen at the time.
 *
 * `axis` moves only the bound, never the reduction. On `validTime` a row is
 * in scope once it was true at the gauge by `asOf`, and among the rows in
 * scope for a `validTime` the greatest `recordedAt` still wins. That is the
 * looser rule spec 0010's hindcast seeding child argues for, and the seeding
 * hindcast is its only caller.
 *
 * Production reads use the equivalent `DISTINCT ON` query in
 * `observations.repository.ts`, which pushes the same rule into Postgres. This
 * function is the tested statement of what that query must mean, and the
 * oracle an integration test can compare it against once a database exists.
 *
 * Returns rows sorted by gauge then validTime ascending.
 */
export function reconstructAsOf(
  rows: readonly StoredObservation[],
  asOf: Date,
  axis: KnowabilityAxis = 'recordedAt',
): StoredObservation[] {
  const latest = new Map<string, StoredObservation>();

  for (const row of rows) {
    if (row[axis].getTime() > asOf.getTime()) continue;

    const existing = latest.get(key(row));
    // Strictly greater, so an exact tie keeps the first seen. The unique
    // constraint on (gaugeId, validTime, recordedAt) means a tie cannot occur
    // in the store; this only decides behaviour for a malformed fixture.
    if (!existing || row.recordedAt.getTime() > existing.recordedAt.getTime()) {
      latest.set(key(row), row);
    }
  }

  return [...latest.values()].sort(
    (a, b) =>
      a.gaugeId.localeCompare(b.gaugeId) ||
      a.validTime.getTime() - b.validTime.getTime(),
  );
}

/**
 * The same reconstruction, carried forward instead of recomputed.
 *
 * The seeding hindcast asks for the as of view at thousands of successive
 * instants over one unchanging set of rows. Calling `reconstructAsOf` per slot
 * would rescan the whole record every time, and a database round trip per slot
 * would be worse. This sorts once on the axis and then advances a cursor, so
 * the whole walk costs one pass over the rows plus one map read per slot.
 *
 * Returns a function that must be called with instants that never go
 * backwards. That is the one thing it cannot check and the one thing that
 * would make it wrong: the cursor only moves forward, so an earlier instant
 * would be answered with a view that has already run past it. The hindcast
 * walks its slots in order, which is why it is allowed to use this.
 *
 * The rows it hands back are in no meaningful order, unlike `reconstructAsOf`.
 * Nothing downstream reads them in order, and sorting per slot would put back
 * the per slot rescan this exists to avoid. Sort the result if you need it.
 */
export function asOfWalk(
  rows: readonly StoredObservation[],
  axis: KnowabilityAxis = 'recordedAt',
): (asOf: Date) => StoredObservation[] {
  // Sorted here rather than trusted from the caller, because the ordering is
  // what makes the last write per key the right one and a caller that orders
  // by the other clock would be silently wrong rather than obviously wrong.
  // Ascending `recordedAt` within an axis value is what carries the reduction:
  // the last row seen for a key is the newest revision of it.
  const ordered = [...rows].sort(
    (a, b) =>
      a[axis].getTime() - b[axis].getTime() ||
      a.recordedAt.getTime() - b.recordedAt.getTime(),
  );

  const latest = new Map<string, StoredObservation>();
  let cursor = 0;

  return (asOf: Date) => {
    while (
      cursor < ordered.length &&
      ordered[cursor][axis].getTime() <= asOf.getTime()
    ) {
      latest.set(key(ordered[cursor]), ordered[cursor]);
      cursor += 1;
    }

    return [...latest.values()];
  };
}
