import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateGradePhotoDto } from './dto/create-grade-photo.dto';
import { SetPhotoActiveDto } from './dto/set-photo-active.dto';
import { MAX_UPLOAD_BYTES } from './grade-photos.constants';
import {
  GradePhotosService,
  type GradePhotoListItem,
} from './grade-photos.service';
import { MulterErrorFilter } from './multer-error.filter';

/**
 * The uploaded file as multer hands it over.
 *
 * Declared structurally rather than pulled from `Express.Multer.File` so the
 * api does not take on `@types/multer` for one field, matching how the rest
 * of this module avoids depending on transitive package types.
 */
type UploadedImage = {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
};

/**
 * The Grade Guesser photo pool's admin surface (spec 0006 R3).
 *
 * Deliberately no `@AllowAnonymous()`: the global better-auth guard protects
 * every route here by default, exactly like `/internal/usage`, so an
 * unauthenticated request gets 401 before any handler runs (AC-17). Sign-up
 * is permanently disabled, so the single seeded admin is the only account
 * that can ever reach this.
 *
 * Registered unconditionally, unlike the game itself. Without that the pool
 * could not be filled until the game was already live, which is the opposite
 * of the build order the spec lays out.
 *
 * These endpoints accept free text (`note`, `sourceNote`), which the public
 * game endpoints never do. That is safe for the reason the spec gives: they
 * sit behind auth, and none of their text is ever sent to a model.
 */
@Controller('internal/grade-photos')
export class GradePhotosController {
  constructor(private readonly gradePhotos: GradePhotosService) {}

  /** The pool, newest first, each with a presigned URL the browser can load. */
  @Get()
  list(): Promise<GradePhotoListItem[]> {
    return this.gradePhotos.list();
  }

  /**
   * Add a photo.
   *
   * The size cap lives on the interceptor rather than in a validator so
   * multer aborts an oversized stream instead of buffering it whole and
   * rejecting it afterwards — the difference between a bounded request and an
   * out-of-memory kill on a free instance. MulterErrorFilter turns that abort
   * into the 413 the spec promises.
   */
  @Post()
  @UseFilters(MulterErrorFilter)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }),
  )
  async create(
    @Body() body: CreateGradePhotoDto,
    @UploadedFile() file?: UploadedImage,
  ): Promise<GradePhotoListItem> {
    if (!file) {
      throw new BadRequestException('An image file is required');
    }
    return this.gradePhotos.create(body, file.buffer);
  }

  /** Deactivate or reactivate a photo. Rows are never deleted. */
  @Patch(':id/active')
  setActive(
    @Param('id') id: string,
    @Body() body: SetPhotoActiveDto,
  ): Promise<GradePhotoListItem> {
    return this.gradePhotos.setActive(id, body.active);
  }
}
