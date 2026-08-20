import { Logger } from '@nestjs/common';
import { GradeAnalysisService, parseAnalysis } from './grade-analysis.service';
import { GRADER_MODEL } from './grade.constants';
import type { PrismaService } from '../prisma/prisma.service';
import type { AiProvider } from '../anthropic/ai-provider.interface';

// Same reason as grade.service.spec.ts: the real PrismaService drags in the
// generated client and the pg adapter, and these tests touch no database.
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

jest.mock('./skill-loader', () => ({
  loadGradeSkill: jest.fn(() => '# Grade Guesser grader\nstub prompt'),
}));

const DATE = '2026-08-20';
const IMAGE_URL = 'https://tonychou.dev/grade/seed-a.png';

function goodPayload(overrides: Record<string, unknown> = {}) {
  return {
    grade: 5,
    confidence: 'medium',
    observations: ['Steep through the middle.', 'Small crimps.', 'Sparse feet.'],
    reasoning: 'The angle and the hold size put this in the mid range.',
    ...overrides,
  };
}

function makeHarness(options: { input?: unknown } = {}) {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const prisma = { gradeDay: { updateMany } } as unknown as PrismaService;

  const forceToolCall = jest.fn().mockResolvedValue({
    input: options.input ?? goodPayload(),
    inputTokens: 1500,
    outputTokens: 200,
  });

  const classifyUpstreamError = jest.fn((error: unknown) => {
    const name = error instanceof Error ? error.name : 'UnknownError';
    if (name === 'InternalServerError') {
      return { name, status: 500, retryable: true };
    }
    if (name === 'BadRequestError') {
      return { name, status: 400, retryable: false };
    }
    return null;
  });

  const ai = {
    forceToolCall,
    classifyUpstreamError,
    streamMessage: jest.fn(),
  } as unknown as AiProvider;

  return {
    prisma,
    updateMany,
    forceToolCall,
    service: new GradeAnalysisService(prisma, ai),
  };
}

function retryableError(): Error {
  return Object.assign(new Error('upstream'), { name: 'InternalServerError' });
}

describe('GradeAnalysisService', () => {
  let logged: string[];

  beforeEach(() => {
    jest.restoreAllMocks();
    logged = [];
    jest.spyOn(Logger.prototype, 'log').mockImplementation((message) => {
      logged.push(String(message));
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  describe('the happy path (AC-3)', () => {
    it('returns the parsed analysis and stores it on the day row', async () => {
      const h = makeHarness();

      const analysis = await h.service.ensureAnalysis({
        date: DATE,
        imageUrl: IMAGE_URL,
      });

      expect(analysis).toEqual({
        grade: 5,
        confidence: 'medium',
        observations: [
          'Steep through the middle.',
          'Small crimps.',
          'Sparse feet.',
        ],
        reasoning: 'The angle and the hold size put this in the mid range.',
      });
      expect(h.updateMany).toHaveBeenCalledTimes(1);
    });

    it('forces the report_grade tool and sends the photo as a URL image', async () => {
      const h = makeHarness();

      await h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL });

      const params = h.forceToolCall.mock.calls[0][0];
      expect(params.toolName).toBe('report_grade');
      expect(params.model).toBe(GRADER_MODEL);
      expect(params.imageUrl).toBe(IMAGE_URL);
      expect(params.maxRetries).toBe(0);
      expect(params.inputSchema.required).toEqual([
        'grade',
        'confidence',
        'observations',
        'reasoning',
      ]);
      expect(params.inputSchema.properties.grade).toMatchObject({
        type: 'integer',
        minimum: 0,
        maximum: 8,
      });
    });

    it('sends the model the photo and nothing about the pool or the answer', async () => {
      const h = makeHarness();

      await h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL });

      const params = h.forceToolCall.mock.calls[0][0];
      // Spec 0006: "the model receives only the photo, never the manifest note
      // or pool metadata, so its guess is honestly blind."
      expect(params.userMessage).not.toMatch(/note|pool|grade is|answer/i);
      expect(JSON.stringify(params.userMessage)).not.toContain(DATE);
    });

    it('writes the analysis only while the day still has none', async () => {
      const h = makeHarness();

      await h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL });

      expect(h.updateMany).toHaveBeenCalledWith({
        where: { date: DATE, modelGrade: null },
        data: expect.objectContaining({
          modelGrade: 5,
          modelConfidence: 'medium',
          model: GRADER_MODEL,
          inputTokens: 1500,
          outputTokens: 200,
        }),
      });
    });

    it('logs one structured line per call, with no visitor content in it', async () => {
      const h = makeHarness();

      await h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL });

      expect(logged).toHaveLength(1);
      expect(JSON.parse(logged[0])).toMatchObject({
        agent: 'grade-grader',
        model: GRADER_MODEL,
        date: DATE,
        inputTokens: 1500,
        outputTokens: 200,
        grade: 5,
        confidence: 'medium',
        retried: false,
        outcome: 'ok',
      });
    });
  });

  describe('one call per day under concurrency (AC-4)', () => {
    it('collapses simultaneous first guesses into a single model call', async () => {
      const h = makeHarness();

      const [a, b, c] = await Promise.all([
        h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL }),
        h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL }),
        h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL }),
      ]);

      expect(h.forceToolCall).toHaveBeenCalledTimes(1);
      expect(h.updateMany).toHaveBeenCalledTimes(1);
      // Every concurrent caller gets the same answer, so the day's reveals
      // agree with each other.
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    });

    it('keeps separate days on separate calls', async () => {
      const h = makeHarness();

      await Promise.all([
        h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL }),
        h.service.ensureAnalysis({ date: '2026-08-21', imageUrl: IMAGE_URL }),
      ]);

      expect(h.forceToolCall).toHaveBeenCalledTimes(2);
    });
  });

  describe('graceful degradation and retry (AC-5)', () => {
    it('returns null instead of throwing when the call fails outright', async () => {
      const h = makeHarness();
      h.forceToolCall.mockRejectedValue(
        Object.assign(new Error('nope'), { name: 'BadRequestError' }),
      );

      await expect(
        h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL }),
      ).resolves.toBeNull();
      expect(h.updateMany).not.toHaveBeenCalled();
    });

    it('retries once on a retryable upstream error and succeeds', async () => {
      const h = makeHarness();
      h.forceToolCall
        .mockRejectedValueOnce(retryableError())
        .mockResolvedValueOnce({
          input: goodPayload({ grade: 7 }),
          inputTokens: 10,
          outputTokens: 5,
        });

      const analysis = await h.service.ensureAnalysis({
        date: DATE,
        imageUrl: IMAGE_URL,
      });

      expect(analysis?.grade).toBe(7);
      expect(h.forceToolCall).toHaveBeenCalledTimes(2);
      expect(JSON.parse(logged[0])).toMatchObject({ retried: true, outcome: 'ok' });
    });

    it('does not retry an error the provider calls non-retryable', async () => {
      const h = makeHarness();
      h.forceToolCall.mockRejectedValue(
        Object.assign(new Error('bad'), { name: 'BadRequestError' }),
      );

      await h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL });

      expect(h.forceToolCall).toHaveBeenCalledTimes(1);
    });

    it('logs a failure with the error name only, never the raw message', async () => {
      const h = makeHarness();
      h.forceToolCall.mockRejectedValue(
        Object.assign(new Error('secret upstream detail'), {
          name: 'BadRequestError',
        }),
      );

      await h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL });

      expect(logged).toHaveLength(1);
      const line = JSON.parse(logged[0]);
      expect(line).toMatchObject({ outcome: 'error', error: 'BadRequestError 400' });
      expect(logged[0]).not.toContain('secret upstream detail');
    });

    it('lets a later guess retry, because a failure marks nothing permanent', async () => {
      const h = makeHarness();
      h.forceToolCall.mockRejectedValueOnce(
        Object.assign(new Error('down'), { name: 'BadRequestError' }),
      );

      const first = await h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL });
      const second = await h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL });

      expect(first).toBeNull();
      expect(second?.grade).toBe(5);
      expect(h.forceToolCall).toHaveBeenCalledTimes(2);
    });

    it('treats an unusable tool payload as a failed call, not a made-up grade', async () => {
      const h = makeHarness({ input: { grade: 'V5', confidence: 'medium' } });

      await expect(
        h.service.ensureAnalysis({ date: DATE, imageUrl: IMAGE_URL }),
      ).resolves.toBeNull();
      expect(h.updateMany).not.toHaveBeenCalled();
    });
  });
});

