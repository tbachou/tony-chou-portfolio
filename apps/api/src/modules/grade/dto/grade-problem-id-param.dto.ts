import { Matches } from 'class-validator';
import { PUBLIC_ID_LENGTH, PUBLIC_ID_PATTERN } from '../photo-pool';

/**
 * The path parameter for GET /grade/problems/:publicId/image (AC-23, AC-25).
 *
 * A DTO rather than a bare `@Param('publicId')` string so the same validation
 * that guards the guess body guards the path: an id that is not fixed-length
 * lowercase hex is a 400 here, and never reaches a database lookup or a
 * presign. The global ValidationPipe applies to params exactly as it does to
 * bodies.
 */
export class GradeProblemIdParamDto {
  @Matches(PUBLIC_ID_PATTERN, {
    message: `publicId must be ${PUBLIC_ID_LENGTH} lowercase hex characters`,
  })
  publicId: string;
}
