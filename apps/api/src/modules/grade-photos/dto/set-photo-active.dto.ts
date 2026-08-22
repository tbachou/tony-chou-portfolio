import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * The active toggle (AC-17).
 *
 * Deactivating is the only way a photo leaves the pool: rows are never
 * deleted, and GradeProblem's foreign key is onDelete: Restrict so the
 * database enforces that rather than a habit. Deactivating hides the problem
 * from the served set, but a visitor who already holds its id is still
 * answered, because the retirement is not their problem.
 */
export class SetPhotoActiveDto {
  // JSON sends a real boolean; the string forms are accepted so the same
  // endpoint works from a form post without a second shape to maintain.
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  active!: boolean;
}