describe('parseAnalysis', () => {
  it('accepts a well-formed payload', () => {
    expect(parseAnalysis(goodPayload())?.grade).toBe(5);
  });

  it.each([0, 8])('accepts the boundary grade V%i', (grade) => {
    expect(parseAnalysis(goodPayload({ grade }))?.grade).toBe(grade);
  });

  it.each([-1, 9, 4.5, '5', null, undefined, NaN])(
    'rejects the out-of-contract grade %p',
    (grade) => {
      expect(parseAnalysis(goodPayload({ grade }))).toBeNull();
    },
  );

  it('rejects a confidence outside the enum', () => {
    expect(parseAnalysis(goodPayload({ confidence: 'certain' }))).toBeNull();
  });

  it('rejects empty or missing reasoning', () => {
    expect(parseAnalysis(goodPayload({ reasoning: '   ' }))).toBeNull();
    expect(parseAnalysis(goodPayload({ reasoning: undefined }))).toBeNull();
  });

  it('rejects a non-object payload', () => {
    expect(parseAnalysis(null)).toBeNull();
    expect(parseAnalysis('a grade')).toBeNull();
  });

  it('drops non-string and blank observations rather than failing the call', () => {
    const parsed = parseAnalysis(
      goodPayload({ observations: ['real', 42, '', '  ', 'also real'] }),
    );

    expect(parsed?.observations).toEqual(['real', 'also real']);
  });

  it('survives observations being absent entirely', () => {
    expect(parseAnalysis(goodPayload({ observations: undefined }))?.observations).toEqual(
      [],
    );
  });

  it('caps the observation count', () => {
    const parsed = parseAnalysis(
      goodPayload({ observations: Array.from({ length: 20 }, (_, i) => `o${i}`) }),
    );

    expect(parsed?.observations).toHaveLength(6);
  });

  it('truncates an overlong observation and reasoning rather than dropping them', () => {
    const parsed = parseAnalysis(
      goodPayload({ observations: ['x'.repeat(500)], reasoning: 'y'.repeat(5000) }),
    );

    expect(parsed?.observations[0]).toHaveLength(240);
    expect(parsed?.observations[0].endsWith('…')).toBe(true);
    expect(parsed?.reasoning).toHaveLength(1200);
  });
});
