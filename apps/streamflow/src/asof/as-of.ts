import type { StoredObservation } from '../types';

function key(row: StoredObservation): string {
  return `${row.gaugeId} ${row.validTime.getTime()}`;
}

/**
 * Reconstructs the observations as they were known at `asOf`.
 *
 * For each (gauge, validTime) it keeps the row with the greatest `recordedAt`
 * at or before `asOf`, and nothing recorded later. This is the reference
 * statement of AC-3: a revision that landed after `asOf` must be invisible,
 * because a model trained through this function can then only ever have seen
 * what it could have seen at the time.
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
): StoredObservation[] {
  const latest = new Map<string, StoredObservation>();

  for (const row of rows) {
    if (row.recordedAt.getTime() > asOf.getTime()) continue;

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
 * The single row known for one validTime at `asOf`, or undefined if nothing
 * was known yet. Ingestion uses this to decide whether an incoming reading is
 * actually new.
 */
export function latestKnownAt(
  rows: readonly StoredObservation[],
  gaugeId: string,
  validTime: Date,
  asOf: Date,
): StoredObservation | undefined {
  return reconstructAsOf(
    rows.filter(
      (row) =>
        row.gaugeId === gaugeId &&
        row.validTime.getTime() === validTime.getTime(),
    ),
    asOf,
  )[0];
}
