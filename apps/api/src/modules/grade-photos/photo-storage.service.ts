import { randomBytes } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  OBJECT_KEY_PREFIX,
  OBJECT_KEY_RANDOM_BYTES,
  PRESIGN_TTL_SECONDS,
} from './grade-photos.constants';

/**
 * The private bucket holding photo objects (spec 0006 R1).
 *
 * No default: an unset bucket is a deployment mistake, and guessing a name
 * would turn it into a confusing 404 from S3 instead of a clear failure here.
 */
export function resolvePhotoBucket(): string {
  const bucket = process.env.GRADE_PHOTO_BUCKET?.trim();
  if (!bucket) {
    throw new Error('GRADE_PHOTO_BUCKET is not set');
  }
  return bucket;
}

/** The region the bucket lives in. Shares the variable Bedrock already uses. */
export function resolvePhotoRegion(): string {
  const region = process.env.AWS_REGION?.trim();
  if (!region) {
    throw new Error('AWS_REGION is not set');
  }
  return region;
}

/**
 * A fresh object key.
 *
 * Deliberately NOT derived from the slug, for two independent reasons the
 * spec spells out. A slug derived key means a duplicate slug upload
 * overwrites a live photo's bytes before the insert fails, and the rollback
 * then deletes an object a live row points at. And a key like
 * `north-gym-blue-prow` puts a gym circuit colour — which encodes a grade
 * band — into the presigned URL, handing a climber a hint before they guess
 * (AC-2). Random keys close both, and mean a rollback delete can only ever
 * remove the object its own upload just wrote (AC-9).
 */
export function newObjectKey(extension: string): string {
  return `${OBJECT_KEY_PREFIX}${randomBytes(OBJECT_KEY_RANDOM_BYTES).toString('hex')}.${extension}`;
}

/**
 * Reads and writes photo objects, and mints the presigned URLs browsers use.
 *
 * Browsers never reach S3 directly: the bucket blocks all public access, so
 * every read goes through a URL signed here with the api's own credentials
 * (AC-13, AC-14). A presigned URL carries exactly the api's GetObject grant
 * and no more, so it can never outrank the IAM policy behind it.
 */
@Injectable()
export class PhotoStorageService {
  private readonly logger = new Logger(PhotoStorageService.name);
  private client: S3Client | null = null;

  /**
   * Constructed on first use rather than in the constructor.
   *
   * This module is registered unconditionally, so an api booting without
   * GRADE_PHOTO_BUCKET set must still start — the variable is only needed by
   * the endpoints that touch storage, and it lands in Render by hand after
   * the terraform apply.
   */
  private getClient(): S3Client {
    this.client ??= new S3Client({ region: resolvePhotoRegion() });
    return this.client;
  }

  /** Write the bytes. Runs BEFORE the row insert, per AC-9. */
  async put(objectKey: string, body: Buffer, contentType: string): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: resolvePhotoBucket(),
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Fetch the bytes, for the vision call to base64 encode (AC-15, used from R6). */
  async getBytes(objectKey: string): Promise<Buffer> {
    const result = await this.getClient().send(
      new GetObjectCommand({
        Bucket: resolvePhotoBucket(),
        Key: objectKey,
      }),
    );
    if (!result.Body) {
      throw new Error(`Photo object ${objectKey} has no body`);
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  /**
   * The AC-9 rollback: remove an object whose row insert failed.
   *
   * Never throws. A failed rollback leaves an orphan object, which the spec
   * accepts as harmless precisely because keys are random and never reused —
   * so this can only ever have targeted the object its own upload wrote.
   * Letting it throw would replace a useful error (the duplicate slug the
   * caller is about to report) with a confusing one about cleanup.
   */
  async deleteQuietly(objectKey: string): Promise<void> {
    try {
      await this.getClient().send(
        new DeleteObjectCommand({
          Bucket: resolvePhotoBucket(),
          Key: objectKey,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to roll back photo object ${objectKey}: ${
          error instanceof Error ? error.name : 'unknown error'
        }`,
      );
    }
  }

  /** A time limited GET URL for one object (AC-14). */
  async presignGet(objectKey: string): Promise<string> {
    return getSignedUrl(
      this.getClient(),
      new GetObjectCommand({
        Bucket: resolvePhotoBucket(),
        Key: objectKey,
      }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
  }
}
