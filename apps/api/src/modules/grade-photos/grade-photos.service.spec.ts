import {
  ConflictException,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import sharp from 'sharp';
import type { PrismaService } from '../prisma/prisma.service';
import { GradePhotosService, isRecordNotFound } from './grade-photos.service';
import type { PhotoStorageService } from './photo-storage.service';
import type { CreateGradePhoto } from '@portfolio/shared';

jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

const DTO: CreateGradePhoto = {
  id: 'north-gym-blue-prow',
  trueGrade: 5,
  source: 'own_photo',
  note: 'North wall',
};

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: DTO.id,
    objectKey: 'photos/abc123.webp',
    contentType: 'image/webp',
    trueGrade: 5,
    source: 'own_photo',
    sourceNote: null,
    note: 'North wall',
    active: true,
    createdAt: new Date('2026-08-21T10:00:00.000Z'),
    ...overrides,
  };
}

async function realJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 200, height: 150, channels: 3, background: '#888' },
  })
    .jpeg()
    .toBuffer();
}

function makeDeps(options: { createError?: unknown; rows?: unknown[] } = {}) {
  const prisma = {
    gradePhoto: {
      findMany: jest.fn(() => Promise.resolve(options.rows ?? [row()])),
      create: jest.fn<
        Promise<ReturnType<typeof row>>,
        [{ data: Record<string, unknown> }]
      >(() =>
        options.createError
          ? Promise.reject(options.createError)
          : Promise.resolve(row()),
      ),
      update: jest.fn((args: { where: { id: string }; data: { active: boolean } }) =>
        Promise.resolve(row({ active: args.data.active })),
      ),
    },
  };

  const storage = {
    // Typed off the real signatures rather than by naming unused parameters,
    // so `mock.calls[0][0]` is a string here without an `as` cast.
    put: jest.fn<Promise<void>, [string, Buffer, string]>(() =>
      Promise.resolve(),
    ),
    deleteQuietly: jest.fn<Promise<void>, [string]>(() => Promise.resolve()),
    presignGet: jest.fn((key: string) =>
      Promise.resolve(`https://bucket.s3.us-east-2.amazonaws.com/${key}?X-Amz-Signature=sig`),
    ),
    getBytes: jest.fn(),
  };

  const service = new GradePhotosService(
    prisma as unknown as PrismaService,
    storage as unknown as PhotoStorageService,
  );

  return { service, prisma, storage };
}

