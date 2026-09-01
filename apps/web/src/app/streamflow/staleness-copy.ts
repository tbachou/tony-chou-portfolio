/**
 * What the page says when its numbers have gone old.
 *
 * Pinned as constants rather than written inline, following the
 * `NOT_A_FLOOD_FORECAST` precedent, and for the same reason: this is a public
 * page about a real river, and the job of these four sentences is to stop a
 * reader trusting a stale number without implying a flood is coming. Wording
 * that drifts during an unrelated edit is the failure mode.
 *
 * The exact text is fixed by spec 0010 child `0010-staleness-disclosure.md`,
 * Feature design > Copy. Change it there first.
 */

/** Shown beside the reading once it passes the threshold. AC-S3. */
export function staleReadingNote(age: string): string {
  return `This reading is ${age} old. New readings normally arrive every few hours, so the river may have changed since.`;
}

/**
 * Appended to the note above, never shown alone: a failed run with fresh data
 * already in hand is a pipeline concern, not a reader's. AC-S4.
 */
export const STALE_INGEST_NOTE =
  'The last ingest run did not complete, so nothing newer has reached the store.';

/**
 * The empty state when every forecast has passed its target. Deliberately
 * different from the never issued text: a stopped pipeline must not read as a
 * fresh install. AC-S9.
 */
export const ELAPSED_FORECASTS_NOTE =
  'Every forecast on record has passed the time it was predicting, and none newer has been issued. That means the pipeline has stopped, not that it has not started.';

/** The double dagger legend under the forecast table. AC-S7. */
export function staleInputLegend(hours: number): string {
  return `Issued from a river reading more than ${hours} hours old. The forecaster had no newer measurement to work from, so treat it as a claim about a river it could not fully see.`;
}
