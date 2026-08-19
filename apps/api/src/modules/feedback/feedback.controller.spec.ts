// @thallesp/nestjs-better-auth transitively requires better-auth's ESM-only
// dist (.mjs), which Jest's CommonJS transform cannot parse. The controller
// only uses the AllowAnonymous decorator, so stub the module at the test
// boundary instead of widening transformIgnorePatterns (see
// app.controller.spec.ts).
jest.mock('@thallesp/nestjs-better-auth', () => ({
  AllowAnonymous: () => () => undefined,
}));

// The real PrismaService pulls in the generated client and the pg adapter;
// these tests must never touch a database (repo convention). The controller
// itself never uses Prisma directly, but importing feedback.service.ts
// transitively does.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

import type { Request } from 'express';
import { FeedbackController } from './feedback.controller';
import type { FeedbackService } from './feedback.service';
import { hashIp, rateLimitIdentity, resolveClientIp } from '../../common/utils/ip-hash.util';

describe('FeedbackController', () => {
  const ORIGINAL_SALT = process.env.IP_HASH_SALT;

  beforeAll(() => {
    process.env.IP_HASH_SALT = 'test-salt';
  });

  afterAll(() => {
    process.env.IP_HASH_SALT = ORIGINAL_SALT;
  });

  it('derives hashedIp from the request and delegates to the service (AC-I1)', async () => {
    const submit = jest.fn().mockResolvedValue({ id: 'cfeedback1' });
    const controller = new FeedbackController({
      submit,
    } as unknown as FeedbackService);
    const req = { ip: '203.0.113.9', socket: {} } as unknown as Request;
    const dto = { message: 'hello', source: 'portfolio' as const };

    const result = await controller.create(dto, req);

    expect(result).toEqual({ id: 'cfeedback1' });
    const expectedHashedIp = hashIp(rateLimitIdentity(resolveClientIp(req)));
    expect(submit).toHaveBeenCalledWith(dto, expectedHashedIp);
  });

  it('never passes the raw request IP to the service — only the hashed rate-limit identity (AC-I2)', async () => {
    const submit = jest.fn().mockResolvedValue({ id: 'cfeedback2' });
    const controller = new FeedbackController({
      submit,
    } as unknown as FeedbackService);
    const req = { ip: '203.0.113.9', socket: {} } as unknown as Request;

    await controller.create(
      { message: 'hello', source: 'beta' as const },
      req,
    );

    const [, hashedIpArg] = submit.mock.calls[0] as [unknown, string];
    expect(hashedIpArg).not.toBe('203.0.113.9');
    expect(hashedIpArg).not.toContain('203.0.113.9');
  });
});
