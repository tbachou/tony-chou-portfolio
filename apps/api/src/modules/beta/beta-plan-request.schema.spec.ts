import { betaPlanRequestSchema } from '@portfolio/shared';

/**
 * The request boundary for POST /beta/plan (spec 0004, AC-7).
 *
 * Was beta-plan-request.dto.spec.ts against class-validator decorators. The
 * schema now lives in @portfolio/shared and the web app builds its payload
 * to the same object, so these cases guard both sides at once.
 */

function validPayload(): Record<string, unknown> {
  return {
    injuryArea: 'finger_pulley',
    onsetWeeksAgo: 3,
    symptoms: ['mild_swelling'],
    painBehavior: 'warms_up_then_fine',
    preInjuryGrade: 'V5',
    discipline: 'bouldering',
    goals: 'Back to V5 by fall',
    sessionsPerWeek: 3,
    equipmentAccess: ['hangboard'],
  };
}

/** The fields that failed, by path — '(root)' for whole-object issues. */
function badFields(payload: unknown): string[] {
  const result = betaPlanRequestSchema.safeParse(payload);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join('.') || '(root)');
}

describe('betaPlanRequestSchema', () => {
  it('accepts a fully populated valid payload', () => {
    expect(badFields(validPayload())).toHaveLength(0);
  });

  it('accepts a minimal payload with all optionals omitted', () => {
    const payload = validPayload();
    delete payload.goals;
    delete payload.sessionsPerWeek;
    delete payload.equipmentAccess;
    expect(badFields(payload)).toHaveLength(0);
  });

  it('rejects an injuryArea outside the fixed enum', () => {
    expect(badFields({ ...validPayload(), injuryArea: 'wrist' })).toContain(
      'injuryArea',
    );
  });

  it('caps free-text goals at 200 characters (the injection surface)', () => {
    expect(badFields({ ...validPayload(), goals: 'x'.repeat(201) })).toContain(
      'goals',
    );
    expect(badFields({ ...validPayload(), goals: 'x'.repeat(200) })).toHaveLength(
      0,
    );
  });

  it('rejects onsetWeeksAgo below 0', () => {
    expect(badFields({ ...validPayload(), onsetWeeksAgo: -1 })).toContain(
      'onsetWeeksAgo',
    );
  });

  it('rejects onsetWeeksAgo above 520', () => {
    expect(badFields({ ...validPayload(), onsetWeeksAgo: 521 })).toContain(
      'onsetWeeksAgo',
    );
  });

  it('rejects markup in preInjuryGrade via the grade regex', () => {
    expect(
      badFields({ ...validPayload(), preInjuryGrade: '<script>' }),
    ).toContain('preInjuryGrade');
  });

  it('rejects a symptom outside the fixed list', () => {
    expect(
      badFields({
        ...validPayload(),
        symptoms: ['mild_swelling', 'not_a_real_symptom'],
      }),
    ).toContain('symptoms.1');
  });

  it('rejects unknown properties in the schema itself', () => {
    // This used to be split across two layers: the DTO accepted an unknown
    // property and only the global ValidationPipe's forbidNonWhitelisted
    // rejected it. The schema is .strict(), so the contract now carries that
    // rule itself and cannot be mounted without it.
    const result = betaPlanRequestSchema.safeParse({
      ...validPayload(),
      isAdmin: true,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.code)).toContain(
      'unrecognized_keys',
    );
  });
});
