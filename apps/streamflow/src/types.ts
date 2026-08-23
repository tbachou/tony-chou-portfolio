/**
 * Domain types for the pipeline's pure logic.
 *
 * These deliberately mirror the Prisma enums by value rather than importing
 * the generated client, so parsing, windowing and the as of reconstruction can
 * be tested without a database or a generate step.
 */

export type Qualifier = 'PROVISIONAL' | 'APPROVED';

/** One reading as it arrived from USGS, before the store has seen it. */
export interface Reading {
  validTime: Date;
  valueCfs: number;
  qualifier: Qualifier;
}

/**
 * One reading as the store holds it, carrying both time axes.
 *
 * `gaugeId` is part of the type rather than left to the caller because the as
 * of reconstruction must partition by it. With one gauge, omitting it is
 * correct; with two, it is silently wrong.
 */
export interface StoredObservation {
  gaugeId: string;
  validTime: Date;
  recordedAt: Date;
  valueCfs: number;
  qualifier: Qualifier;
}
