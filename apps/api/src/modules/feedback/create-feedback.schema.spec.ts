import { createFeedbackSchema } from '@portfolio/shared';

/**
 * The request boundary for POST /feedback (spec 0005, AC-I1/I2/I4).
 *
 * Was create-feedback.dto.spec.ts against class-validator decorators.
 */

function validPayload(): Record<string, unknown> {
  return {
    message: 'The submit button does nothing on Safari.',
    category: 'bug',
    source: 'portfolio',
  };
}

function badFields(payload: unknown): string[] {
  const result = createFeedbackSchema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.') || '(root)');
}

describe('createFeedbackSchema', () => {
  it('accepts a fully populated valid payload', () => {
    expect(badFields(validPayload())).toHaveLength(0);
  });

  it('accepts a minimal payload with category omitted (AC-I1: category is optional)', () => {
    const payload = validPayload();
    delete payload.category;
    expect(badFields(payload)).toHaveLength(0);
  });

  it('rejects an empty message', () => {
    expect(badFields({ ...validPayload(), message: '' })).toContain('message');
  });

  it('rejects a missing message', () => {
    const payload = validPayload();
    delete payload.message;
    expect(badFields(payload)).toContain('message');
  });

  it('rejects a message over 2000 characters (AC-I4)', () => {
    expect(
      badFields({ ...validPayload(), message: 'x'.repeat(2001) }),
    ).toContain('message');
  });

  it('accepts a message at exactly 2000 characters', () => {
    expect(
      badFields({ ...validPayload(), message: 'x'.repeat(2000) }),
    ).toHaveLength(0);
  });

  it('accepts a message at exactly 1 character', () => {
    expect(badFields({ ...validPayload(), message: 'x' })).toHaveLength(0);
  });

  it('rejects a category outside the fixed enum', () => {
    expect(badFields({ ...validPayload(), category: 'praise' })).toContain(
      'category',
    );
  });

  it('rejects a missing source (AC-I1: source is required)', () => {
    const payload = validPayload();
    delete payload.source;
    expect(badFields(payload)).toContain('source');
  });

  it('rejects a source outside beta|portfolio', () => {
    expect(badFields({ ...validPayload(), source: 'twitter' })).toContain(
      'source',
    );
  });

  it('rejects unknown properties, so no identity field can be smuggled in (AC-I2)', () => {
    const result = createFeedbackSchema.safeParse({
      ...validPayload(),
      email: 'someone@example.com',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.code)).toContain(
      'unrecognized_keys',
    );
  });
});
