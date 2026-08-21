import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { GRADE_MAX, GRADE_MIN } from '../../grade/grade.constants';
import {
  GRADE_PHOTO_SOURCES,
  SLUG_PATTERN,
  type GradePhotoSourceValue,
} from '../grade-photos.constants';

/**
 * The upload form (AC-17).
 *
 * Multipart, so every field arrives as a string and `@Type` coercion does the
 * work the JSON body parser would otherwise have done. The global
 * ValidationPipe's whitelist and forbidNonWhitelisted still apply, so an
 * unexpected field is a 400 rather than something silently ignored.
 *
 * Note what is NOT here: `objectKey` and `contentType`. Both are produced by
 * the server — a random key and the image pipeline's own output — so there is
 * no field through which a client could name where its bytes land or claim a
 * media type the bytes are not (AC-17).
 */
export class CreateGradePhotoDto {
  /**
   * The owner set slug, which is also the row's primary key and the daily
   * cycle's sort key. Lowercase, hyphens, 3 to 64 characters.
   */
  @IsString()
  @Matches(SLUG_PATTERN, {
    message:
      'id must be 3 to 64 characters of lowercase letters, digits and hyphens, and may not start with a hyphen',
  })
  id!: string;

  /** The owner's gym grade for this problem. */
  @Type(() => Number)
  @IsInt({ message: `trueGrade must be an integer ${GRADE_MIN} to ${GRADE_MAX}` })
  @Min(GRADE_MIN)
  @Max(GRADE_MAX)
  trueGrade!: number;

  /**
   * Where the photo came from. Required, so provenance is data rather than
   * memory: an `unlicensed_test` row is kept out of the cycle once the game
   * is enabled (AC-18) instead of going live by being forgotten.
   */
  @IsIn(GRADE_PHOTO_SOURCES, {
    message: `source must be one of: ${GRADE_PHOTO_SOURCES.join(', ')}`,
  })
  source!: GradePhotoSourceValue;

  /** Where it came from in prose: a URL, a photographer, a permission reference. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceNote?: string;

  /** Location or credit line, shown to the visitor after the reveal. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
