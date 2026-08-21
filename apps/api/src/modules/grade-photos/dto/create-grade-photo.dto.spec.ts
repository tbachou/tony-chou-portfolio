import 'reflect-metadata';
import { validate, type ValidationError } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateGradePhotoDto } from './create-grade-photo.dto';
import { SetPhotoActiveDto } from './set-photo-active.dto';

function valid(overrides: Record<string, unknown> = {}) {
  return {
    id: 'north-gym-blue-prow',
    trueGrade: '5',
    source: 'own_photo',
    ...overrides,
  };
}

async function errorsFor(
  payload: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(CreateGradePhotoDto, payload));
}

function constraintsOn(errors: ValidationError[], property: string): string[] {
  const error = errors.find((e) => e.property === property);
  return Object.keys(error?.constraints ?? {});
}

describe('CreateGradePhotoDto (AC-17)', () => {
  it('accepts a well formed upload', async () => {
    expect(await errorsFor(valid())).toHaveLength(0);
  });

  describe('the slug', () => {
    // AC-1's deterministic ordering sorts on these, so they have to be
    // lexically comparable rather than free-form.
    it.each(['abc', 'north-gym-blue-prow', 'v8-project-2026', 'a'.repeat(64)])(
      'accepts %s',
      async (id) => {
        expect(constraintsOn(await errorsFor(valid({ id })), 'id')).toEqual([]);
      },
    );

    it.each([
      ['too short', 'ab'],
      ['too long', 'a'.repeat(65)],
      ['uppercase', 'North-Gym'],
      ['leading hyphen', '-leading'],
      ['underscores', 'north_gym'],
      ['spaces', 'north gym'],
      ['a slash that would reshape the object key', 'north/../gym'],
      ['empty', ''],
    ])('rejects %s', async (_label, id) => {
      expect(constraintsOn(await errorsFor(valid({ id })), 'id')).toContain(
        'matches',
      );
    });
  });

  describe('the grade', () => {
    it.each(['0', '4', '8'])('accepts V%s from a multipart field', async (trueGrade) => {
      // Multipart sends everything as a string, so the DTO has to coerce
      // where the JSON body parser would otherwise have handed over a number.
      expect(
        constraintsOn(await errorsFor(valid({ trueGrade })), 'trueGrade'),
      ).toEqual([]);
    });

    it('rejects a grade above the V8 ceiling', async () => {
      expect(
        constraintsOn(await errorsFor(valid({ trueGrade: '9' })), 'trueGrade'),
      ).toContain('max');
    });

    it('rejects a negative grade', async () => {
      expect(
        constraintsOn(await errorsFor(valid({ trueGrade: '-1' })), 'trueGrade'),
      ).toContain('min');
    });

    it('rejects a fractional grade', async () => {
      expect(
        constraintsOn(await errorsFor(valid({ trueGrade: '3.5' })), 'trueGrade'),
      ).toContain('isInt');
    });

    it('rejects a grade written as text', async () => {
      expect(
        constraintsOn(await errorsFor(valid({ trueGrade: 'V5' })), 'trueGrade'),
      ).toContain('isInt');
    });
  });

  describe('the source', () => {
    it.each(['own_photo', 'permission_given', 'licensed', 'unlicensed_test'])(
      'accepts %s',
      async (source) => {
        expect(
          constraintsOn(await errorsFor(valid({ source })), 'source'),
        ).toEqual([]);
      },
    );

    it('is required, so provenance can never be omitted', async () => {
      // The whole point of the column: copyright provenance is data rather
      // than something remembered, so an upload cannot skip it (AC-18).
      const payload = valid();
      delete (payload as Record<string, unknown>).source;

      expect(constraintsOn(await errorsFor(payload), 'source')).toContain('isIn');
    });

    it('rejects a source outside the enum', async () => {
      expect(
        constraintsOn(await errorsFor(valid({ source: 'probably_fine' })), 'source'),
      ).toContain('isIn');
    });
  });

  describe('the optional notes', () => {
    it('accepts an upload with neither note', async () => {
      expect(await errorsFor(valid())).toHaveLength(0);
    });

    it('accepts both notes', async () => {
      expect(
        await errorsFor(
          valid({ note: 'North wall', sourceNote: 'Shot on my phone' }),
        ),
      ).toHaveLength(0);
    });

    it('caps note length', async () => {
      expect(
        constraintsOn(await errorsFor(valid({ note: 'x'.repeat(201) })), 'note'),
      ).toContain('maxLength');
    });

    it('caps sourceNote length', async () => {
      expect(
        constraintsOn(
          await errorsFor(valid({ sourceNote: 'x'.repeat(501) })),
          'sourceNote',
        ),
      ).toContain('maxLength');
    });
  });

  it('has no field for the object key or the content type', async () => {
    // Both are produced by the server: a random key, and the image pipeline's
    // own output. There is deliberately no field through which a client could
    // name where its bytes land or claim a media type the bytes are not.
    const properties = Object.keys(
      plainToInstance(CreateGradePhotoDto, valid()),
    );

    expect(properties).not.toContain('objectKey');
    expect(properties).not.toContain('contentType');
  });
});

describe('SetPhotoActiveDto', () => {
  async function activeErrors(payload: Record<string, unknown>) {
    return validate(plainToInstance(SetPhotoActiveDto, payload));
  }

  it.each([true, false])('accepts the boolean %p', async (active) => {
    expect(await activeErrors({ active })).toHaveLength(0);
  });

  it.each(['true', 'false'])('accepts the form string %p', async (active) => {
    expect(await activeErrors({ active })).toHaveLength(0);
  });

  it('rejects anything that is not a boolean', async () => {
    expect(await activeErrors({ active: 'yes' })).not.toHaveLength(0);
    expect(await activeErrors({})).not.toHaveLength(0);
  });
});
