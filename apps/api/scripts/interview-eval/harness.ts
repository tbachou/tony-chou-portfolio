/**
 * The execution half of the eval suite (spec 0011): runs one golden case
 * through the PRODUCTION `generateTurnPair` — real model calls, persistence
 * stubbed, no HTTP server, no database (AC-1) — and scores the captured
 * output. All pure math (aggregation, hashing, baseline, scoreboard) lives in
 * `src/modules/conversation/eval/` where Jest can reach it.
 */
import {
  ConversationService,
  type PreparedTurn,
  type TopicWithStories,
} from '../../src/modules/conversation/conversation.service';
import { loadConversationSkill } from '../../src/modules/conversation/skill-loader';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import type { DailyUsageService } from '../../src/modules/daily-usage/daily-usage.service';
import type {
  AiProvider,
  ForceToolCallParams,
  ForceToolCallResult,
  StreamMessageParams,
  StreamMessageResult,
  RunToolConversationParams,
  RunToolConversationResult,
  UpstreamErrorClassification,
} from '../../src/modules/anthropic/ai-provider.interface';
import type { StoryModel } from '../../src/generated/prisma/models';
import type { CaseResult } from '../../src/modules/conversation/eval/eval-types';
import { topics, stories } from '../../prisma/fixtures';
import type { EvalCase } from './golden';
import { scoreHonesty } from './scorers/honesty';
import { scoreGrounding } from './scorers/grounding';
import { scorePersona } from './scorers/persona';
import type { JudgeUsage } from './scorers/judge-client';

/**
 * Wraps the real provider so the harness can capture the raw turns (the
 * guard replaces overclaims before anything is emitted, so the raw Tony text
 * exists only at this seam) and pin the interviewer question for bait cases
 * (`injectQuestion`, AC-2). Wrapping the injected provider — the
 * beta-guard-corpus precedent — keeps the production prompt assembly and
 * guard call site untouched (spec invariant).
 */
class CapturingProvider implements AiProvider {
  interviewerText: string | null = null;
  tonyText: string | null = null;
  /**
   * Every searchKnowledge result handed back to the model this turn, in order.
   *
   * Captured by wrapping the executor the SERVICE built, rather than by
   * plumbing anything through production code: the grounding judge needs the
   * retrieved text, because a fact drawn correctly from a retrieved document
   * is not in the story summary and would otherwise be scored as invented.
   */
  retrievedResults: string[] = [];
  usage: JudgeUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(
    private readonly real: AiProvider,
    private readonly injectQuestion?: string,
  ) {}

  async streamMessage(params: StreamMessageParams): Promise<StreamMessageResult> {
    // Exhaustive on purpose: if the production prompts are ever composed or
    // a third model call appears in generateTurnPair, fail loudly instead of
    // silently misclassifying (and mis-scoring) a turn.
    const isInterviewer =
      params.system === loadConversationSkill('interviewer');
    if (!isInterviewer && params.system !== loadConversationSkill('tony')) {
      throw new Error(
        'CapturingProvider: unrecognized system prompt; production prompt wiring changed and the harness must be updated',
      );
    }
    if (isInterviewer && this.injectQuestion) {
      params.onToken(this.injectQuestion);
      this.interviewerText = this.injectQuestion;
      return { text: this.injectQuestion, inputTokens: 0, outputTokens: 0 };
    }
    const result = await this.real.streamMessage(params);
    this.usage.inputTokens += result.inputTokens;
    this.usage.outputTokens += result.outputTokens;
    if (isInterviewer) this.interviewerText = result.text;
    else this.tonyText = result.text;
    return result;
  }

  /**
   * The Tony generation runs through here now, not `streamMessage` (spec 0012
   * phase three, AC-4: the harness exercises the same path production does).
   * Capturing the text here is what keeps the judge scoring the real answer,
   * retrieval and all.
   */
  async runToolConversation(
    params: RunToolConversationParams,
  ): Promise<RunToolConversationResult> {
    // Same exhaustiveness bargain as streamMessage above: only the Tony
    // generation is given tools, so anything else reaching here means the
    // production wiring changed and this harness is now mis-scoring turns.
    if (params.system !== loadConversationSkill('tony')) {
      throw new Error(
        'CapturingProvider: runToolConversation with an unrecognized system prompt; production tool wiring changed and the harness must be updated',
      );
    }
    const result = await this.real.runToolConversation({
      ...params,
      executeTool: async (toolCall) => {
        const output = await params.executeTool(toolCall);
        this.retrievedResults.push(output);
        return output;
      },
    });
    this.usage.inputTokens += result.inputTokens;
    this.usage.outputTokens += result.outputTokens;
    this.tonyText = result.text;
    return result;
  }

