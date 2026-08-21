import sharp from 'sharp';
import {
  MAX_LONG_EDGE,
  STORED_CONTENT_TYPE,
  STORED_EXTENSION,
  STORED_QUALITY,
} from './grade-photos.constants';

export type ProcessedImage = {
  buffer: Buffer;
  contentType: string;
  extension: string;
  width: number;
  height: number;
};

/** Thrown when the bytes are not an image this pipeline can decode. */
export class UndecodableImageError extends Error {
  constructor(cause?: unknown) {
    super('The uploaded file could not be decoded as an image', { cause });
    this.name = 'UndecodableImageError';
  }
}

/**
 * Decode, orient, bound and re-encode one uploaded image (AC-17).
 *
 * Every upload goes through this, including one that is already small and
 * already WebP, because size is only one of the three reasons it exists:
 *
 *  - **EXIF is stripped.** A phone photo carries GPS coordinates, and a
 *    presigned URL hands the raw object to every visitor. sharp drops
 *    metadata unless asked to keep it, so this is the default behaviour and
 *    the test asserts it rather than trusting it.
 *  - **The stored media type becomes ours.** What the client claimed the file
 *    was never reaches the database; `contentType` is what this function
 *    actually produced, which matters because the vision call sends that
 *    value as the image's media type.
 *  - **The long edge is bounded**, so a 12 megapixel upload cannot sit in the
 *    bucket or travel to the model at full size.
 *
 * `.rotate()` with no argument is load bearing and easy to lose: it applies
 * the EXIF orientation flag and then discards it. Without it, stripping EXIF
 * would leave a phone photo silently sideways, since the pixels were never
 * rotated and the tag that said to rotate them is now gone.
 */
export async function processUpload(input: Buffer): Promise<ProcessedImage> {
  try {
    const { data, info } = await sharp(input)
      .rotate()
      .resize({
        width: MAX_LONG_EDGE,
        height: MAX_LONG_EDGE,
        fit: 'inside',
        // Only ever shrink. A small photo is left at its own size rather
        // than being blown up to the ceiling.
        withoutEnlargement: true,
      })
      .webp({ quality: STORED_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      contentType: STORED_CONTENT_TYPE,
      extension: STORED_EXTENSION,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    // A corrupt file, a PDF renamed to .jpg, or anything libvips will not
    // open. The caller turns this into 415; nothing is written anywhere.
    throw new UndecodableImageError(error);
  }
}
