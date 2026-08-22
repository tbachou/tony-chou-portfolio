import { Logger } from '@nestjs/common';
import { GradeAnalysisService, parseAnalysis } from './grade-analysis.service';
import {
  GRADER_MODEL_ANTHROPIC,
  GRADER_MODEL_BEDROCK,
} from './grade.constants';
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

/**
 * The two ids that travel together, and are not interchangeable.
 *
 * `photoId` is the owner's slug and keys both the row and the in-flight map;
 * `publicId` is the opaque hex the outside world uses and the ONLY one that
 * may be logged, because a slug names the gym circuit colour and a circuit
 * colour names a grade band (AC-23).
 */
const PHOTO_ID = 'north-gym-blue-prow';
const PUBLIC_ID = '9f2c4ab1d0e37b58';
const PROBLEM = { photoId: PHOTO_ID, publicId: PUBLIC_ID };

/** A second problem, for the "separate problems, separate calls" guard. */
const OTHER_PROBLEM = { photoId: 'south-cave-roof', publicId: 'a1b2c3d4e5f60789' };

/** The base64 bytes the seam now carries, not a URL (AC-15). */
const IMAGE = { data: 'aW1hZ2UtYnl0ZXM=', mediaType: 'image/webp' };

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
  const prisma = { gradeProblem: { updateMany } } as unknown as PrismaService;

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

  describe('provider routing (AC-15, AC-16)', () => {
    afterEach(() => {
      delete process.env.AI_PROVIDER;
      delete process.env.BEDROCK_MODEL_ID;
    });

    it('sends a Bedrock model id when the provider is Bedrock', async () => {
      // The second of the two independent failures the 2026-08-21 revision
      // found: a first party id means nothing to Bedrock, so the call failed
      // even before the URL image problem was reached.
      process.env.AI_PROVIDER = 'bedrock';
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      expect(h.forceToolCall.mock.calls[0][0].model).toBe(GRADER_MODEL_BEDROCK);
    });

    it('sends the first party id when the provider is the direct API', async () => {
      process.env.AI_PROVIDER = 'anthropic';
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      expect(h.forceToolCall.mock.calls[0][0].model).toBe(
        GRADER_MODEL_ANTHROPIC,
      );
    });

    it('never lets a first party id reach Bedrock', async () => {
      process.env.AI_PROVIDER = 'bedrock';
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      const sent = h.forceToolCall.mock.calls[0][0].model as string;
      expect(sent).not.toBe(GRADER_MODEL_ANTHROPIC);
      expect(sent).toMatch(/^us\.anthropic\./);
    });

    it('ignores BEDROCK_MODEL_ID, the env driven downgrade it exists to prevent', async () => {
      // The whole point of pinning: a cheaper model set for another feature
      // must not silently become the game's one daily read of the wall.
      process.env.AI_PROVIDER = 'bedrock';
      process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-cheap';
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      expect(h.forceToolCall.mock.calls[0][0].model).toBe(GRADER_MODEL_BEDROCK);
    });

    it('sends bytes and never a URL, whichever provider is in use', async () => {
      process.env.AI_PROVIDER = 'bedrock';
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      const params = h.forceToolCall.mock.calls[0][0];
      expect(params.image).toEqual(IMAGE);
      expect(params).not.toHaveProperty('imageUrl');
      expect(JSON.stringify(params)).not.toMatch(/https?:\/\//);
    });

    it('records the id actually sent on the problem row', async () => {
      // A row claiming the first party id while Bedrock served the call is how
      // a provider bug stays invisible for months.
      process.env.AI_PROVIDER = 'bedrock';
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      expect(h.updateMany.mock.calls[0][0].data.model).toBe(
        GRADER_MODEL_BEDROCK,
      );
    });
  });

  describe('the happy path (AC-3)', () => {
    it('returns the parsed analysis and stores it on the problem row', async () => {
      const h = makeHarness();

      const analysis = await h.service.ensureAnalysis({
        ...PROBLEM,
        image: IMAGE,
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

    it('forces the report_grade tool and sends the photo as image bytes', async () => {
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      const params = h.forceToolCall.mock.calls[0][0];
      expect(params.toolName).toBe('report_grade');
      expect(params.model).toBe(GRADER_MODEL_ANTHROPIC);
      expect(params.image).toEqual(IMAGE);
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

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      const params = h.forceToolCall.mock.calls[0][0];
      // Spec 0006: "the model receives only the photo, never the manifest note
      // or pool metadata, so its guess is honestly blind."
      expect(params.userMessage).not.toMatch(/note|pool|grade is|answer/i);
      // Neither id reaches the prompt. The slug matters most: it names the gym
      // circuit colour, which encodes the grade band, so leaking it into the
      // prompt would stop the model's read being blind at all (AC-23).
      const sent = JSON.stringify(params);
      expect(sent).not.toContain(PHOTO_ID);
      expect(sent).not.toContain(PUBLIC_ID);
    });

    it('writes the analysis only while the problem still has none', async () => {
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      expect(h.updateMany).toHaveBeenCalledWith({
        where: { photoId: PHOTO_ID, modelGrade: null },
        data: expect.objectContaining({
          modelGrade: 5,
          modelConfidence: 'medium',
          model: GRADER_MODEL_ANTHROPIC,
          inputTokens: 1500,
          outputTokens: 200,
        }),
      });
    });

    it('logs one structured line per call, with no visitor content in it', async () => {
      const h = makeHarness();

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      expect(logged).toHaveLength(1);
      expect(JSON.parse(logged[0])).toMatchObject({
        agent: 'grade-grader',
        model: GRADER_MODEL_ANTHROPIC,
        problem: PUBLIC_ID,
        inputTokens: 1500,
        outputTokens: 200,
        grade: 5,
        confidence: 'medium',
        retried: false,
        outcome: 'ok',
      });
    });
  });

  describe('one call per problem under concurrency (AC-4)', () => {
    it('collapses simultaneous first guesses into a single model call', async () => {
      const h = makeHarness();

      const [a, b, c] = await Promise.all([
        h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE }),
        h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE }),
        h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE }),
      ]);

      expect(h.forceToolCall).toHaveBeenCalledTimes(1);
      expect(h.updateMany).toHaveBeenCalledTimes(1);
      // Every concurrent caller gets the same answer, so the problem's
      // reveals agree with each other.
      expect(a).toEqual(b);
      expect(b).toEqual(c);
    });

    it('keeps separate problems on separate calls', async () => {
      const h = makeHarness();

      await Promise.all([
        h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE }),
        h.service.ensureAnalysis({ ...OTHER_PROBLEM, image: IMAGE }),
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
        h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE }),
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
        ...PROBLEM,
        image: IMAGE,
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

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      expect(h.forceToolCall).toHaveBeenCalledTimes(1);
    });

    it('logs a failure with the error name only, never the raw message', async () => {
      const h = makeHarness();
      h.forceToolCall.mockRejectedValue(
        Object.assign(new Error('secret upstream detail'), {
          name: 'BadRequestError',
        }),
      );

      await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

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

      const first = await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });
      const second = await h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE });

      expect(first).toBeNull();
      expect(second?.grade).toBe(5);
      expect(h.forceToolCall).toHaveBeenCalledTimes(2);
    });

    it('treats an unusable tool payload as a failed call, not a made-up grade', async () => {
      const h = makeHarness({ input: { grade: 'V5', confidence: 'medium' } });

      await expect(
        h.service.ensureAnalysis({ ...PROBLEM, image: IMAGE }),
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
