import 'reflect-metadata';
import { validate, type ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateFeedbackDto } from './create-feedback.dto';

function validPayload(): Record<string, unknown> {
  return {
    message: 'The submit button does nothing on Safari.',
    category: 'bug',
    source: 'portfolio',
  };
}

async function errorsFor(
  payload: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(CreateFeedbackDto, payload));
}

function constraintsOn(errors: ValidationError[], property: string): string[] {
  const error = errors.find((e) => e.property === property);
  return Object.keys(error?.constraints ?? {});
}

describe('CreateFeedbackDto', () => {
  it('accepts a fully populated valid payload', async () => {
    expect(await errorsFor(validPayload())).toHaveLength(0);
  });

  it('accepts a minimal payload with category omitted (AC-I1: category is optional)', async () => {
    const payload = validPayload();
    delete payload.category;
    expect(await errorsFor(payload)).toHaveLength(0);
  });

  it('rejects an empty message', async () => {
    const errors = await errorsFor({ ...validPayload(), message: '' });
    expect(constraintsOn(errors, 'message')).toContain('isNotEmpty');
  });

  it('rejects a missing message', async () => {
    const payload = validPayload();
    delete payload.message;
    const errors = await errorsFor(payload);
    expect(constraintsOn(errors, 'message').length).toBeGreaterThan(0);
  });

  it('rejects a message over 2000 characters (AC-I4)', async () => {
    const errors = await errorsFor({
      ...validPayload(),
      message: 'x'.repeat(2001),
    });
    expect(constraintsOn(errors, 'message')).toContain('maxLength');
  });

  it('accepts a message at exactly 2000 characters', async () => {
    expect(
      await errorsFor({ ...validPayload(), message: 'x'.repeat(2000) }),
    ).toHaveLength(0);
  });

  it('accepts a message at exactly 1 character', async () => {
    expect(
      await errorsFor({ ...validPayload(), message: 'x' }),
    ).toHaveLength(0);
  });

  it('rejects a category outside the fixed enum', async () => {
    const errors = await errorsFor({
      ...validPayload(),
      category: 'not_a_real_category',
    });
    expect(constraintsOn(errors, 'category')).toContain('isIn');
  });

  it('rejects a missing source (AC-I1: source is required)', async () => {
    const payload = validPayload();
    delete payload.source;
    const errors = await errorsFor(payload);
    expect(constraintsOn(errors, 'source')).toContain('isIn');
  });

  it('rejects a source outside beta|portfolio', async () => {
    const errors = await errorsFor({ ...validPayload(), source: 'admin' });
    expect(constraintsOn(errors, 'source')).toContain('isIn');
  });

  it('strips/rejects unknown properties only at the pipe layer (AC-I2: no identity fields), matching the global ValidationPipe behavior', async () => {
    const instance = plainToInstance(CreateFeedbackDto, {
      ...validPayload(),
      email: 'visitor@example.com',
    });

    expect(await validate(instance)).toHaveLength(0);

    const pipeStyleErrors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const unknownProp = pipeStyleErrors.find((e) => e.property === 'email');
    expect(Object.keys(unknownProp?.constraints ?? {})).toContain(
      'whitelistValidation',
    );
  });
});
