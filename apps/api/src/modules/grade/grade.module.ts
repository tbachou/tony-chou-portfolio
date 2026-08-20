import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { GradeAnalysisService } from './grade-analysis.service';
import { GradeController } from './grade.controller';
import { GradeService } from './grade.service';

/** Grade Guesser, the daily climbing-grade game (spec 0006). */
@Module({
  imports: [AnthropicModule],
  controllers: [GradeController],
  providers: [GradeService, GradeAnalysisService],
})
export class GradeModule {}
