import { Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { BetaService } from './beta.service';
import { BetaPlanRequestDto } from './dto/beta-plan-request.dto';
import {
  CONSTANT_REST_PAIN_MESSAGE,
  COACH_MODEL,
  DEMO_BUDGET_MESSAGE,
  DRAFTER_MODEL,
  FRIENDLY_ERROR_MESSAGE,
  RED_FLAG_FALLBACK_MESSAGE,
  RED_FLAG_MESSAGES,
  REFUSAL_MESSAGE,
  SCREENER_MODEL,
} from './beta.constants';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  AnthropicService,
  StreamMessageParams,
} from '../anthropic/anthropic.service';
import type { BetaUsageService } from './beta-usage.service';

// The agent prompts are markdown files read from disk relative to
// process.cwd(); these tests lock pipeline behavior, not prompt contents,
// so the loader is stubbed out entirely.
jest.mock('./skill-loader', () => ({
  loadBetaSkill: jest.fn(() => 'stub skill prompt'),
}));

// PrismaService is only referenced through constructor injection here; the
// real module drags in the generated Prisma client and the pg adapter, none
// of which may be touched by these tests (no real database, ever).
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceStub {},
}));

type EmittedEvent = [string, unknown];

function makeInput(
  overrides: Partial<BetaPlanRequestDto> = {},
): BetaPlanRequestDto {
  return {
    injuryArea: 'finger_pulley',
    onsetWeeksAgo: 4,
    symptoms: ['pain_with_specific_holds_or_moves'],
    painBehavior: 'none_at_rest_hurts_under_load',
    preInjuryGrade: 'V5',
    discipline: 'bouldering',
    goals: 'Get back to crimpy boulders',
    sessionsPerWeek: 3,
    equipmentAccess: ['hangboard'],
    ...overrides,
  };
}

function makeStage(n: number) {
  return {
    title: `Stage ${n}`,
    timeWindow: `Weeks ${n}-${n + 1}`,
    exercises: [{ name: 'Tendon glides', dose: '3 sets of 10, daily' }],
    allowedClimbing: 'Easy vertical jugs, two grades below max',
    advanceWhen: ['Pain-free daily activities'],
  };
}

const screenerClear = {
  input: { verdict: 'clear' },
  inputTokens: 10,
  outputTokens: 5,
};
const drafterOk = {
  input: { stages: [1, 2, 3, 4].map(makeStage) },
  inputTokens: 100,
  outputTokens: 200,
};

/** streamMessage stub: emits the given chunks through onToken, then resolves. */
function coachStream(chunks: string[] = ['alpha', 'beta']) {
  return (params: StreamMessageParams) => {
    for (const chunk of chunks) params.onToken(chunk);
    return Promise.resolve({
      text: chunks.join(''),
      inputTokens: 50,
      outputTokens: 150,
    });
  };
}

/**
 * The real APIError constructor demands a fetch Headers instance, so build
 * one prototypically instead: instanceof Anthropic.APIError holds (and
 * instanceof APIConnectionError does not), which is exactly what
 * isRetryableUpstreamError type-checks against.
 */
function fakeApiError(status: number): InstanceType<typeof Anthropic.APIError> {
  const error = Object.create(Anthropic.APIError.prototype) as {
    status: number;
  };
  error.status = status;
  return error as unknown as InstanceType<typeof Anthropic.APIError>;
}

function makeHarness() {
  const prisma = { $transaction: jest.fn().mockResolvedValue([]) };
  const anthropic = { forceToolCall: jest.fn(), streamMessage: jest.fn() };
  const usage = {
    reserveGlobalSlot: jest.fn().mockResolvedValue(true),
    refundGlobalSlot: jest.fn().mockResolvedValue(undefined),
    successIncrementOps: jest.fn().mockReturnValue(['global-op', 'ip-op']),
  };
  const service = new BetaService(
    prisma as unknown as PrismaService,
    anthropic as unknown as AnthropicService,
    usage as unknown as BetaUsageService,
  );
  const events: EmittedEvent[] = [];
  const emit = (event: string, data: unknown) => {
    events.push([event, data]);
  };
  return { prisma, anthropic, usage, service, events, emit };
}

