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
 * Read only by convention, not by construction, and the distinction is worth
 * keeping straight. The package's public surface exports no function that
 * writes, but `createPrismaClient` returns the generated client whole, so
 * this handle can write to the forecast store as easily as read from it.
 * Nothing here stops it; what stops it is that every caller on this side only
 * ever reads, which is a thing to check in review rather than a thing the
 * compiler knows.
 *
 * The credential is the pipeline's own, with full write access, because
 * Prisma Postgres provisions database users itself and offers no `SELECT`
 * only role to hand this side instead. If that changes, give Vercel its own
 * read only connection string and this comment can make a real promise.
 */
const globalForPrisma = globalThis as unknown as {
  streamflowPrisma?: ReturnType<typeof createPrismaClient>;
};

export function streamflowDb() {
  globalForPrisma.streamflowPrisma ??= createPrismaClient();
  return globalForPrisma.streamflowPrisma;
}
