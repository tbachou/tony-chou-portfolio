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

/**
 * Which clock a reconstruction of the past is bounded by.
 *
 * `recordedAt` asks what this pipeline had learned by an instant. That is the
 * strict rule, it is what makes a backtest honest, and it is what every live
 * read uses. `validTime` asks only what was true at the gauge by that instant,
 * which is looser: it can reach a reading the pipeline had not received yet.
 *
 * The looser axis exists for one caller. The backfilled archive arrived in a
 * single pass, so nearly every row shares one `recordedAt` and a `recordedAt`
 * walk of it returns nothing at all. Spec 0010's hindcast seeding child is the
 * whole of the argument for that fallback, and the seeding hindcast is its
 * only caller. Everything else takes the default and gets the strict rule.
 */
export type KnowabilityAxis = 'recordedAt' | 'validTime';
