import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../grade/grade.service';
import type { CreateGradePhotoDto } from './dto/create-grade-photo.dto';
import { processUpload, UndecodableImageError } from './image-pipeline';
import { newObjectKey, PhotoStorageService } from './photo-storage.service';

/** One row as the admin list shows it, with a URL the browser can actually load. */
export type GradePhotoListItem = {
  id: string;
  trueGrade: number;
  source: string;
  sourceNote: string | null;
  note: string | null;
  active: boolean;
  createdAt: Date;
  imageUrl: string;
};

@Injectable()
export class GradePhotosService {
  private readonly logger = new Logger(GradePhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PhotoStorageService,
  ) {}

  /**
   * The pool, newest first, each with a presigned URL.
   *
   * These are the full size objects, not real thumbnails. At a pool of about
   * ten that is fine, and it is called out here so nobody later reads this as
   * a thumbnail pipeline that quietly went missing.
   */
  async list(): Promise<GradePhotoListItem[]> {
    const photos = await this.prisma.gradePhoto.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return Promise.all(
      photos.map(async (photo) => ({
        id: photo.id,
        trueGrade: photo.trueGrade,
        source: photo.source,
        sourceNote: photo.sourceNote,
        note: photo.note,
        active: photo.active,
        createdAt: photo.createdAt,
        imageUrl: await this.storage.presignGet(photo.objectKey),
      })),
    );
  }

  /**
   * Add one photo: object first, then row, rollback the object if the row
   * fails (AC-9).
   *
   * The order is the guarantee. Writing the row first would let a row name an
   * object that does not exist yet, which is exactly what AC-9 forbids, and
   * the daily cycle could pick it in the window between the two writes. The
   * reverse gap is deliberately accepted: a crash between the two, or a
   * failed rollback delete, leaves an object with no row. That is harmless
   * because object keys are random and never reused, so nothing else can be
   * pointing at it.
   */
  async create(
    dto: CreateGradePhotoDto,
    file: Buffer,
  ): Promise<GradePhotoListItem> {
    // Decode before touching storage, so an undecodable file costs nothing
    // and leaves nothing behind.
    let processed;
    try {
      processed = await processUpload(file);
    } catch (error) {
      if (error instanceof UndecodableImageError) {
        throw new UnsupportedMediaTypeException(error.message);
      }
      throw error;
    }

    const objectKey = newObjectKey(processed.extension);
    await this.storage.put(objectKey, processed.buffer, processed.contentType);

    // The rollback catch wraps the insert and NOTHING else. It used to span
    // the presign and the response build too, so a presign failure after a
    // committed row deleted that row's object and left the exact state AC-9
    // forbids: a row naming an object that is gone. Anything below this block
    // runs with the row already durable, so a failure there must not delete.
    // `.catch` on the insert rather than a try block around it, matching
    // setActive below. The handler always throws, so the inferred row type
    // survives; a `let photo` outside a try would be plain `any` here, since
    // this workspace has noImplicitAny off, and every field below would stop
    // being checked against the model.
    const photo = await this.prisma.gradePhoto
      .create({
        data: {
          id: dto.id,
          objectKey,
          contentType: processed.contentType,
          trueGrade: dto.trueGrade,
          source: dto.source,
          sourceNote: dto.sourceNote ?? null,
          note: dto.note ?? null,
        },
      })
      .catch(async (error: unknown) => {
        // The row did not land, so its object must not survive. This can only
        // remove the key generated moments ago in this same call.
        await this.storage.deleteQuietly(objectKey);

        if (isUniqueViolation(error)) {
          // A duplicate slug. The existing photo's bytes were never touched:
          // this upload wrote its own random key and just deleted it again.
          throw new ConflictException(
            `A photo with id "${dto.id}" already exists`,
          );
        }
        throw error;
      });

    this.logger.log(
      `Grade photo added: ${photo.id} (${processed.width}x${processed.height}, ${processed.buffer.length} bytes, source ${photo.source})`,
    );

    return {
      id: photo.id,
      trueGrade: photo.trueGrade,
      source: photo.source,
      sourceNote: photo.sourceNote,
      note: photo.note,
      active: photo.active,
      createdAt: photo.createdAt,
      // A signer failure must not report a committed upload as a failure: the
      // admin would retry the same slug and get a 409 for a photo that is
      // already there. The pool list re-signs on every load, so an empty URL
      // costs one missing thumbnail until the next refresh.
      imageUrl: await this.storage
        .presignGet(photo.objectKey)
        .catch(() => ''),
    };
  }

  /** Deactivate or reactivate one photo (AC-17). Rows are never deleted. */
  async setActive(id: string, active: boolean): Promise<GradePhotoListItem> {
    const photo = await this.prisma.gradePhoto
      .update({ where: { id }, data: { active } })
      .catch((error: unknown) => {
        if (isRecordNotFound(error)) {
          throw new NotFoundException(`No photo with id "${id}"`);
        }
        throw error;
      });

    return {
      id: photo.id,
      trueGrade: photo.trueGrade,
      source: photo.source,
      sourceNote: photo.sourceNote,
      note: photo.note,
      active: photo.active,
      createdAt: photo.createdAt,
      imageUrl: await this.storage.presignGet(photo.objectKey),
    };
  }
}

/** Prisma's "record to update not found" error, duck-typed like isUniqueViolation. */
export function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2025'
  );
}
