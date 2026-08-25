import { createPrismaClient } from '@portfolio/streamflow';

/**
 * The one client the site uses to read the streamflow store.
 *
 * One per server process, not one per request. `createPrismaClient` opens a
 * node-postgres pool, and the streamflow page is `force-dynamic`, so building
 * a client inside the request would open a fresh pool on every page view and
 * never close it: a crawler, or a few concurrent visitors, would reach the
 * database's connection limit and everything reading the store would start
 * failing together.
 *
 * Parked on `globalThis` rather than held in a module constant because
 * Next.js re-evaluates modules on every edit in development, which would
 * leak a pool per save.
 *
 * Read only by construction. The package's public surface exports no writer,
 * and the pipeline writes from GitHub Actions instead.
 */
const globalForPrisma = globalThis as unknown as {
  streamflowPrisma?: ReturnType<typeof createPrismaClient>;
};

export function streamflowDb() {
  globalForPrisma.streamflowPrisma ??= createPrismaClient();
  return globalForPrisma.streamflowPrisma;
}
