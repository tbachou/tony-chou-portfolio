import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

export function validationExceptionFactory(
  errors: ValidationError[],
): BadRequestException {
  const messages = flattenErrors(errors);
  return new BadRequestException(
    messages.length > 0 ? messages : 'Validation failed',
  );
}

function flattenErrors(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...flattenErrors(error.children ?? []),
  ]);
}
