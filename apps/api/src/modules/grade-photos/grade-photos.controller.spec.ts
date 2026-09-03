import 'reflect-metadata';

// The controller imports GradePhotosService as a value (Nest needs the class
// for DI), which transitively pulls in PrismaService and the generated client.
// Stub it at the test boundary, the same way every other spec here does.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

import { BadRequestException } from '@nestjs/common';
import { GradePhotosController } from './grade-photos.controller';
import type { GradePhotosService } from './grade-photos.service';

function makeController() {
  const service = {
    list: jest.fn(() => Promise.resolve([])),
    create: jest.fn(() => Promise.resolve({ id: 'x' })),
    setActive: jest.fn(() => Promise.resolve({ id: 'x', active: false })),
  };
  const controller = new GradePhotosController(
    service as unknown as GradePhotosService,
  );
  return { controller, service };
}

const FILE = {
  buffer: Buffer.from('bytes'),
  size: 5,
  mimetype: 'image/jpeg',
  originalname: 'problem.jpg',
};

const BODY = {
  id: 'north-gym-blue-prow',
  trueGrade: 5,
  source: 'own_photo' as const,
};

describe('GradePhotosController (AC-17)', () => {
  describe('authentication posture', () => {
    // The 401 comes from the GLOBAL better-auth guard, which applies unless a
    // route opts out with @AllowAnonymous(). That decorator sets the "PUBLIC"
    // metadata key, so the real invariant to protect is that this key is
    // absent here — if someone ever adds @AllowAnonymous() to this admin
    // controller, these fail rather than silently opening the upload endpoint
    // to the internet.
    it('does not mark the controller anonymous', () => {
      expect(
        Reflect.getMetadata('PUBLIC', GradePhotosController),
      ).toBeUndefined();
    });

    it.each(['list', 'create', 'setActive'])(
      'does not mark %s anonymous',
      (handler) => {
        const method = (
          GradePhotosController.prototype as unknown as Record<string, object>
        )[handler];

        expect(Reflect.getMetadata('PUBLIC', method)).toBeUndefined();
      },
    );
  });

  describe('POST', () => {
    it('passes the buffer and the validated body to the service', async () => {
      const { controller, service } = makeController();

      await controller.create(BODY, FILE);

      expect(service.create).toHaveBeenCalledWith(BODY, FILE.buffer);
    });

    it('rejects a request with no file rather than writing an empty object', async () => {
      const { controller, service } = makeController();

      await expect(controller.create(BODY, undefined)).rejects.toThrow(
        BadRequestException,
      );
      expect(service.create).not.toHaveBeenCalled();
    });

    it('never passes the client\'s claimed mimetype through', async () => {
      // The stored content type is the image pipeline's own output, so the
      // controller hands over bytes only — there is no path by which
      // `file.mimetype` could become the row's contentType.
      const { controller, service } = makeController();

      await controller.create(BODY, { ...FILE, mimetype: 'image/svg+xml' });

      expect(service.create).toHaveBeenCalledWith(BODY, FILE.buffer);
      expect(JSON.stringify(service.create.mock.calls[0])).not.toContain('svg');
    });
  });

  describe('PATCH :id/active', () => {
    it('forwards the id and the flag', async () => {
      const { controller, service } = makeController();

      await controller.setActive({ id: 'north-gym-blue-prow' }, { active: false });

      expect(service.setActive).toHaveBeenCalledWith(
        'north-gym-blue-prow',
        false,
      );
    });
  });

  describe('GET', () => {
    it('delegates to the service', async () => {
      const { controller, service } = makeController();

      await controller.list();

      expect(service.list).toHaveBeenCalledTimes(1);
    });
  });
});