describe('BetaService.generatePlan', () => {
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  describe('code-enforced red-flag gate (before any model call or spend)', () => {
    it('blocks a checked red-flag symptom with the exact fixed copy and touches nothing else', async () => {
      const h = makeHarness();

      await h.service.generatePlan({
        input: makeInput({ symptoms: ['numbness_or_tingling'] }),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.events).toEqual([
        ['status', { stage: 'screening' }],
        [
          'red_flag',
          {
            category: 'numbness_or_tingling',
            message: RED_FLAG_MESSAGES.numbness_or_tingling,
          },
        ],
      ]);
      expect(h.anthropic.forceToolCall).not.toHaveBeenCalled();
      expect(h.anthropic.streamMessage).not.toHaveBeenCalled();
      expect(h.usage.reserveGlobalSlot).not.toHaveBeenCalled();
      expect(h.usage.refundGlobalSlot).not.toHaveBeenCalled();
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('blocks constant rest pain at 3+ weeks after onset', async () => {
      const h = makeHarness();

      await h.service.generatePlan({
        input: makeInput({
          painBehavior: 'constant_even_at_rest',
          onsetWeeksAgo: 3,
        }),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.events).toEqual([
        ['status', { stage: 'screening' }],
        ['red_flag', { category: null, message: CONSTANT_REST_PAIN_MESSAGE }],
      ]);
      expect(h.anthropic.forceToolCall).not.toHaveBeenCalled();
      expect(h.usage.reserveGlobalSlot).not.toHaveBeenCalled();
    });

    it.each([['mild_swelling'], ['weakness_or_early_fatigue']] as const)(
      'blocks constant rest pain under 3 weeks when combined with %s',
      async (symptom) => {
        const h = makeHarness();

        await h.service.generatePlan({
          input: makeInput({
            painBehavior: 'constant_even_at_rest',
            onsetWeeksAgo: 1,
            symptoms: [symptom],
          }),
          hashedIp: 'hashed-ip',
          emit: h.emit,
        });

        expect(h.events).toEqual([
          ['status', { stage: 'screening' }],
          ['red_flag', { category: null, message: CONSTANT_REST_PAIN_MESSAGE }],
        ]);
        expect(h.anthropic.forceToolCall).not.toHaveBeenCalled();
        expect(h.usage.reserveGlobalSlot).not.toHaveBeenCalled();
      },
    );

    it('does NOT code-block constant rest pain under 3 weeks without swelling or weakness: the screener decides', async () => {
      const h = makeHarness();
      h.anthropic.forceToolCall
        .mockResolvedValueOnce(screenerClear)
        .mockResolvedValueOnce(drafterOk);
      h.anthropic.streamMessage.mockImplementation(coachStream());

      await h.service.generatePlan({
        input: makeInput({
          painBehavior: 'constant_even_at_rest',
          onsetWeeksAgo: 2,
          symptoms: ['morning_stiffness'],
        }),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.usage.reserveGlobalSlot).toHaveBeenCalledTimes(1);
      expect(h.anthropic.forceToolCall).toHaveBeenCalledTimes(2);
      expect(h.events[h.events.length - 1]).toEqual(['done', {}]);
    });
  });

  describe('global budget reservation', () => {
    it('emits only the demo-budget error when no slot can be reserved', async () => {
      const h = makeHarness();
      h.usage.reserveGlobalSlot.mockResolvedValue(false);

      await h.service.generatePlan({
        input: makeInput(),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.events).toEqual([['error', { message: DEMO_BUDGET_MESSAGE }]]);
      expect(h.anthropic.forceToolCall).not.toHaveBeenCalled();
      expect(h.anthropic.streamMessage).not.toHaveBeenCalled();
      expect(h.usage.refundGlobalSlot).not.toHaveBeenCalled();
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('screener verdicts', () => {
    it('red_flag verdict from free text: blocks, refunds the slot, never calls the drafter', async () => {
      const h = makeHarness();
      h.anthropic.forceToolCall.mockResolvedValueOnce({
        input: { verdict: 'red_flag', category: 'night_pain' },
        inputTokens: 10,
        outputTokens: 5,
      });

      await h.service.generatePlan({
        input: makeInput(),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.events).toEqual([
        ['status', { stage: 'screening' }],
        [
          'red_flag',
          { category: 'night_pain', message: RED_FLAG_MESSAGES.night_pain },
        ],
      ]);
      expect(h.anthropic.forceToolCall).toHaveBeenCalledTimes(1);
      expect(h.anthropic.streamMessage).not.toHaveBeenCalled();
      expect(h.usage.refundGlobalSlot).toHaveBeenCalledTimes(1);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('off_topic verdict: polite refusal and a refund', async () => {
      const h = makeHarness();
      h.anthropic.forceToolCall.mockResolvedValueOnce({
        input: { verdict: 'off_topic' },
        inputTokens: 10,
        outputTokens: 5,
      });

      await h.service.generatePlan({
        input: makeInput(),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.events).toEqual([
        ['status', { stage: 'screening' }],
        ['error', { message: REFUSAL_MESSAGE }],
      ]);
      expect(h.anthropic.forceToolCall).toHaveBeenCalledTimes(1);
      expect(h.usage.refundGlobalSlot).toHaveBeenCalledTimes(1);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown verdict string', { verdict: 'banana' }],
      ['a null tool input', null],
    ])('fails closed as red_flag on %s, with a refund', async (_label, raw) => {
      const h = makeHarness();
      h.anthropic.forceToolCall.mockResolvedValueOnce({
        input: raw,
        inputTokens: 10,
        outputTokens: 5,
      });

      await h.service.generatePlan({
        input: makeInput(),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.events).toEqual([
        ['status', { stage: 'screening' }],
        ['red_flag', { category: null, message: RED_FLAG_FALLBACK_MESSAGE }],
      ]);
      expect(h.anthropic.forceToolCall).toHaveBeenCalledTimes(1);
      expect(h.anthropic.streamMessage).not.toHaveBeenCalled();
      expect(h.usage.refundGlobalSlot).toHaveBeenCalledTimes(1);
    });
  });

  describe('happy path', () => {
    it('emits the full event sequence and commits success counters exactly once', async () => {
      const h = makeHarness();
      h.anthropic.forceToolCall
        .mockResolvedValueOnce(screenerClear)
        .mockResolvedValueOnce(drafterOk);
      h.anthropic.streamMessage.mockImplementation(
        coachStream(['alpha', 'beta']),
      );

      await h.service.generatePlan({
        input: makeInput(),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.events).toEqual([
        ['status', { stage: 'screening' }],
        ['status', { stage: 'drafting' }],
        ['status', { stage: 'coaching' }],
        ['plan_delta', { text: 'alpha' }],
        ['plan_delta', { text: 'beta' }],
        ['done', {}],
      ]);

      // Per-agent pinned models, with SDK retries off (the service retries itself).
      expect(h.anthropic.forceToolCall).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ model: SCREENER_MODEL, maxRetries: 0 }),
      );
      expect(h.anthropic.forceToolCall).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ model: DRAFTER_MODEL, maxRetries: 0 }),
      );
      expect(h.anthropic.streamMessage).toHaveBeenCalledWith(
        expect.objectContaining({ model: COACH_MODEL, maxRetries: 0 }),
      );

      // 15 screener + 300 drafter + 200 coach tokens.
      expect(h.usage.successIncrementOps).toHaveBeenCalledWith(
        'hashed-ip',
        515,
      );
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.prisma.$transaction).toHaveBeenCalledWith([
        'global-op',
        'ip-op',
      ]);
      expect(h.usage.refundGlobalSlot).not.toHaveBeenCalled();
    });
  });

  describe('drafter output validation', () => {
    it('treats a 3-stage plan as a failure: friendly error, refund, no counters', async () => {
      const h = makeHarness();
      h.anthropic.forceToolCall
        .mockResolvedValueOnce(screenerClear)
        .mockResolvedValueOnce({
          input: { stages: [1, 2, 3].map(makeStage) },
          inputTokens: 100,
          outputTokens: 200,
        });

      await h.service.generatePlan({
        input: makeInput(),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.events).toEqual([
        ['status', { stage: 'screening' }],
        ['status', { stage: 'drafting' }],
        ['error', { message: FRIENDLY_ERROR_MESSAGE }],
      ]);
      expect(h.anthropic.streamMessage).not.toHaveBeenCalled();
      expect(h.usage.refundGlobalSlot).toHaveBeenCalledTimes(1);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('upstream retry policy', () => {
    it('retries exactly once on a 500 APIError, then succeeds end to end', async () => {
      const h = makeHarness();
      h.anthropic.forceToolCall
        .mockRejectedValueOnce(fakeApiError(500))
        .mockResolvedValueOnce(screenerClear)
        .mockResolvedValueOnce(drafterOk);
      h.anthropic.streamMessage.mockImplementation(coachStream());

      await h.service.generatePlan({
        input: makeInput(),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      // Screener called twice (fail + retry), drafter once.
      expect(h.anthropic.forceToolCall).toHaveBeenCalledTimes(3);
      expect(h.events[h.events.length - 1]).toEqual(['done', {}]);
      expect(h.usage.refundGlobalSlot).not.toHaveBeenCalled();
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does not retry a 400 APIError: single call, friendly error, refund', async () => {
      const h = makeHarness();
      h.anthropic.forceToolCall.mockRejectedValue(fakeApiError(400));

      await h.service.generatePlan({
        input: makeInput(),
        hashedIp: 'hashed-ip',
        emit: h.emit,
      });

      expect(h.anthropic.forceToolCall).toHaveBeenCalledTimes(1);
      expect(h.events).toEqual([
        ['status', { stage: 'screening' }],
        ['error', { message: FRIENDLY_ERROR_MESSAGE }],
      ]);
      expect(h.usage.refundGlobalSlot).toHaveBeenCalledTimes(1);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
