import 'reflect-metadata';
import { validate, type ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { BetaPlanRequestDto } from './beta-plan-request.dto';

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

async function errorsFor(
  payload: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(BetaPlanRequestDto, payload));
}

function constraintsOn(
  errors: ValidationError[],
  property: string,
): string[] {
  const error = errors.find((e) => e.property === property);
  return Object.keys(error?.constraints ?? {});
}

describe('BetaPlanRequestDto', () => {
  it('accepts a fully populated valid payload', async () => {
    expect(await errorsFor(validPayload())).toHaveLength(0);
  });

  it('accepts a minimal payload with all optionals omitted', async () => {
    const payload = validPayload();
    delete payload.goals;
    delete payload.sessionsPerWeek;
    delete payload.equipmentAccess;
    expect(await errorsFor(payload)).toHaveLength(0);
  });

  it('rejects an injuryArea outside the fixed enum', async () => {
    const errors = await errorsFor({ ...validPayload(), injuryArea: 'wrist' });
    expect(constraintsOn(errors, 'injuryArea')).toContain('isIn');
  });

  it('caps free-text goals at 200 characters (the injection surface)', async () => {
    const errors = await errorsFor({
      ...validPayload(),
      goals: 'x'.repeat(201),
    });
    expect(constraintsOn(errors, 'goals')).toContain('maxLength');
    expect(await errorsFor({ ...validPayload(), goals: 'x'.repeat(200) }))
      .toHaveLength(0);
  });

  it('rejects onsetWeeksAgo below 0', async () => {
    const errors = await errorsFor({ ...validPayload(), onsetWeeksAgo: -1 });
    expect(constraintsOn(errors, 'onsetWeeksAgo')).toContain('min');
  });

  it('rejects onsetWeeksAgo above 520', async () => {
    const errors = await errorsFor({ ...validPayload(), onsetWeeksAgo: 521 });
    expect(constraintsOn(errors, 'onsetWeeksAgo')).toContain('max');
  });

  it('rejects markup in preInjuryGrade via the grade regex', async () => {
    const errors = await errorsFor({
      ...validPayload(),
      preInjuryGrade: '<script>',
    });
    expect(constraintsOn(errors, 'preInjuryGrade')).toContain('matches');
  });

  it('rejects a symptom outside the fixed list', async () => {
    const errors = await errorsFor({
      ...validPayload(),
      symptoms: ['mild_swelling', 'not_a_real_symptom'],
    });
    expect(constraintsOn(errors, 'symptoms')).toContain('isIn');
  });

  it('strips/rejects unknown properties only at the pipe layer, not in the DTO', async () => {
    // whitelist/forbidNonWhitelisted enforcement lives in the global
    // ValidationPipe (main.ts), not in the DTO decorators: a bare validate()
    // accepts the extra property, and the same instance fails once the
    // pipe's options are applied. Both halves are asserted so a regression
    // in either layer's assumption surfaces here.
    const instance = plainToInstance(BetaPlanRequestDto, {
      ...validPayload(),
      isAdmin: true,
    });

    expect(await validate(instance)).toHaveLength(0);

    const pipeStyleErrors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const unknownProp = pipeStyleErrors.find((e) => e.property === 'isAdmin');
    expect(Object.keys(unknownProp?.constraints ?? {})).toContain(
      'whitelistValidation',
    );
  });
});
