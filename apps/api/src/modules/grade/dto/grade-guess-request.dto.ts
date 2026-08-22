import { IsInt, Matches, Max, Min } from 'class-validator';
import { GRADE_MAX, GRADE_MIN } from '../grade.constants';
import { PUBLIC_ID_LENGTH, PUBLIC_ID_PATTERN } from '../photo-pool';

/**
 * The entire request body for POST /grade/guess (spec 0006, AC-8, AC-23).
 *
 * One validated integer and one machine-shaped id are the whole input
 * surface for the feature, which is the point: with no free-text field
 * anywhere, the game has no prompt injection surface and nothing a visitor
 * typed can reach the database or a log line by construction (AC-6). Do not
 * add a free-text field here without a spec change.
 *
 * `publicId` is not visitor prose either — it is echoed back from the api's
 * own /grade/problems response, constrained to fixed-length hex here, and
 * resolved against the photo table rather than trusted. It is never stored as
 * given and never reaches a model.
 *
 * The global ValidationPipe runs whitelist + forbidNonWhitelisted, so an
 * unexpected extra property is a 400 rather than being quietly dropped, and
 * it does not enable implicit conversion — so `"V5"` stays a string and
 * fails @IsInt rather than being coerced.
 */
export class GradeGuessRequestDto {
  @IsInt({ message: 'guess must be an integer V-grade' })
  @Min(GRADE_MIN, { message: `guess must be at least V${GRADE_MIN}` })
  @Max(GRADE_MAX, { message: `guess must be at most V${GRADE_MAX}` })
  guess: number;

  /**
   * Which problem is being guessed, by its opaque public id (AC-23).
   *
   * Replaced the UTC date on 2026-08-22 with the daily cadence. Required, and
   * a stronger identity than the date ever was: the guess names its problem
   * outright, so there is no "which photo is today" question left to get
   * wrong and no rollover to guard against (the dropped AC-19).
   *
   * Never the photo's `id` slug, which would carry the gym circuit colour and
   * hand over the grade band before the guess.
   */
  @Matches(PUBLIC_ID_PATTERN, {
    message: `publicId must be ${PUBLIC_ID_LENGTH} lowercase hex characters`,
  })
  publicId: string;
}
