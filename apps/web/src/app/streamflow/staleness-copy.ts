/**
 * What the page says when its numbers have gone old.
 *
 * Pinned as constants rather than written inline, following the
 * `NOT_A_FLOOD_FORECAST` precedent, and for the same reason: this is a public
 * page about a real river, and the job of these sentences is to stop a reader
 * trusting a stale number without implying a flood is coming.
 *
 * Two rules hold for everything in this file, both learned from audit findings
 * rather than chosen up front.
 *
 * **A string must be true for every cause that can trigger it.** A row is
 * marked when the forecast is old OR when its input was old, so copy naming
 * only one of those is false half the time. The legend used to say the
 * forecaster "had no newer measurement to work from" while a one hour old
 * reading sat three paragraphs above it, and the page contradicted itself.
 *
 * **A string must state what is known, not predict what follows.** The ingest
 * note used to say a newer reading "should not be expected shortly", which is
 * wrong after a single skipped run when the next is due within the hour. Its
 * replacement then said "no ingest run has completed since then either",
 * which was true on only one of the three conditions that trigger it, so it
 * says the weaker, true thing instead.
 *
 * **A string must not be so careful it says nothing.** The legend was fixed
 * from a false cause to "does not describe the river as it is now", which is
 * true of every forecast ever made and therefore told a reader nothing. Being
 * cause neutral is required; being vacuous is not the way to get there.
 *
 * The exact text is fixed by spec 0010 child `0010-staleness-disclosure.md`,
 * Feature design > Copy. Change it there first.
 */

/**
 * Shown beside the reading once it passes the threshold. AC-S3.
 *
 * `age` is the page's existing relative form ("41 h ago"), and the sentence is
 * built around it rather than fighting it. An earlier version read
 * `This reading is ${age} old`, rendering as "This reading is 41 h ago old".
 */
export function staleReadingNote(age: string): string {
  return `Last measured ${age}, and nothing newer has reached this page since. The river can change a great deal in that time.`;
}

/**
 * Appended to any state where the page has stopped being current, which is
 * all three of them: the stale reading, the all stale forecast table, and the
 * stopped pipeline empty state. The first version reached only the reading,
 * so the two states a reader could meet with a perfectly fresh number said
 * nothing about where to go instead.
 *
 * The emergency clause is not optional and was dropped once already. The
 * footer carries it; the footer is roughly 3,400px away.
 */
export const REDIRECT = {
  lead: 'For the level right now see the',
  usgs: 'USGS gauge',
  mid: ', and for a flood warning NOAA’s',
  noaa: 'National Water Prediction Service',
  emergency: '. In an emergency, contact local emergency services.',
} as const;

/** The same destinations the footer credits point at. */
export const USGS_GAUGE_URL =
  'https://waterdata.usgs.gov/monitoring-location/03230500/';
export const NOAA_WATER_URL = 'https://water.noaa.gov/';

/**
 * Appended to the reading note when the pipeline is genuinely not completing
 * runs. States the fact rather than forecasting the future: one skipped cron
 * trips the threshold with the next run due shortly, so a promise that
 * nothing is coming would be false more often than true. AC-S4.
 */
export const STALE_INGEST_NOTE =
  'The job that feeds this page is not running normally either.';

/**
 * The empty state when the pipeline has stopped. Deliberately different from
 * the never issued text: a stopped pipeline must not read as a fresh install.
 * AC-S9.
 */
export const ELAPSED_FORECASTS_NOTE =
  'Every forecast on record has passed the time it was predicting, and none newer has been issued. That means the pipeline has stopped, not that it has not started.';

/**
 * Shown when the page cannot tell a stopped pipeline from a new one, because
 * the read that answers it failed. Neither of the other two sentences is
 * honest in that case, and asserting the never issued one is how this page
 * previously told a months old pipeline it had never started. AC-S9, AC-S11.
 */
export const EVER_ISSUED_UNKNOWN_NOTE =
  'No current forecast is showing, and this page could not check whether one has ever been issued. That is the page failing to ask; it is not news about the river.';

/**
 * The marker legend, and the per row marker's hidden text, which is this
 * string rather than a paraphrase of it.
 *
 * **The second clause is anchored to `now`, not to issue time, and that is
 * what makes it true.** Three things trigger the marker, not two: a stale
 * `issuedAt` (AC-S5a), an input already stale when the forecast was issued
 * (AC-S5), and the page warning about the newest reading at all, which the
 * per row predicate ORs in. Under that third trigger a forecast issued three
 * hours ago from a six hour old input is marked, and both of the clauses this
 * sentence used to carry were false, because AC-S5 measures input age at
 * `issuedAt`. Measured from now the clause holds under all three, since the
 * input reading is never newer than the newest reading.
 *
 * AC-S5, AC-S5a, AC-S7, AC-S7a.
 */
export function staleForecastLegend(hours: number): string {
  return `Issued more than ${hours} hours ago, or built on a river reading that is now more than ${hours} hours old. Either way it was made without the river's current level, and may be well off.`;
}

/**
 * What a screen reader hears in place of the `‡` in a marked row.
 *
 * The glyph alone reaches nobody who cannot see it: `title` on a role-less
 * span is not an accessible name and is not announced, and U+2021 is
 * punctuation that is not spoken at default verbosity. In the per row mode
 * marked and unmarked rows sit together, so without this a blind reader is
 * read the untrustworthy numbers with nothing to separate them from the
 * trustworthy ones. AC-S7a.
 *
 * **Deliberately short, and deliberately not the legend.** The first fix for
 * that silence spoke the whole legend in every marked cell, which is 187
 * characters per row and close to a thousand for a mostly stale table, to
 * convey one repeated fact. That trades silence for noise and is its own
 * barrier. This is the marker, matching what a sighted reader gets from the
 * glyph; the explanation is the legend paragraph below the table, which a
 * screen reader reads as ordinary text on the way past. Nothing here can
 * drift from the legend, because it no longer makes the legend's claim.
 */
export const STALE_FORECAST_MARKER_LABEL = 'Stale forecast.';
