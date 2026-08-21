import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { CollapsedIpThrottlerGuard } from '../../common/guards/collapsed-ip-throttler.guard';
import { GradeGuessRequestDto } from './dto/grade-guess-request.dto';
import { GradeService, type GradeReveal, type GradeToday } from './grade.service';

/**
 * Grade Guesser, the daily climbing-grade game (spec 0006).
 *
 * Fully public like Beta's endpoints, and rate limited with the api's own
 * throttler using the IPv6-collapsing tracker (AC-8). No Beta-style daily cap
 * machinery exists here on purpose: the feature's cost ceiling is one vision
 * call per UTC day by construction, so traffic cannot move the bill.
 */
@Controller('grade')
@AllowAnonymous()
@UseGuards(CollapsedIpThrottlerGuard)
export class GradeController {
  constructor(private readonly gradeService: GradeService) {}

  /**
   * Today's problem. Returns no grade of any kind — submitting a guess is the
   * only way to learn the answer (AC-2).
   *
   * Loose limits: the page fetches this on load, and a visitor reloading or
   * opening the game in a few tabs is ordinary behaviour.
   */
  @Get('today')
  @Throttle({
    short: { limit: 30, ttl: 60_000 },
    long: { limit: 300, ttl: 3_600_000 },
  })
  async today(): Promise<GradeToday> {
    return this.gradeService.getToday();
  }

  /**
   * Submit a guess and reveal the day.
   *
   * Tighter than /today because each call writes: it increments the day's
   * anonymous histogram, and the first one of the day pays for the vision
   * call. The limits are still generous enough for a visitor who plays,
   * reloads, and plays again from the same address.
   */
  @Post('guess')
  @Throttle({
    short: { limit: 5, ttl: 60_000 },
    long: { limit: 40, ttl: 3_600_000 },
  })
  async guess(@Body() body: GradeGuessRequestDto): Promise<GradeReveal> {
    return this.gradeService.submitGuess(body.guess, body.date);
  }
}
