import { IsInt, Max, Min } from 'class-validator';
import { GRADE_MAX, GRADE_MIN } from '../grade.constants';

/**
 * The entire request body for POST /grade/guess (spec 0006, AC-8).
 *
 * One validated integer is the whole input surface for the feature, which is
 * the point: with no free-text field anywhere, the game has no prompt
 * injection surface and nothing a visitor typed can reach the database or a
 * log line by construction (AC-6). Do not add a string field here without a
 * spec change.
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
}
