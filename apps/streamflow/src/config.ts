/**
 * Constants pinned by spec 0010. Every one of these is a value the spec names
 * a source for; nothing here is a guess.
 */

/**
 * The one gauge slice 1 tracks. Coordinates and name are USGS's own, read from
 * the site's instantaneous values response rather than transcribed by hand.
 */
export const GAUGE = {
  usgsSiteId: '03230500',
  name: 'Big Darby Creek at Darbyville OH',
  lat: 39.7006176,
  lon: -83.110187,
  /** Resolves calendar days for climatology. Stored times stay UTC. */
  timezone: 'America/New_York',
} as const;

/** USGS parameter code for discharge in cubic feet per second. */
export const DISCHARGE_PARAMETER_CODE = '00060';

/**
 * USGS reports a missing reading as this sentinel rather than omitting it.
 * Storing it would put a negative flow into the training set.
 */
export const USGS_NO_DATA_VALUE = -999999;

/**
 * Each ingest re-requests this much already seen time. USGS can settle a
 * reading shortly after first publishing it, and the overlap is what lets the
 * change be noticed. Costs nothing: unchanged readings write no rows.
 */
export const INGEST_OVERLAP_HOURS = 2;

/**
 * Where ingestion starts on an empty table. This is where the Open-Meteo
 * archive begins, so it is the earliest date at which a row can ever be
 * matched with the rainfall that explains it.
 */
export const BACKFILL_START = new Date('2024-01-01T00:00:00.000Z');

/** USGS instantaneous values service. Open, keyless. */
export const USGS_IV_ENDPOINT = 'https://waterservices.usgs.gov/nwis/iv/';

/** The gauge reports every 15 minutes, which is what PARTIAL is judged against. */
export const EXPECTED_INTERVAL_MINUTES = 15;

/**
 * How far back every rescan re-polls regardless of what it holds. The live
 * edge is not the only place USGS changes its mind, and this is the window
 * where it changes it most often.
 */
export const RESCAN_ROLLING_DAYS = 90;

/**
 * Gap below which two stretches of still provisional readings are re-polled as
 * one request. Provisional readings normally sit in one contiguous run, but a
 * single stranded one must not cost a separate trip, and a whole quiet day
 * between two of them is cheaper to fetch than to skip.
 */
export const RESCAN_MERGE_GAP_HOURS = 24;
