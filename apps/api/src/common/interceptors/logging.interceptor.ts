import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = Date.now();

    // Hooks the raw response's 'finish' event rather than the RxJS pipeline,
    // since @Res()-driven routes (the SSE conversation endpoint) never
    // return a value for Nest to serialize — this fires correctly either
    // way, with the real final statusCode and full request latency.
    res.on('finish', () => {
      this.logger.log(
        JSON.stringify({
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          latencyMs: Date.now() - start,
        }),
      );
    });

    return next.handle();
  }
}
