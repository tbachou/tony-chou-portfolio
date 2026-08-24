/**
 * What the read path is allowed to use.
 *
 * The pipeline writes; the web app only ever reads. Keeping the surface to
 * this file means the dashboard cannot reach for an ingest function or a
 * writer by accident, and the append only invariant stays a property of one
 * workspace rather than a habit spread across two.
 */
export { createPrismaClient } from './db';
export {
  observationsAsOf,
  latestStoredValidTime,
  provisionalValidTimes,
} from './asof/observations.repository';
export { reconstructAsOf } from './asof/as-of';
export { GAUGE, DISPLAY_TIMEZONE } from './config';
export type { Qualifier, Reading, StoredObservation } from './types';
