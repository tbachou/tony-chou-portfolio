import { Module } from '@nestjs/common';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { GradePhotosModule } from '../grade-photos/grade-photos.module';
import { GradeAnalysisService } from './grade-analysis.service';
import { GradeController } from './grade.controller';
import { GradeService } from './grade.service';

/** Grade Guesser, the daily climbing-grade game (spec 0006). */
@Module({
  // GradePhotosModule exports PhotoStorageService, which mints the day's
  // presigned image URL (AC-14). That module is registered unconditionally, so
  // importing it here does not un-hide the game.
  imports: [AnthropicModule, GradePhotosModule],
  controllers: [GradeController],
  providers: [GradeService, GradeAnalysisService],
})
export class GradeModule {}
