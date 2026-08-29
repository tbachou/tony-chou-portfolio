/**
 * What the read path is allowed to use.
 *
 * The pipeline writes; the web app only ever reads. Keeping the surface to
 * this file means the dashboard cannot reach for an ingest function or a
 * writer by accident, and the append only invariant stays a property of one
 * workspace rather than a habit spread across two.
 *
 * Read what that does and does not promise, because the difference matters.
 * No function exported here writes. But `createPrismaClient` hands back the
 * generated client whole, and that client carries every model's `create`,
 * `update`, `delete` and `$executeRaw`, so a consumer holding it can write
 * anything it likes. The guarantee is that nothing here leads a caller to a
 * writer, not that the database is out of reach.
 *
 * What actually keeps the web app read only is that it never calls one, and
 * `append-only.spec.ts` scans this workspace rather than that one, so the
 * check does not follow the client across the boundary. Enforcing it properly
 * would take a `SELECT` only database role for the consumer, which Prisma
 * Postgres does not currently offer. Until it does, this is a convention held
 * up by review, and it is written down plainly here so that nobody later
 * mistakes it for something the type system is enforcing.
 */
export { createPrismaClient } from './db';
export {
  observationsAsOf,
  latestStoredValidTime,
  provisionalValidTimes,
} from './asof/observations.repository';
export { reconstructAsOf } from './asof/as-of';
// The only way the read path may see predictions: it filters out the hindcast
// rows that seed the intervals. An endpoint writing its own where clause on
// predictions would fail in the flattering direction, which is why the
// interval maths and the bucket query stay off this surface entirely.
export {
  publicPredictions,
  publicScoredErrors,
} from './forecast/predictions.repository';
export type { PublicPredictionFilter } from './forecast/predictions.repository';
export { rollingSkill, SKILL_WINDOW_DAYS } from './forecast/skill';
export type { ScoredError, SkillPoint, SkillSeries } from './forecast/skill';
// Coverage, and the read that feeds it. `gradedIntervals` takes the hindcast
// flag as an argument rather than filtering it away, because here the two
// populations are the point: the backtest says whether the method calibrates
// at all, the live rows say whether it is calibrating now, and the whole
// value of the panel is showing them apart. Summing them is what would be
// dishonest, and that is the caller's job to avoid — it is why this takes a
// flag instead of a boolean the caller can forget.
export { gradedIntervals } from './forecast/predictions.repository';
export { calibration } from './forecast/calibration';
export type {
  CalibrationReport,
  CoverageGroup,
  GradedInterval,
  IntervalSource,
} from './forecast/calibration';
export { HORIZON_HOURS, MIN_BUCKET_ERRORS, SKILL_DEFAULT_WINDOW_DAYS } from './config';
export { GAUGE, DISPLAY_TIMEZONE } from './config';
export type {
  KnowabilityAxis,
  Qualifier,
  Reading,
  StoredObservation,
} from './types';
