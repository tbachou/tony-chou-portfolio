import { betaPlanRequestSchema, type BetaPlanRequest } from '@portfolio/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';
import {
  hashIp,
  rateLimitIdentity,
  resolveClientIp,
} from '../../common/utils/ip-hash.util';
import { writeSseEvent } from '../conversation/sse.util';
import { BetaThrottlerGuard } from './beta-throttler.guard';
import { BetaService } from './beta.service';
import { BetaUsageService, type BetaStatus } from './beta-usage.service';

@Controller('beta')
@AllowAnonymous()
export class BetaController {
  constructor(
    private readonly betaService: BetaService,
    private readonly betaUsage: BetaUsageService,
  ) {}

  @Get('status')
  @UseGuards(BetaThrottlerGuard)
  @Throttle({
    short: { limit: 30, ttl: 60_000 },
    long: { limit: 300, ttl: 3_600_000 },
  })
  async status(): Promise<BetaStatus> {
    return this.betaUsage.getStatus();
  }

  @Post('plan')
  @UseGuards(BetaThrottlerGuard)
  // 3 requests per hour per IP, in memory (AC-5). The short window keeps its
  // module default; the hourly cap is the real constraint.
  @Throttle({ long: { limit: 3, ttl: 3_600_000 } })
  async plan(
    @Body(new ZodValidationPipe(betaPlanRequestSchema)) body: BetaPlanRequest,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new InternalServerErrorException(
        'ANTHROPIC_API_KEY is not configured',
      );
    }

    // Per-IP identity uses the /64 prefix for IPv6 (audit finding).
    const hashedIp = hashIp(rateLimitIdentity(resolveClientIp(req)));

    // Persisted caps checked before the stream opens, so 429/503 arrive as
    // plain HTTP errors (AC-5). After this point failures are SSE `error`
    // events on the open stream.
    await this.betaUsage.assertAvailable(hashedIp);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await this.betaService.generatePlan({
      input: body,
      hashedIp,
      emit: (event, data) => writeSseEvent(res, event, data),
    });

    res.end();
  }
}
