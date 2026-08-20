import { Module } from '@nestjs/common';
import { GradeController } from './grade.controller';
import { GradeService } from './grade.service';

/** Grade Guesser, the daily climbing-grade game (spec 0006). */
@Module({
  controllers: [GradeController],
  providers: [GradeService],
})
export class GradeModule {}
