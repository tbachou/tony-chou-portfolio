import type { Reading, StoredObservation } from '../types';

/**
 * Picks the readings that actually say something new.
 *
 * A reading is written when nothing is known for that `validTime` yet, or when
 * the value differs, or when the qualifier differs. Comparing the value alone
 * would silently drop the provisional to approved transition, which is the one
 * event this store most wants to capture: the number can settle unchanged
 * while its status does not.
 *
 * `known` is the current snapshot for the window, one row per `validTime`.
 * Re-running over an unchanged window returns an empty list, which is what
 * makes ingestion idempotent (AC-1).
 */
export function selectChangedReadings(
  readings: readonly Reading[],
  known: readonly StoredObservation[],
): Reading[] {
  const current = new Map<number, { valueCfs: number; qualifier: string }>();
  for (const row of known) {
    current.set(row.validTime.getTime(), {
      valueCfs: row.valueCfs,
      qualifier: row.qualifier,
    });
  }

  const changed: Reading[] = [];
  for (const reading of readings) {
    const at = reading.validTime.getTime();
    const existing = current.get(at);

    if (
      existing &&
      existing.valueCfs === reading.valueCfs &&
      existing.qualifier === reading.qualifier
    ) {
      continue;
    }

    // Fold each accepted reading back into the map before looking at the next
    // one. Every row a run writes shares that run's single recordedAt, so two
    // rows for one validTime would collide on the unique key; this keeps the
    // last reading for a validTime rather than letting the write fail.
    current.set(at, {
      valueCfs: reading.valueCfs,
      qualifier: reading.qualifier,
    });

    const alreadyQueued = changed.findIndex(
      (queued) => queued.validTime.getTime() === at,
    );
    if (alreadyQueued === -1) {
      changed.push(reading);
    } else {
      changed[alreadyQueued] = reading;
    }
  }

  return changed;
}
