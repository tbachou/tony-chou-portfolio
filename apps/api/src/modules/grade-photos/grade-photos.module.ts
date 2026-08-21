import { Module } from '@nestjs/common';
import { GradePhotosController } from './grade-photos.controller';
import { GradePhotosService } from './grade-photos.service';
import { PhotoStorageService } from './photo-storage.service';

/**
 * Grade Guesser's photo pool admin (spec 0006 R3).
 *
 * Registered unconditionally in app.module.ts, unlike GradeModule. The pool
 * has to be fillable while the game is still hidden behind
 * GRADE_GAME_ENABLED, which is the point of putting storage before the vision
 * call in the revised build order.
 *
 * PhotoStorageService is exported because the game itself needs it from R4
 * onward: presigning the day's image, and reading the bytes the vision call
 * base64 encodes.
 */
@Module({
  controllers: [GradePhotosController],
  providers: [GradePhotosService, PhotoStorageService],
  exports: [PhotoStorageService],
})
export class GradePhotosModule {}
