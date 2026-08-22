import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a request body or param against a schema from
 * `@portfolio/shared`, which is the same schema the web app builds its
 * payload to.
 *
 * This replaced the global class-validator ValidationPipe. The three
 * behaviours that pipe was configured for are preserved:
 *
 * - `forbidNonWhitelisted` — every contract object is `.strict()`, so an
 *   unexpected property is a 400 rather than being silently dropped.
 * - no implicit conversion — zod does not coerce by default, so `"V5"`
 *   stays a string and fails a number field instead of becoming one. The
 *   two fields that must coerce (the multipart upload's `trueGrade`, the
 *   active toggle's string booleans) say so in the schema itself.
 * - `transform` — the parsed value is returned, so defaults declared in the
 *   schema (an absent conversation `history` becoming `[]`) reach the
 *   handler.
 *
 * Errors keep the old exception factory's shape: a BadRequestException
 * carrying an array of message strings, so clients reading `message` do not
 * change. A field name is prefixed only when the message does not already
 * name it, which the hand-written ones do.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) return result.data;

    const messages = result.error.issues.map((issue) => {
      const field = issue.path.join('.');
      if (!field || issue.message.startsWith(field)) return issue.message;
      return `${field}: ${issue.message}`;
    });

    throw new BadRequestException(
      messages.length > 0 ? messages : 'Validation failed',
    );
  }
}
