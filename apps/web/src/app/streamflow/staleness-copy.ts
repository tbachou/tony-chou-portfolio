/**
 * What the page says when its numbers have gone old.
 *
 * Pinned as constants rather than written inline, following the
 * `NOT_A_FLOOD_FORECAST` precedent, and for the same reason: this is a public
 * page about a real river, and the job of these sentences is to stop a reader
 * trusting a stale number without implying a flood is coming. Wording that
 * drifts during an unrelated edit is the failure mode.
 *
 * The exact text is fixed by spec 0010 child `0010-staleness-disclosure.md`,
 * Feature design > Copy. Change it there first.
 */

/**
 * Shown beside the reading once it passes the threshold. AC-S3.
 *
 * `age` is the page's existing relative form ("41 h ago"), and this sentence
 * is built around it rather than fighting it. The first version read
 * `This reading is ${age} old`, which rendered as "This reading is 41 h ago
 * old". Both pre deploy audit passes caught it.
 */
export function staleReadingNote(age: string): string {
  return `Last measured ${age}, and nothing newer has reached this page since. The river can change a great deal in that time.`;
}

/**
 * Appended to the note above. The stale state is the one in which a reader
 * most needs somewhere else to go, and before this it was the state in which
 * the pointer was furthest away: the footer carrying these links sits roughly
 * 3,400px below the numbers. AC-S3.
 */
export const STALE_READING_REDIRECT = {
  lead: 'For the level right now see the',
  usgs: 'USGS gauge',
  mid: ', and for a flood warning NOAA’s',
  noaa: 'National Water Prediction Service',
} as const;

/** The same destinations the footer credits point at. */
export const USGS_GAUGE_URL =
  'https://waterdata.usgs.gov/monitoring-location/03230500/';
export const NOAA_WATER_URL = 'https://water.noaa.gov/';

/**
 * Also appended, and only when the pipeline is genuinely not completing runs.
 * Deliberately not "the last run did not complete": a scheduler that stops
 * entirely writes no row at all, so the newest row stays an old success and
 * the status alone reports the worst failure as perfect health. AC-S4.
 */
export const STALE_INGEST_NOTE =
  'The pipeline is not completing its runs, so a newer reading should not be expected shortly.';

/**
 * The empty state when every forecast has passed its target. Deliberately
 * different from the never issued text: a stopped pipeline must not read as a
 * fresh install. AC-S9.
 */
export const ELAPSED_FORECASTS_NOTE =
  'Every forecast on record has passed the time it was predicting, and none newer has been issued. That means the pipeline has stopped, not that it has not started.';

/**
 * The marker legend. Covers both ways a row earns it, because a reader does
 * not need to know which clock failed. AC-S5, AC-S5a, AC-S7.
 */
export function staleForecastLegend(hours: number): string {
  return `Issued more than ${hours} hours ago, or from a river reading that old. The forecaster had no newer measurement to work from, so treat it as a claim about a river it could not fully see.`;
}
