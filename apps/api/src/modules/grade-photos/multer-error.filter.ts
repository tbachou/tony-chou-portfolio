import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES } from './grade-photos.constants';

/**
 * Turn multer's size abort into the 413 the spec's error table promises.
 *
 * The cap is enforced by multer as the stream arrives rather than by a
 * validator after the fact, which is the whole point: on a free Render
 * instance the danger is buffering a 100 MB upload into memory and only then
 * deciding it was too big. The cost of enforcing it there is that the failure
 * surfaces as a raw multer error, which Nest would otherwise turn into a 500.
 *
 * The error is duck-typed on its `code` rather than imported from multer, the
 * same way Prisma's error codes are handled elsewhere in this api, so nothing
 * here depends on a transitive package's class identity.
 */
@Catch()
export class MulterErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(MulterErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const mapped = isFileTooLarge(exception)
      ? new PayloadTooLargeException(
          `The image is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`,
        )
      : exception;

    if (mapped instanceof HttpException) {
      const status = mapped.getStatus();
      response.status(status).json(mapped.getResponse());
      return;
    }

    // Nothing this filter recognises. Log the name only, never the message:
    // an upload error could echo request content, and no visitor-supplied
    // text is ever logged anywhere in this api.
    this.logger.error(
      `Unhandled grade photo upload error: ${
        exception instanceof Error ? exception.name : 'unknown error'
      }`,
    );
    response.status(500).json({
      statusCode: 500,
      message: 'Internal server error',
    });
  }
}

/** Multer's `LIMIT_FILE_SIZE`, raised when the stream passes the cap. */
export function isFileTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'LIMIT_FILE_SIZE'
  );
}
