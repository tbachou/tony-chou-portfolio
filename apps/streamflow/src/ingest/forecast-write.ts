import { WEATHER_INSERT_BATCH_SIZE } from '../config';
import type { PrismaClient } from '../generated/prisma/client';
import type { ForecastValue } from '../types';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Derives the nominal issue time of a forecast value.
 *
 * `leadHours` is canonical and this is the derived direction (AC-R4). Deriving
 * the other way, reading a lead back out of two timestamps, would let a
 * rounding difference forge a duplicate that the unique key could not catch.
 *
 * Nominal, not observed: the Previous Runs endpoint does not report a run's
 * true initialisation time, so this asserts a round number the real run may sit
 * a few hours either side of.
 */
export function issuedAtFor(validTime: Date, leadHours: number): Date {
  return new Date(validTime.getTime() - leadHours * HOUR_MS);
}

/**
 * Appends forecast values to the store, in batches, oldest first.
 *
 * Batched because the store bills by operation (AC-R16). The backfill is
 * roughly seventy thousand rows against a free tier of 200,000 operations a
 * month, so a row at a time would spend about a third of a month's allowance in
 * one run. At `WEATHER_INSERT_BATCH_SIZE` the whole archive costs hundreds.
 *
 * Not wrapped in a transaction, for the same reason `writeObservations` is not:
 * the store is append only, so a half finished write leaves fewer rows rather
 * than wrong ones, and because the batches ascend by `validTime` whatever
 * landed is a complete prefix that the next run resumes cleanly after.
 *
 * `onProgress` reports the running total after each batch, so a caller can
 * record how far it got when a later batch fails.
 */
export async function writeForecasts(
  prisma: PrismaClient,
  gaugeId: string,
  ingestRunId: string,
  recordedAt: Date,
  model: string,
  values: readonly ForecastValue[],
  onProgress?: (written: number) => void,
): Promise<number> {
  // Sorted explicitly rather than trusting the source's order, because the
  // resumability above depends on it.
  const ordered = [...values].sort(
    (a, b) => a.validTime.getTime() - b.validTime.getTime(),
  );

  let written = 0;

  for (let index = 0; index < ordered.length; index += WEATHER_INSERT_BATCH_SIZE) {
    const batch = ordered.slice(index, index + WEATHER_INSERT_BATCH_SIZE);

    const result = await prisma.weatherForecast.createMany({
      data: batch.map((value) => ({
        gaugeId,
        validTime: value.validTime,
        leadHours: value.leadHours,
        issuedAt: issuedAtFor(value.validTime, value.leadHours),
        recordedAt,
        precipMm: value.precipMm,
        tempC: value.tempC ?? null,
        model,
        ingestRunId,
      })),
    });

    written += result.count;
    onProgress?.(written);
  }

  return written;
}