describe('GradePhotosService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create: object first, then row (AC-9)', () => {
    it('writes the object before the row', async () => {
      const { service, prisma, storage } = makeDeps();
      const order: string[] = [];
      storage.put.mockImplementation(() => {
        order.push('put');
        return Promise.resolve();
      });
      prisma.gradePhoto.create.mockImplementation(() => {
        order.push('insert');
        return Promise.resolve(row());
      });

      await service.create(DTO, await realJpeg());

      // The order IS the guarantee. Reversed, a row could name an object that
      // does not exist yet, and the daily cycle could pick it in between.
      expect(order).toEqual(['put', 'insert']);
    });

    it('stores the pipeline\'s content type, never a client claim', async () => {
      const { service, storage, prisma } = makeDeps();

      await service.create(DTO, await realJpeg());

      expect(storage.put).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        'image/webp',
      );
      expect(prisma.gradePhoto.create.mock.calls[0][0].data.contentType).toBe(
        'image/webp',
      );
    });

    it('uses a random object key that does not contain the slug', async () => {
      // A slug-derived key would put a gym circuit colour into the presigned
      // URL, which is a grade hint before the guess (AC-2), and would let a
      // duplicate-slug upload overwrite a live photo's bytes.
      const { service, storage } = makeDeps();

      await service.create(DTO, await realJpeg());

      const key = storage.put.mock.calls[0][0];
      expect(key).toMatch(/^photos\/[0-9a-f]{16}\.webp$/);
      expect(key).not.toContain('blue');
      expect(key).not.toContain(DTO.id);
    });

    it('generates a different key for every upload', async () => {
      const { service, storage } = makeDeps();
      const file = await realJpeg();

      await service.create(DTO, file);
      await service.create(DTO, file);

      expect(storage.put.mock.calls[0][0]).not.toBe(
        storage.put.mock.calls[1][0],
      );
    });

    it('deletes its own object when the row insert fails', async () => {
      const { service, storage } = makeDeps({
        createError: Object.assign(new Error('dup'), { code: 'P2002' }),
      });

      await expect(service.create(DTO, await realJpeg())).rejects.toThrow(
        ConflictException,
      );

      // Exactly the key this call wrote, and nothing else.
      const written = storage.put.mock.calls[0][0];
      expect(storage.deleteQuietly).toHaveBeenCalledWith(written);
      expect(storage.deleteQuietly).toHaveBeenCalledTimes(1);
    });

    it('reports a duplicate slug as 409 without touching the existing bytes', async () => {
      const { service, storage } = makeDeps({
        createError: Object.assign(new Error('dup'), { code: 'P2002' }),
      });

      await expect(service.create(DTO, await realJpeg())).rejects.toThrow(
        ConflictException,
      );

      // The only key ever named is the fresh random one, so the existing
      // photo's object was never written to nor deleted.
      const written = storage.put.mock.calls[0][0];
      const deleted = storage.deleteQuietly.mock.calls[0][0];
      expect(deleted).toBe(written);
    });

    it('rolls back on a non-duplicate insert failure too, and rethrows it', async () => {
      const { service, storage } = makeDeps({
        createError: Object.assign(new Error('connection lost'), { code: 'P1001' }),
      });

      await expect(service.create(DTO, await realJpeg())).rejects.toThrow(
        'connection lost',
      );
      expect(storage.deleteQuietly).toHaveBeenCalledTimes(1);
    });

    it('writes nothing at all when the file cannot be decoded', async () => {
      const { service, storage, prisma } = makeDeps();

      await expect(
        service.create(DTO, Buffer.from('not an image')),
      ).rejects.toThrow(UnsupportedMediaTypeException);

      // Decoding happens before storage is touched, so an undecodable upload
      // costs nothing and leaves nothing behind.
      expect(storage.put).not.toHaveBeenCalled();
      expect(prisma.gradePhoto.create).not.toHaveBeenCalled();
      expect(storage.deleteQuietly).not.toHaveBeenCalled();
    });

    it('returns the created row with a presigned URL', async () => {
      const { service } = makeDeps();

      const created = await service.create(DTO, await realJpeg());

      expect(created.id).toBe(DTO.id);
      expect(created.trueGrade).toBe(5);
      expect(created.active).toBe(true);
      expect(created.imageUrl).toContain('X-Amz-Signature');
    });

    it('never deletes the object of a row that committed, even if presigning fails', async () => {
      // The rollback used to be scoped over the presign as well, so a presign
      // failure after a durable row deleted that row's object and produced the
      // one state AC-9 forbids: a committed row naming an object that is gone.
      const { service, storage, prisma } = makeDeps();
      storage.presignGet.mockRejectedValueOnce(new Error('signer unavailable'));

      const created = await service.create(DTO, await realJpeg());

      expect(prisma.gradePhoto.create).toHaveBeenCalledTimes(1);
      expect(storage.deleteQuietly).not.toHaveBeenCalled();
      // And the committed upload reports as the success it was. Reporting a
      // failure would send the admin back to retry the same slug, where the
      // unique constraint answers 409 for a photo that is already there.
      expect(created.id).toBe(DTO.id);
      expect(created.imageUrl).toBe('');
    });
  });

  describe('list', () => {
    it('returns rows newest first, each with a presigned URL', async () => {
      const { service, prisma } = makeDeps({
        rows: [row({ id: 'newer' }), row({ id: 'older' })],
      });

      const items = await service.list();

      expect(prisma.gradePhoto.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'desc' },
      });
      expect(items.map((i) => i.id)).toEqual(['newer', 'older']);
      expect(items[0].imageUrl).toContain('X-Amz-Signature');
    });

    it('lists inactive photos too, since they are never deleted', async () => {
      const { service } = makeDeps({ rows: [row({ active: false })] });

      const items = await service.list();

      expect(items[0].active).toBe(false);
    });

    it('never exposes the raw object key to the client', async () => {
      // The key is an implementation detail; what the admin page needs is a
      // URL it can load. Leaking the key adds nothing and widens the surface.
      const { service } = makeDeps();

      const items = await service.list();

      expect(items[0]).not.toHaveProperty('objectKey');
    });
  });

  describe('setActive', () => {
    it('deactivates a photo and returns the updated row', async () => {
      const { service, prisma } = makeDeps();

      const updated = await service.setActive('north-gym-blue-prow', false);

      expect(prisma.gradePhoto.update).toHaveBeenCalledWith({
        where: { id: 'north-gym-blue-prow' },
        data: { active: false },
      });
      expect(updated.active).toBe(false);
    });

    it('reactivates a photo', async () => {
      const { service } = makeDeps();

      expect((await service.setActive('north-gym-blue-prow', true)).active).toBe(
        true,
      );
    });

    it('reports an unknown id as 404', async () => {
      const { service, prisma } = makeDeps();
      prisma.gradePhoto.update.mockRejectedValue(
        Object.assign(new Error('not found'), { code: 'P2025' }),
      );

      await expect(service.setActive('ghost', false)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rethrows a failure that is not a missing record', async () => {
      const { service, prisma } = makeDeps();
      prisma.gradePhoto.update.mockRejectedValue(
        Object.assign(new Error('connection lost'), { code: 'P1001' }),
      );

      await expect(service.setActive('x', false)).rejects.toThrow(
        'connection lost',
      );
    });
  });
});

describe('isRecordNotFound', () => {
  it('recognises only P2025', () => {
    expect(isRecordNotFound({ code: 'P2025' })).toBe(true);
    expect(isRecordNotFound({ code: 'P2002' })).toBe(false);
    expect(isRecordNotFound(new Error('nope'))).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
  });
});