  forceToolCall(params: ForceToolCallParams): Promise<ForceToolCallResult> {
    return this.real.forceToolCall(params);
  }

  classifyUpstreamError(error: unknown): UpstreamErrorClassification | null {
    return this.real.classifyUpstreamError(error);
  }
}

/**
 * No Postgres (AC-1). `generateTurnPair` touches exactly these members:
 * `conversationTurn.update/create` and `dailyUsage.incrementOp` inside
 * `$transaction`, and `conversationTurn.delete` on the error path. Stubs cast
 * to the service types — the beta-guard-corpus precedent.
 */
function makePrismaStub(): PrismaService {
  return {
    conversationTurn: {
      create: async () => ({ id: 'eval-tony-turn' }),
      update: async () => ({}),
      delete: async () => ({}),
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaService;
}

const dailyUsageStub = {
  incrementOp: () => Promise.resolve(),
} as unknown as DailyUsageService;

export type FixtureRefs = {
  topic: (typeof topics)[number];
  story: (typeof stories)[number];
  storyIndex: number;
};

/** Resolves a case's topic slug + story title into the seed fixtures. */
export function resolveFixtures(evalCase: EvalCase): FixtureRefs {
  const topic = topics.find((t) => t.slug === evalCase.topicSlug);
  if (!topic) {
    throw new Error(
      `case ${evalCase.id}: unknown topic slug "${evalCase.topicSlug}"`,
    );
  }
  const storyIndex = stories.findIndex(
    (s) =>
      s.title === evalCase.storyTitle && s.topics.includes(evalCase.topicSlug),
  );
  if (storyIndex === -1) {
    throw new Error(
      `case ${evalCase.id}: no story titled "${evalCase.storyTitle}" under topic "${evalCase.topicSlug}"`,
    );
  }
  return { topic, story: stories[storyIndex], storyIndex };
}

/**
 * Synthesizes the model shapes `generateTurnPair` expects from the fixture
 * data, with deterministic fake ids (`eval-story-<n>`). `prepareTurn` and the
 * production story selection are deliberately out of scope (spec: the suite
 * evaluates generation and guarding, not selection).
 */
export function synthesizeCase(evalCase: EvalCase): {
  topic: TopicWithStories;
  prepared: PreparedTurn;
} {
  const refs = resolveFixtures(evalCase);
  const story = synthesizeStory(refs.story, refs.storyIndex);
  const topic: TopicWithStories = {
    id: `eval-topic-${refs.topic.sortOrder}`,
    slug: refs.topic.slug,
    label: refs.topic.label,
    description: refs.topic.description,
    sortOrder: refs.topic.sortOrder,
    stories: stories
      .map((s, i) => ({ seed: s, index: i }))
      .filter(({ seed }) => seed.topics.includes(refs.topic.slug))
      .map(({ seed, index }) => synthesizeStory(seed, index)),
  } as TopicWithStories;
  const turnIndex = Math.floor(evalCase.history.length / 2);
  return {
    topic,
    prepared: {
      conversationId: `eval-${evalCase.id}`,
      turnIndex,
      isFinal: evalCase.isFinal,
      story,
      interviewerTurnId: 'eval-interviewer-turn',
    },
  };
}

function synthesizeStory(
  seed: (typeof stories)[number],
  index: number,
): StoryModel {
  return {
    id: `eval-story-${index}`,
    title: seed.title,
    ownership: seed.ownership,
    engagement: seed.engagement,
    summary: seed.summary,
    requiredFraming: seed.requiredFraming ?? null,
  } as StoryModel;
}

export type GenerationCapture = {
  ok: boolean;
  errorMessage: string | null;
  interviewerQuestion: string | null;
  tonyRaw: string | null;
  tonyEmitted: string | null;
  /** searchKnowledge results this turn, in order. Empty when it never searched. */
  retrieved: string[];
  usage: JudgeUsage;
};

/**
 * One pass through the production `generateTurnPair`. The service catches its
 * own errors and reports them as a `turn_error` emit, so failure is detected
 * from the event stream, not a rejection.
 */
async function generateOnce(
  provider: AiProvider,
  evalCase: EvalCase,
  synthesized: { topic: TopicWithStories; prepared: PreparedTurn },
): Promise<GenerationCapture> {
  const capture = new CapturingProvider(provider, evalCase.injectQuestion);
  const service = new ConversationService(
    makePrismaStub(),
    capture,
    dailyUsageStub,
  );
  const { topic, prepared } = synthesized;

  let errorMessage: string | null = null;
  let tonyEmitted = '';
  let currentRole: 'interviewer' | 'tony' | null = null;

  await service.generateTurnPair({
    topic,
    prepared,
    history: evalCase.history,
    hashedIp: `eval-${evalCase.id}`,
    emit: (event, data) => {
      if (event === 'turn_start') {
        currentRole = (data as { role: 'interviewer' | 'tony' }).role;
      } else if (event === 'token' && currentRole === 'tony') {
        tonyEmitted += (data as { text: string }).text;
      } else if (event === 'turn_error') {
        errorMessage = (data as { message: string }).message;
      }
    },
  });

  return {
    ok: errorMessage === null,
    errorMessage,
    interviewerQuestion: capture.interviewerText,
    tonyRaw: capture.tonyText,
    tonyEmitted: errorMessage === null ? tonyEmitted : null,
    retrieved: capture.retrievedResults,
    usage: capture.usage,
  };
}

export type CaseRunOutcome = {
  result: CaseResult;
  generatorUsage: JudgeUsage;
  judgeUsage: JudgeUsage;
};

/**
 * Runs and scores one case: generation with one retry on `turn_error`
 * (AC-7), then the three scoring dimensions (AC-3/4/5).
 */
export async function runCase(
  provider: AiProvider,
  evalCase: EvalCase,
): Promise<CaseRunOutcome> {
  const startedAt = Date.now();
  const generatorUsage: JudgeUsage = { inputTokens: 0, outputTokens: 0 };
  const judgeUsage: JudgeUsage = { inputTokens: 0, outputTokens: 0 };

  // Synthesized once: the judges score against the exact story object the
  // generator was given.
  const synthesized = synthesizeCase(evalCase);

  let capture = await generateOnce(provider, evalCase, synthesized);
  addUsage(generatorUsage, capture.usage);
  if (!capture.ok) {
    const retry = await generateOnce(provider, evalCase, synthesized);
    addUsage(generatorUsage, retry.usage);
    capture = retry;
  }

  const base = {
    caseId: evalCase.id,
    difficulty: evalCase.difficulty,
    category: evalCase.category,
    questionSource: evalCase.injectQuestion
      ? ('injected' as const)
      : ('generated' as const),
  };

  if (!capture.ok || !capture.tonyRaw || !capture.interviewerQuestion) {
    return {
      result: {
        ...base,
        status: 'generation_error',
        interviewerQuestion: capture.interviewerQuestion,
        tonyRaw: capture.tonyRaw,
        tonyEmitted: capture.tonyEmitted,
        guardFired: false,
        dimensions: {},
        generationError:
          capture.errorMessage ?? 'no Tony turn captured after one retry',
        durationMs: Date.now() - startedAt,
      },
      generatorUsage,
      judgeUsage,
    };
  }

  const { prepared, topic } = synthesized;

  // Judges score the RAW model output: the suite measures what the prompts
  // and model produce; the guard's deterministic replacement is recorded
  // separately (tonyEmitted, guardFired) rather than scored. The three
  // judges are independent, so they run concurrently (at most
  // 3 × --concurrency small judge calls in flight).
  const [honesty, grounding, persona] = await Promise.all([
    scoreHonesty({
      tonyRaw: capture.tonyRaw,
      story: prepared.story,
      retrieved: capture.retrieved,
    }),
    scoreGrounding({
      tonyRaw: capture.tonyRaw,
      story: prepared.story,
      retrieved: capture.retrieved,
    }),
    scorePersona({
      interviewerQuestion: capture.interviewerQuestion,
      tonyRaw: capture.tonyRaw,
      topicLabel: topic.label,
    }),
  ]);
  addUsage(judgeUsage, honesty.usage);
  addUsage(judgeUsage, grounding.usage);
  addUsage(judgeUsage, persona.usage);

  return {
    result: {
      ...base,
      status: 'scored',
      interviewerQuestion: capture.interviewerQuestion,
      tonyRaw: capture.tonyRaw,
      tonyEmitted: capture.tonyEmitted,
      guardFired: honesty.guardFired,
      dimensions: {
        honesty: honesty.dimension,
        grounding: grounding.dimension,
        persona: persona.dimension,
      },
      honestyLayers: honesty.layers,
      durationMs: Date.now() - startedAt,
    },
    generatorUsage,
    judgeUsage,
  };
}

function addUsage(target: JudgeUsage, source: JudgeUsage): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
}

/** The dataset hash payload: case list plus referenced fixture fields (AC-6). */
export function datasetHashPayload(cases: EvalCase[]): unknown {
  return cases.map((c) => {
    const refs = resolveFixtures(c);
    return {
      case: c,
      story: {
        title: refs.story.title,
        ownership: refs.story.ownership,
        engagement: refs.story.engagement,
        summary: refs.story.summary,
        requiredFraming: refs.story.requiredFraming ?? null,
      },
      topic: {
        slug: refs.topic.slug,
        label: refs.topic.label,
        description: refs.topic.description,
      },
    };
  });
}
