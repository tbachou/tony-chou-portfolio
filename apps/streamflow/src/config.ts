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

/**
 * Where the dashboard renders times. Stored values are always UTC (AC-18);
 * this is the only place a reader ever sees a local clock.
 */
export const DISPLAY_TIMEZONE = 'America/New_York';

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
 * Where every walk over history starts on an empty store: observation ingest,
 * the forecast month walk, and the seeding hindcast alike.
 *
 * It is not where the Open-Meteo archive begins. This comment said that it was
 * until the rain child measured it, and the claim was wrong by about three
 * weeks and wrong by a different amount for each lead, because a lead of N days
 * needs N days of prior runs behind it.
 *
 * The date stays where it is, and the weeks before the archive are not free.
 * The forecast walk requests those months and they come back short, which is
 * expected and recorded as PARTIAL rather than failed (AC-R14). The hindcast
 * issues predictions across them too, so the record holds slots no forecast
 * rain could ever be matched with. Both are cheap and neither is wrong; a
 * rain aware forecaster is simply skipped there under AC-R10, which does mean
 * its scored population will not match a baseline's over that stretch.
 *
 * What is never pinned here is where the archive actually starts.
 * `earliestStoredForecastValidTimes` reads the earliest row held per lead out
 * of the store, and stays true as Open-Meteo extends or trims what it serves
 * (AC-R6). Note that even that is the earliest row, not the first date a
 * prediction can use; the function's own docstring carries the difference.
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

/**
 * The nominal coverage every interval claims. Stored on each Prediction row
 * rather than assumed, so a later change of policy cannot silently
 * reinterpret every prediction already made.
 */
export const INTERVAL_LEVEL = 0.8;

/** The quantiles that give that nominal 0.80 band. */
export const INTERVAL_QUANTILE_LOW = 0.1;
export const INTERVAL_QUANTILE_HIGH = 0.9;

/**
 * The fewest past errors a bucket needs before its quantiles may stand for a
 * distribution, for the regime conditioned bucket and the pooled one alike.
 * Inherited from the parent spec.
 *
 * All four regimes clear it on the relabelled record. Measured 2026-08-28
 * after the falling denominator relabelling, counting predictions by
 * `issueRegime` per model and horizon: persistence holds 2,165 baseflow, 522
 * rising, 870 falling and 89 peak; climatology holds about 1,309, 359, 587
 * and 60. The denominator change moved rows only between BASEFLOW and
 * FALLING, so the narrowed PEAK is unchanged and is still the one to watch,
 * but at 60 it is still twice the floor. If a later measurement puts it under
 * 30 the ladder handles it: the bucket falls through to pooled quantiles and
 * the prediction declares itself unseeded rather than claiming a conditioning
 * it does not have.
 */
export const MIN_BUCKET_ERRORS = 30;

/**
 * The placeholder band, a third of the central estimate to triple it, used
 * when neither bucket has enough history.
 *
 * Its one job is never to imply more confidence than exists. Measured
 * persistence error at 24 hours has a 90th percentile of 56 percent and a
 * 99th of roughly 150 percent, so half to double would be about the real
 * interval on a calm day and far too tight in a storm, which is exactly when
 * an unseeded interval is most likely to be wrong. A third to triple sits
 * outside anything observed, so it reads as "we do not know yet".
 */
export const PLACEHOLDER_BAND_FACTOR = 3;

/**
 * The horizons every active forecaster issues at, in hours.
 *
 * Three rather than one because they fail differently: persistence is close
 * at 24 hours and hopeless at 72, climatology is equally indifferent at both,
 * and a model that beats neither at 24 may still earn its place at 72.
 */
export const HORIZON_HOURS = [24, 48, 72] as const;

/**
 * How often predictions are issued. Six hours, so issue times land on 00, 06,
 * 12 and 18 UTC, which is the cadence the scheduled workflow runs on and the
 * one the seeding hindcast walks so its issue times match the live record's.
 */
export const ISSUE_INTERVAL_HOURS = 6;

/**
 * How far back the skill view looks by default, in days. Spec 0010 sets 90
 * for skill and calibration alike.
 */
export const SKILL_DEFAULT_WINDOW_DAYS = 90;

/**
 * Open-Meteo's Previous Runs service, pinned as a constant (AC-R1).
 *
 * Pinned rather than assembled, because the ordinary forecast host answers the
 * same query shape with fresh runs, and a row fetched from it would carry a
 * lead of zero while looking exactly like an honest one.
 */
export const OPEN_METEO_PREVIOUS_RUNS_ENDPOINT =
  'https://previous-runs-api.open-meteo.com/v1/forecast';

/**
 * The one weather model this archive is built from, stored literally on every
 * row (AC-R12).
 *
 * Never `best_match`. That is a selector, not a model: which model backs it can
 * change as Open-Meteo extends coverage, so a row from 2024 and a row from 2026
 * could come from different physics under one label, putting a silent
 * inhomogeneity into a training set of only two and a half years.
 */
export const OPEN_METEO_MODEL = 'gfs_seamless';

/**
 * The shortest lead this pipeline will store, in hours.
 *
 * Rain arriving with a shorter lead is knowledge from the future wearing a
 * forecast's clothes. Enforced here in the parser and again by a check
 * constraint on the table, because the two catch different mistakes (AC-R2).
 */
export const MIN_LEAD_HOURS = 24;

/**
 * Rows per weather insert (AC-R16).
 *
 * A thousand rather than the observation path's five thousand, bounded by
 * Postgres's limit of 65,535 parameters in one statement: at this table's ten
 * columns a chunk of 1,000 binds 10,000, which leaves ample headroom if a
 * column is added later.
 *
 * The bound exists for cost, not elegance. The hosted store bills by operation
 * on a free tier of 200,000 a month, so writing the backfill's roughly 70,000
 * rows one at a time would spend about a third of a month's allowance in a
 * single run. Batched, the whole archive costs on the order of hundreds.
 */
export const WEATHER_INSERT_BATCH_SIZE = 1_000;
