import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client';

/**
 * Builds the pipeline's Prisma client.
 *
 * Spec 0010 gives this project its own database, so it reads
 * `PIPELINE_DATABASE_URL` and never the portfolio's `DATABASE_URL`. Failing
 * loudly on a missing variable beats connecting to whatever happens to be in
 * the environment.
 */
export function createPrismaClient(): PrismaClient {
  const connectionString = process.env.PIPELINE_DATABASE_URL;

  if (!connectionString) {
    throw new Error('PIPELINE_DATABASE_URL is not set');
  }

  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
