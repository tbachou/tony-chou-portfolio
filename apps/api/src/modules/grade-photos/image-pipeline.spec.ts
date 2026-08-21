import sharp from 'sharp';
import {
  MAX_LONG_EDGE,
  STORED_CONTENT_TYPE,
  STORED_EXTENSION,
} from './grade-photos.constants';
import { processUpload, UndecodableImageError } from './image-pipeline';

// Real sharp, not a mock. The whole point of these assertions is that the
// bytes coming out have actually been re-encoded — a mocked pipeline would
// prove nothing about EXIF, orientation or the stored media type.

/** sharp's writeable EXIF shape: named IFD blocks of string tags. */
type ExifInput = Record<string, Record<string, string>>;

async function jpeg(
  width: number,
  height: number,
  options: { exif?: ExifInput; orientation?: number } = {},
): Promise<Buffer> {
  let image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 140, b: 160 },
    },
  }).jpeg();

  if (options.exif || options.orientation) {
    image = image.withMetadata({
      ...(options.orientation ? { orientation: options.orientation } : {}),
      ...(options.exif ? { exif: options.exif } : {}),
    });
  }
  return image.toBuffer();
}

describe('processUpload (AC-17)', () => {
  it('re-encodes to the stored format whatever came in', async () => {
    const processed = await processUpload(await jpeg(400, 300));

    expect(processed.contentType).toBe(STORED_CONTENT_TYPE);
    expect(processed.extension).toBe(STORED_EXTENSION);

    // The bytes really are that format, not just labelled it.
    const metadata = await sharp(processed.buffer).metadata();
    expect(metadata.format).toBe('webp');
  });

  it('bounds the long edge and keeps the aspect ratio', async () => {
    const processed = await processUpload(await jpeg(4000, 3000));

    expect(Math.max(processed.width, processed.height)).toBe(MAX_LONG_EDGE);
    // 4:3 in, 4:3 out.
    expect(processed.width / processed.height).toBeCloseTo(4 / 3, 2);
  });

  it('bounds a portrait photo by its height', async () => {
    const processed = await processUpload(await jpeg(1200, 4000));

    expect(processed.height).toBe(MAX_LONG_EDGE);
    expect(processed.width).toBeLessThan(MAX_LONG_EDGE);
  });

  it('leaves a small photo at its own size rather than enlarging it', async () => {
    const processed = await processUpload(await jpeg(300, 200));

    expect(processed.width).toBe(300);
    expect(processed.height).toBe(200);
  });

  it('strips EXIF, so a phone photo cannot hand out its GPS', async () => {
    // The reason this matters: a presigned URL gives every visitor the raw
    // object, so anything left in the file is public.
    const withExif = await jpeg(500, 400, {
      exif: {
        IFD0: { Copyright: 'Tony' },
        GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'W' },
      },
    });
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const processed = await processUpload(withExif);

    expect((await sharp(processed.buffer).metadata()).exif).toBeUndefined();
  });

  it('applies EXIF orientation before discarding it', async () => {
    // Orientation 6 means "rotate 90 degrees clockwise on display". Stripping
    // EXIF without applying it first would leave the photo silently sideways,
    // because the pixels were never rotated and the tag saying to rotate them
    // is now gone.
    const sideways = await jpeg(800, 400, { orientation: 6 });

    const processed = await processUpload(sideways);

    // Landscape in, portrait out: the rotation was baked into the pixels.
    expect(processed.height).toBeGreaterThan(processed.width);
  });

  it('rejects bytes that are not a decodable image', async () => {
    const notAnImage = Buffer.from('%PDF-1.4 this is not an image at all');

    await expect(processUpload(notAnImage)).rejects.toThrow(
      UndecodableImageError,
    );
  });

  it('rejects an empty upload', async () => {
    await expect(processUpload(Buffer.alloc(0))).rejects.toThrow(
      UndecodableImageError,
    );
  });

  it('produces the media type from the bytes, not from any client claim', async () => {
    // A PNG uploaded as "image/jpeg" still lands as the pipeline's own
    // output, so contentType can never be a lie the client told.
    const png = await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const processed = await processUpload(png);

    expect(processed.contentType).toBe(STORED_CONTENT_TYPE);
    expect((await sharp(processed.buffer).metadata()).format).toBe('webp');
  });
});
