import type { PrismaClient } from '../generated/prisma/client';
import type { Reading } from '../types';

/**
 * Rows per insert. Large enough that a backfill is a handful of statements,
 * small enough that no single statement is unwieldy.
 */
export const INSERT_BATCH_SIZE = 5_000;

/**
 * Appends readings to the store, in batches, oldest first.
 *
 * Not wrapped in a transaction. The first run backfills about two and a half
 * years, and Prisma caps an interactive transaction at five seconds while that
 * insert takes closer to forty, so the atomic version could never complete.
 *
 * Giving up atomicity costs nothing here and buys resumability. The store is
 * append only, so a half finished write leaves fewer rows rather than wrong
 * ones, and because the batches ascend by validTime, whatever landed is a
 * complete prefix. The next run anchors its window to the newest stored
 * reading and resumes exactly there instead of leaving a hole in the middle.
 *
 * `onProgress` reports the running total after each batch, so a caller can
 * record how far it got when a later batch fails.
 */
export async function writeObservations(
  prisma: PrismaClient,
  gaugeId: string,
  ingestRunId: string,
  recordedAt: Date,
  readings: readonly Reading[],
  onProgress?: (written: number) => void,
): Promise<number> {
  // Sorted explicitly rather than trusting the source's order, because the
  // resumability above depends on it.
  const ordered = [...readings].sort(
    (a, b) => a.validTime.getTime() - b.validTime.getTime(),
  );

  let written = 0;

  for (let index = 0; index < ordered.length; index += INSERT_BATCH_SIZE) {
    const batch = ordered.slice(index, index + INSERT_BATCH_SIZE);

    const result = await prisma.observation.createMany({
      data: batch.map((reading) => ({
        gaugeId,
        validTime: reading.validTime,
        recordedAt,
        valueCfs: reading.valueCfs,
        qualifier: reading.qualifier,
        ingestRunId,
      })),
    });

    written += result.count;
    onProgress?.(written);
  }

  return written;
}
