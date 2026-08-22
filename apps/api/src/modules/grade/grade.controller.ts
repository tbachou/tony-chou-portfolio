import {
  gradeGuessRequestSchema,
  gradeProblemIdParamSchema,
  type GradeGuessRequest,
  type GradeProblemIdParam,
} from '@portfolio/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { CollapsedIpThrottlerGuard } from '../../common/guards/collapsed-ip-throttler.guard';
import {
  GradeService,
  type GradeProblemImage,
  type GradeProblemList,
  type GradeReveal,
} from './grade.service';

/**
 * Grade Guesser, the climbing-grade game (spec 0006).
 *
 * Fully public like Beta's endpoints, and rate limited with the api's own
 * throttler using the IPv6-collapsing tracker (AC-8). No Beta-style daily cap
 * machinery exists here on purpose: the feature's cost ceiling is one vision
 * call per problem ever, by construction, so traffic cannot move the bill.
 *
 * Every route addresses a problem by its opaque public id, never by the
 * photo's slug, which would carry the gym circuit colour and with it the grade
 * band (AC-23).
 */
@Controller('grade')
@AllowAnonymous()
@UseGuards(CollapsedIpThrottlerGuard)
export class GradeController {
  constructor(private readonly gradeService: GradeService) {}

  /**
   * The playable set: ordered public ids and a count, nothing else (AC-22).
   *
   * Returns no grade of any kind and no image URL — submitting a guess is the
   * only way to learn an answer (AC-2), and images are minted per problem
   * below (AC-25).
   *
   * Loose limits: the page fetches this on load, and a visitor reloading or
   * opening the game in a few tabs is ordinary behaviour.
   */
  @Get('problems')
  @Throttle({
    short: { limit: 30, ttl: 60_000 },
    long: { limit: 300, ttl: 3_600_000 },
  })
  async problems(): Promise<GradeProblemList> {
    return this.gradeService.listProblems();
  }

  /**
   * One problem's presigned image, minted when the page shows it (AC-25).
   *
   * Limits are looser than the list's rather than tighter, because a visitor
   * working through a set of ten calls this once per problem while calling the
   * list once. It still writes nothing and costs nothing but a signature.
   */
  @Get('problems/:publicId/image')
  @Throttle({
    short: { limit: 60, ttl: 60_000 },
    long: { limit: 600, ttl: 3_600_000 },
  })
  async problemImage(
    @Param(new ZodValidationPipe(gradeProblemIdParamSchema))
    params: GradeProblemIdParam,
  ): Promise<GradeProblemImage> {
    return this.gradeService.getProblemImage(params.publicId);
  }

  /**
   * Submit a guess against one problem and reveal it.
   *
   * Tighter than the reads because each call writes: it increments that
   * problem's anonymous histogram, and the first one on a problem pays for the
   * vision call. Left at the daily-era numbers deliberately — a visitor
   * working through five to ten problems in a sitting stays well inside 40 an
   * hour, and 5 a minute is still slower than anyone who is actually reading
   * the reveals.
   */
  @Post('guess')
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    long: { limit: 40, ttl: 3_600_000 },
  })
  async guess(
    @Body(new ZodValidationPipe(gradeGuessRequestSchema)) body: GradeGuessRequest,
  ): Promise<GradeReveal> {
    return this.gradeService.submitGuess(body.guess, body.publicId);
  }
}
