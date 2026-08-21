import { IsInt, Matches, Max, Min } from 'class-validator';
import { GRADE_MAX, GRADE_MIN } from '../grade.constants';

/** UTC calendar date, `YYYY-MM-DD`. Shape only; the server checks the value. */
const UTC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The entire request body for POST /grade/guess (spec 0006, AC-8).
 *
 * One validated integer and one machine-shaped date are the whole input
 * surface for the feature, which is the point: with no free-text field
 * anywhere, the game has no prompt injection surface and nothing a visitor
 * typed can reach the database or a log line by construction (AC-6). Do not
 * add a free-text field here without a spec change.
 *
 * `date` is not visitor prose either — it is echoed back from the api's own
 * /grade/today response, constrained to `YYYY-MM-DD` here, and compared
 * against the server's clock rather than trusted (AC-19). It is never stored
 * and never reaches a model.
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
   * The UTC date the visitor was actually shown, echoed from /grade/today.
   *
   * Required rather than optional: an absent date would have to fall back to
   * "assume today", which is exactly the silent regrade AC-19 exists to stop.
   */
  @Matches(UTC_DATE_PATTERN, {
    message: 'date must be a UTC calendar date in YYYY-MM-DD form',
  })
  date: string;
}
