import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_PROVIDER,
  resolveConfiguredProvider,
  type AiProvider,
} from '../anthropic/ai-provider.interface';
import {
  GRADER_CALL_TIMEOUT_MS,
  GRADER_MAX_TOKENS,
  resolveGraderModel,
  GRADE_CONFIDENCES,
  GRADE_MAX,
  GRADE_MIN,
  MAX_OBSERVATIONS,
  MAX_OBSERVATION_LENGTH,
  MAX_REASONING_LENGTH,
  type GradeConfidence,
} from './grade.constants';
import { loadGradeSkill } from './skill-loader';
import type { GradeModelAnalysis } from './grade.service';

const USER_MESSAGE =
  'Estimate the V grade of the boulder problem in this photograph, and report it with the report_grade tool.';

/**
 * The day's one vision call (spec 0006, AC-4 and AC-5).
 *
 * Separated from GradeService so the guess path depends on an interface it can
 * be handed a stub of, and so the single-caller guard has one obvious home.
 */
@Injectable()
export class GradeAnalysisService {
  private readonly logger = new Logger(GradeAnalysisService.name);

  /**
   * One in-flight call per UTC date.
   *
   * This is the AC-4 guard for concurrent first guesses. It works because the
   * get and the set below are not separated by an await: JavaScript's single
   * thread makes that pair atomic, so two simultaneous requests that both find
   * the row's analysis null share one promise and therefore one API call, and
   * both get the same answer back.
   *
   * The atomic row insert in GradeService is the other half — it is what stops
   * two requests both believing they created the day. Across *instances* the
   * conditional write at the end of runCall is the backstop: a second instance
   * that raced could pay for a call, but only one answer is ever stored.
   */
  private readonly inFlight = new Map<string, Promise<GradeModelAnalysis | null>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
  ) {}

  /**
   * Fill the day's analysis, or return null if it could not be produced.
   *
   * Never throws. A failed vision call must leave the visitor with a working
   * reveal — the true grade and the histogram are unaffected — and a later
   * guess retries, because nothing marks the day as permanently failed (AC-5).
   */
  async ensureAnalysis(params: {
    date: string;
    image: { data: string; mediaType: string };
  }): Promise<GradeModelAnalysis | null> {
    const existing = this.inFlight.get(params.date);
    if (existing) return existing;

    const call = this.runCall(params).finally(() => {
      this.inFlight.delete(params.date);
    });
    this.inFlight.set(params.date, call);
    return call;
  }

  private async runCall(params: {
    date: string;
    image: { data: string; mediaType: string };
  }): Promise<GradeModelAnalysis | null> {
    const startedAt = Date.now();
    const { provider } = resolveConfiguredProvider();
    // Resolved once, logged as what was actually sent rather than as a
    // constant that may not be the id this provider received (AC-16).
    const model = resolveGraderModel(provider);

    let retried = false;
    try {
      let result;
      try {
        result = await this.callModel(params.image, model);
      } catch (error) {
        if (!this.isRetryableUpstreamError(error)) throw error;
        retried = true;
        this.logger.warn(
          `Grade grader call failed (${this.describeError(error)}); retrying once`,
        );
        result = await this.callModel(params.image, model);
      }

      const analysis = parseAnalysis(result.input);
      if (!analysis) {
        // A malformed tool payload is a failure, not a fallback grade: the
        // game would rather show no Claude answer than a made-up one.
        throw new Error('Grader returned an unusable report_grade payload');
      }

      // The id actually sent, not the first party constant: under Bedrock
      // those differ, and a row claiming the wrong one is how a provider bug
      // stays invisible.
      await this.persist(params.date, analysis, result, model);

      // One JSON line per model call, matching the api's convention. Nothing
      // visitor-supplied exists in this feature to leak into it.
      this.logger.log(
        JSON.stringify({
          agent: 'grade-grader',
          model,
          provider,
          date: params.date,
          durationMs: Date.now() - startedAt,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          grade: analysis.grade,
          confidence: analysis.confidence,
          retried,
          outcome: 'ok',
        }),
      );

      return analysis;
    } catch (error) {
      this.logger.log(
        JSON.stringify({
          agent: 'grade-grader',
          model,
          provider,
          date: params.date,
          durationMs: Date.now() - startedAt,
          retried,
          outcome: 'error',
          error: this.describeError(error),
        }),
      );
      // Swallowed on purpose: the caller's reveal is still correct without it.
      return null;
    }
  }

  private callModel(
    image: { data: string; mediaType: string },
    model: string,
  ) {
    return this.ai.forceToolCall({
      model,
      system: loadGradeSkill('grader'),
      userMessage: USER_MESSAGE,
      image,
      maxTokens: GRADER_MAX_TOKENS,
      toolName: 'report_grade',
      toolDescription:
        "Report the estimated V grade for the boulder problem in the photograph, with the reasoning behind it.",
      inputSchema: {
        type: 'object',
        properties: {
          grade: {
            type: 'integer',
            minimum: GRADE_MIN,
            maximum: GRADE_MAX,
            description: 'The estimated V grade, a whole number from 0 to 8.',
          },
          confidence: {
            type: 'string',
            enum: [...GRADE_CONFIDENCES],
            description: 'How readable the photo was, not how hard the problem is.',
          },
          observations: {
            type: 'array',
            items: { type: 'string' },
            minItems: 3,
            maxItems: MAX_OBSERVATIONS,
            description:
              'Three to five short, concrete things visible in this photo.',
          },
          reasoning: {
            type: 'string',
            description:
              'Two to four sentences on how the observations add up to the grade.',
          },
        },
        required: ['grade', 'confidence', 'observations', 'reasoning'],
      },
      timeoutMs: GRADER_CALL_TIMEOUT_MS,
      // Retried once by runCall above rather than by the SDK, so the retry
      // shows up in the log line.
      maxRetries: 0,
    });
  }

  /**
   * Store the analysis, but only if the day still has none.
   *
   * `modelGrade: null` in the where clause is what makes a cross-instance
   * double call harmless: the second writer updates nothing rather than
   * overwriting an answer visitors have already seen (AC-4).
   */
  private async persist(
    date: string,
    analysis: GradeModelAnalysis,
    result: { inputTokens: number; outputTokens: number },
    model: string,
  ): Promise<void> {
    await this.prisma.gradeDay.updateMany({
      where: { date, modelGrade: null },
      data: {
        modelGrade: analysis.grade,
        modelConfidence: analysis.confidence,
        observations: analysis.observations,
        reasoning: analysis.reasoning,
        model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
  }

  private isRetryableUpstreamError(error: unknown): boolean {
    return this.ai.classifyUpstreamError(error)?.retryable ?? false;
  }

  /** Name and status only — never a raw SDK message (api logging convention). */
  private describeError(error: unknown): string {
    const classified = this.ai.classifyUpstreamError(error);
    if (classified) {
      return classified.status === undefined
        ? classified.name
        : `${classified.name} ${classified.status}`;
    }
    return error instanceof Error ? error.name : 'UnknownError';
  }
}

/**
 * Validate the forced tool call's payload against the schema we asked for.
 *
 * The model is instructed and schema-constrained, but neither is a guarantee,
 * so everything that reaches a visitor is re-checked here. Returns null when
 * the payload cannot be trusted, which the caller treats as a failed call.
 */
export function parseAnalysis(input: unknown): GradeModelAnalysis | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const grade = raw.grade;
  if (
    typeof grade !== 'number' ||
    !Number.isInteger(grade) ||
    grade < GRADE_MIN ||
    grade > GRADE_MAX
  ) {
    return null;
  }

  const confidence = GRADE_CONFIDENCES.find((c) => c === raw.confidence);
  if (!confidence) return null;

  const reasoning = typeof raw.reasoning === 'string' ? raw.reasoning.trim() : '';
  if (reasoning === '') return null;

  const observations = Array.isArray(raw.observations)
    ? raw.observations
        .filter((o): o is string => typeof o === 'string')
        .map((o) => o.trim())
        .filter((o) => o !== '')
        .slice(0, MAX_OBSERVATIONS)
        .map((o) => truncate(o, MAX_OBSERVATION_LENGTH))
    : [];

  return {
    grade,
    confidence: confidence as GradeConfidence,
    observations,
    reasoning: truncate(reasoning, MAX_REASONING_LENGTH),
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
