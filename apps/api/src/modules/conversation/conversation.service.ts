import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { readNumericEnv } from '../../common/config/env.config.js';
import {
  AI_PROVIDER,
  resolveConfiguredProvider,
  type AiProvider,
} from '../anthropic/ai-provider.interface.js';
import { usageFromError } from '../anthropic/tool-conversation.js';
import { ConversationRole } from '../../generated/prisma/enums.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { StoryModel, TopicModel } from '../../generated/prisma/models.js';
import { loadConversationSkill } from './skill-loader.js';
import { TURN_ERROR_MESSAGE } from './conversation.constants.js';
import {
  createSearchKnowledgeExecutor,
  MAX_TOOL_ITERATIONS,
  retrievalStrictFromEnv,
  SEARCH_KNOWLEDGE_TOOL,
  type RetrievalStats,
} from './retrieval/search-knowledge.js';
import {
  isRetrievalConfigured,
  openReadOnly,
} from './retrieval/vector-store.js';
import {
  CREDENTIAL_GUARD_FALLBACK,
  CREDENTIAL_GUARD_REASON,
  evaluateTonyResponse,
  GENERIC_GUARD_FALLBACK,
  isBlankResponse,
  splitIntoChunks,
} from './ownership-guard.js';
import { DailyUsageService } from '../daily-usage/daily-usage.service.js';
import { AnthropicService } from '../anthropic/anthropic.service.js';
import {
  CredentialVerdict,
  CREDENTIAL_CHECK_MODEL,
  CREDENTIAL_VERDICT_SCHEMA,
  isCredentialCheckEnabled,
  needsCredentialCheck,
  wrapAnswerForCredentialCheck,
  type CredentialVerifierResult,
} from './credential-check.js';

export type HistoryTurn = {
  role: 'interviewer' | 'tony';
  text: string;
};

export type TopicWithStories = TopicModel & { stories: StoryModel[] };

/** One read of a conversation's persisted rows, per `loadConversation`. */
export type LoadedConversation = {
  /** The rebuilt transcript, oldest first, blank rows excluded. */
  turns: HistoryTurn[];
  /** The topic every persisted row belongs to; null when there are none. */
  topicId: string | null;
  /** The next free slot, counting reserved rows. */
  nextTurnIndex: number;
};

/**
 * A fresh object per call, never a shared constant. The server is long lived
 * and this value is handed to request code that owns it; one shared instance
 * would mean one shared `turns` array, so any caller that ever mutated it
 * (appending a synthetic opening turn, sorting in place) would leak that edit
 * into every later conversation in the process.
 */
function emptyConversation(): LoadedConversation {
  return { turns: [], topicId: null, nextTurnIndex: 0 };
}

export type EmitFn = (event: string, data: unknown) => void;

export type PreparedTurn = {
  conversationId: string;
  turnIndex: number;
  isFinal: boolean;
  story: StoryModel;
  interviewerTurnId: string;
};

@Injectable()
export class ConversationService implements OnModuleInit {
  private readonly logger = new Logger(ConversationService.name);

  /**
   * AC-10. A deployment must not be able to serve canned replies because a key
   * is absent.
   *
   * The second layer fails closed, which is right at request time and wrong at
   * boot: with the check enabled and no direct Anthropic path, EVERY answer
   * that mentions the clinical subject would be replaced by the fallback, and
   * the only symptom would be a persona that suddenly refuses to discuss its
   * own history. That is a silent, total degradation of the surface. Refusing
   * to start turns it into an obvious one.
   *
   * Throws rather than logging: Nest aborts bootstrap on a rejected
   * onModuleInit, which is the whole point.
   */
  onModuleInit(): void {
    if (isCredentialCheckEnabled() && !this.anthropicDirect.isConfigured()) {
      throw new Error(
        'ANTHROPIC_API_KEY is not configured, and the credential check is ' +
          'enabled. The check fails closed, so starting would replace every ' +
          'clinical answer with the scripted fallback and report nothing. ' +
          'Set the key, or set CREDENTIAL_CHECK_ENABLED=false to start ' +
          'without the second layer.',
      );
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly anthropic: AiProvider,
    private readonly dailyUsage: DailyUsageService,
    // The CONCRETE service, not the AI_PROVIDER token, and deliberately so
    // (spec 0013 AC-9). This account cannot invoke every model on Bedrock, and
    // a check that fails closed must not have its provider move with a
    // configuration flag: if it did, `AI_PROVIDER=bedrock` could silently turn
    // every clinical answer into a canned reply.
    private readonly anthropicDirect: AnthropicService,
  ) {}

  async resolveTopic(topicId: string): Promise<TopicWithStories | null> {
    return this.prisma.topic.findUnique({
      where: { slug: topicId },
      include: { stories: { orderBy: { id: 'asc' } } },
    });
  }

  /**
   * The second layer (spec 0013). Runs only on answers the deterministic guard
   * has already passed AND the prefilter has matched.
   *
   * NEVER THROWS. A throw here would be caught by generateTurnPair's handler,
   * which deletes the reserved turn and emits `turn_error` — so a throwing
   * check would not fail closed at all. Every failure path returns a
   * suppressing verdict instead, which is why the field is named for the
   * ACTION rather than the finding.
   */
  async credentialVerifier(text: string): Promise<CredentialVerifierResult> {
    try {
      const { input, inputTokens, outputTokens } =
        await this.anthropicDirect.forceToolCall({
          model: CREDENTIAL_CHECK_MODEL,
          system: loadConversationSkill('credential-check'),
          userMessage: wrapAnswerForCredentialCheck(text),
          maxTokens: 200,
          toolName: 'report_credential_verdict',
          toolDescription:
            'Report the credential claim result with reasoning behind it',
          inputSchema: CREDENTIAL_VERDICT_SCHEMA,
          // No retry: the timeout is the whole wall-clock budget on a path that
          // sits in front of the first streamed token and fails closed.
          timeoutMs: 3000,
          maxRetries: 0,
        });

      const parsed = CredentialVerdict.safeParse(input);
      if (!parsed.success) {
        this.logger.warn('Credential check: unparsable verdict');
        return {
          suppress: true,
          category: 'unparsable',
          inputTokens,
          outputTokens,
        };
      }
      const { category, reasoning } = parsed.data;
      return {
        suppress: category === 'current_claim' || category === 'ambiguous',
        category,
        reasoning,
        inputTokens,
        outputTokens,
      };
    } catch (error) {
      const timedOut =
        this.anthropicDirect.classifyUpstreamError(error)?.name ===
        'APIConnectionTimeoutError';
      return {
        suppress: true,
        category: timedOut ? 'timeout' : 'provider_error',
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }

  /**
   * Rebuilds a conversation from its persisted rows rather than trusting a
   * client-echoed transcript (spec 0012 phase one, AC-3). Nothing a visitor
   * types reaches a prompt: the request carries only a topic slug and a uuid.
   *
   * One query answers all three questions the caller has — what was said, what
   * topic it was said about, and which slot is next — so there is exactly one
   * definition of "the rows of this conversation" rather than two reads that
   * can disagree.
   *
   * An unknown conversationId yields no rows, which prepareTurn treats as a
   * new conversation.
   */
  async loadConversation(conversationId?: string): Promise<LoadedConversation> {
    if (!conversationId) return emptyConversation();
    const rows = await this.prisma.conversationTurn.findMany({
      where: { conversationId },
      orderBy: { turnIndex: 'asc' },
      select: { turnIndex: true, role: true, text: true, topicId: true },
    });
    if (rows.length === 0) return emptyConversation();

    return {
      // Counts EVERY row, including a reserved one whose text is still empty,
      // so a crashed generation leaves a hole rather than handing the next
      // request a slot the unique constraint would reject.
      nextTurnIndex: Math.max(...rows.map((row) => row.turnIndex)) + 1,
      // Every row of one conversation shares a topic; prepareTurn enforces it.
      topicId: rows[0].topicId,
      turns: rows
        // prepareTurn reserves the interviewer slot with `text: ''` before
        // generation, and a crashed process can orphan one. A blank turn in a
        // prompt reads as a question nobody answered.
        .filter((row) => row.text.length > 0)
        .sort(
          (a, b) =>
            a.turnIndex - b.turnIndex ||
            rolePosition(a.role) - rolePosition(b.role),
        )
        .map((row) => ({
          role:
            row.role === ConversationRole.INTERVIEWER
              ? ('interviewer' as const)
              : ('tony' as const),
          text: row.text,
        })),
    };
  }

  private groundingStory(
    topic: TopicWithStories,
    turnIndex: number,
  ): StoryModel {
    return topic.stories[turnIndex % topic.stories.length];
  }

  /**
   * Resolves conversationId/turnIndex, rejects a request against an already
   * concluded conversation, and atomically claims the (conversationId,
   * turnIndex, INTERVIEWER) slot via the DB unique constraint so a
   * concurrent duplicate request fails here, before any SSE stream opens.
   */
  async prepareTurn(params: {
    topic: TopicWithStories;
    conversationId?: string;
    conversation: LoadedConversation;
    hashedIp: string;
  }): Promise<PreparedTurn> {
    const { topic, conversation, hashedIp } = params;

    // Independent of the per IP throttle: a global hard backstop on daily
    // Anthropic spend, checked before any AI call regardless of who's asking.
    await this.dailyUsage.assertCapNotExceeded();

    const isNewConversation =
      !params.conversationId || conversation.turns.length === 0;

    // A conversation is about exactly one topic. Pairing one topic's slug with
    // another topic's conversationId is a malformed request, not a new
    // conversation: continuing it would splice one transcript into the other's
    // prompts and leave the persisted rows permanently mixed. Rejected rather
    // than silently restarted, so the client learns its id was wrong.
    if (
      !isNewConversation &&
      conversation.topicId !== null &&
      conversation.topicId !== topic.id
    ) {
      throw new ConflictException(
        'This conversation belongs to a different topic',
      );
    }

    const conversationId = isNewConversation
      ? randomUUID()
      : (params.conversationId as string);
    const turnIndex = isNewConversation ? 0 : conversation.nextTurnIndex;

    // Read per call, not captured in a module const: see env.config.ts. As
    // NaN both comparisons below were false, so a conversation never
    // concluded and every extra turn was another billed model call.
    const turnPairCap = readNumericEnv('TURN_PAIR_CAP');
    if (turnIndex >= turnPairCap) {
      throw new ConflictException('This conversation has already concluded');
    }

    const story = this.groundingStory(topic, turnIndex);
    const isFinal = turnIndex + 1 >= turnPairCap;

    try {
      const reserved = await this.prisma.conversationTurn.create({
        data: {
          conversationId,
          topicId: topic.id,
          turnIndex,
          role: ConversationRole.INTERVIEWER,
          text: '',
          tokenCount: 0,
          hashedIp,
        },
        select: { id: true },
      });
      return {
        conversationId,
        turnIndex,
        isFinal,
        story,
        interviewerTurnId: reserved.id,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A turn for this conversation and turn index is already being generated',
        );
      }
      throw error;
    }
  }

  async generateTurnPair(params: {
    topic: TopicWithStories;
    prepared: PreparedTurn;
    history: HistoryTurn[];
    hashedIp: string;
    emit: EmitFn;
    /** Aborted when the visitor disconnects; see the controller's close handler. */
    signal?: AbortSignal;
    /**
     * Spec 0012 phase six, AC-14: receives this turn's retrieval stats, so the
     * eval harness can record how often the reranker fell back. Called once
     * per turn, beside the retrieval log line. Production passes none.
     */
    onRetrievalStats?: (stats: RetrievalStats) => void;
  }): Promise<void> {
    const { topic, prepared, history, hashedIp, signal } = params;

    // Every emit goes through here so an abandoned turn stops writing. The
    // interviewer streams token by token, so without this a visitor who
    // navigates away keeps a destroyed socket receiving text.
    const emit: EmitFn = (event, data) => {
      if (signal?.aborted) return;
      params.emit(event, data);
    };
    const { conversationId, turnIndex, isFinal, story, interviewerTurnId } =
      prepared;

    // Everything actually billed this turn, so a failure can still charge it
    // against the daily cap. The tool loop's own tokens ride on the thrown
    // error; the interviewer's are only here, and were being dropped.
    let billedTokens = 0;
    let committed = false;

    try {
      emit('turn_start', { role: 'interviewer' });
      const interviewerResult = await this.anthropic.streamMessage({
        signal,
        system: loadConversationSkill('interviewer'),
        userMessage: buildInterviewerUserMessage(
          topic,
          story,
          history,
          isFinal,
        ),
        maxTokens: 150,
        onToken: (text) => emit('token', { text }),
      });

      billedTokens +=
        interviewerResult.inputTokens + interviewerResult.outputTokens;

      // The interviewer has no guard of its own, so a blank question would be
      // persisted as-is and then dropped from later transcripts, leaving an
      // answer with no question above it. Treat it as a failed generation:
      // the catch below releases the reserved slot, so a retry can re-claim it.
      if (isBlankResponse(interviewerResult.text)) {
        throw new Error('The interviewer produced an empty question');
      }

      emit('turn_start', { role: 'tony' });
      // Buffered, not live: the ownership guard below must see the complete
      // response before anything reaches the client, so onToken here only
      // accumulates internally (via AnthropicService's return value), never emits.
      // Retrieval is offered to the Tony generation only (AC-4). The
      // interviewer above gets no tools: it asks questions from the topic and
      // has nothing to look up.
      //
      // And it is offered only when it is actually configured. Otherwise the
      // model spends a whole extra round trip per searching turn to be told
      // the search is unavailable, in a deployment that knew at startup. With
      // no credentials this path is byte for byte the generation that ran
      // before retrieval existed.
      const retrievalEnabled = isRetrievalConfigured();
      if (!retrievalEnabled) this.warnRetrievalUnconfiguredOnce();
      const retrieval = createSearchKnowledgeExecutor({
        openIndex: openReadOnly,
        // The guard filter is story aware, because the guard is: the Product
        // Forge numeric rule and the sole credit rule fire only for some
        // stories.
        story,
        // One level, carrying the error's type and message. Deciding whether
        // a failure is ours or theirs was tried three times and was wrong
        // three times; the rate in `stats.failures` is the thing to alert on.
        onFailure: (cause) =>
          this.logger.warn(`searchKnowledge failed: ${cause}`),
        // Phase six AC-3: what was actually asked, judged alongside the
        // persona's own paraphrase of it. Unused unless reranking is on.
        interviewerQuestion: interviewerResult.text,
        // Phase six AC-9: one line per search, counts and document paths
        // only. Logged here rather than batched into the per turn line
        // because a search that fell back is an event on its own.
        onRerank: (entry) => this.logger.log(JSON.stringify({ rerank: entry })),
        // Production degrades (AC-8); the eval harness sets this and fails
        // loudly instead (AC-9), because a run that silently drops retrieval
        // still costs money and still reports scores.
        failLoudly: retrievalStrictFromEnv(),
      });

      // The visitor left while the interviewer was streaming. Tony's turn is
      // the tool-loop call — several upstream requests — so stopping here is
      // the bulk of the saving.
      if (signal?.aborted) throw new AbandonedTurnError();

      const tonyGenerated = await this.anthropic.runToolConversation({
        signal,
        system: loadConversationSkill('tony'),
        userMessage: buildTonyUserMessage(
          story,
          interviewerResult.text,
          isFinal,
        ),
        // A backstop, not an editor: the prompt asks for 2-4 sentences. At 400
        // the model's longer answers truncated mid-sentence (spec 0011's eval
        // caught it: persona judge scored the cut-off answers 0).
        //
        // Raised from 600 on 2026-09-03, because THINKING TOKENS COUNT
        // AGAINST THIS. The old comment claimed a searching turn "still has
        // the full budget for the answer that follows", and that premise is
        // simply false now: the model thinks before it answers, and the
        // thinking is billed out of the same allowance. Reproduced five times
        // on `retrieval-rejected-feature`, twice with `stop_reason:
        // max_tokens` and content blocks `[thinking]` — 600 thinking tokens,
        // ZERO text — and once with 338 thinking tokens followed by an answer
        // cut off mid sentence. The empty ones reached the visitor as the
        // guard's deflection; the truncated one is what the persona judge has
        // been marking down.
        //
        // 1500 fits roughly 600 of thinking plus a complete 2-4 sentence
        // answer with room to spare. It is a CAP, not a spend: unused tokens
        // cost nothing, and the model does not think harder because the
        // ceiling moved.
        maxTokens: 1500,
        tools: retrievalEnabled ? [SEARCH_KNOWLEDGE_TOOL] : [],
        executeTool: retrieval.execute,
        // One model turn when nothing is offered: with no tools there is
        // nothing to come back for, and a larger number would only matter if
        // the model could ask for something.
        maxIterations: retrievalEnabled ? MAX_TOOL_ITERATIONS : 1,
      });

      // Immediately after the billed call, mirroring the interviewer above.
      // Everything between here and the transaction (the retrieval log, the
      // guard, the emit loop) can throw, and each statement in between is a
      // window where these tokens are spent and uncounted.
      billedTokens += tonyGenerated.inputTokens + tonyGenerated.outputTokens;

      this.logRetrieval(
        retrieval.stats,
        tonyGenerated.stoppedOnIterationCap,
        tonyGenerated.stoppedOnMaxTokens,
        tonyGenerated.recoveredWithoutTools,
      );
      params.onRetrievalStats?.(retrieval.stats);

      const guardResult = evaluateTonyResponse(tonyGenerated.text, story);
      let tonyText = tonyGenerated.text;
      let credentialTokens = 0;
      if (!guardResult.ok) {
        // A credential rejection has a true, responsive answer; every other
        // rejection falls back to the story's scripted ownership framing.
        tonyText =
          guardResult.reason === CREDENTIAL_GUARD_REASON
            ? CREDENTIAL_GUARD_FALLBACK
            : (story.requiredFraming ?? GENERIC_GUARD_FALLBACK);
        this.logger.warn(
          tonyGenerated.stoppedOnMaxTokens
            ? `Generation truncated mid tool call for story ${story.id} (${story.title}); ` +
                'answered with the fallback. This is a token budget problem, not a guard failure.'
            : `Ownership guard fired for story ${story.id} (${story.title}): ${guardResult.reason}`,
        );
      } else if (
        isCredentialCheckEnabled() &&
        // ROUTED ON THE QUESTION AS WELL AS THE ANSWER, and that is the whole
        // point. The bait question carries the clinical nouns — the eval's own
        // is "you were an occupational therapist. Are you still licensed for
        // that?" — and the natural answer carries none. "Yes, I am." passed
        // the deterministic guard AND missed an answer-only prefilter, so
        // nothing checked the most likely reply to the question this guard
        // exists for. Found by the pre-deploy adversarial pass.
        //
        // Only the ROUTING reads the question. The model still judges the
        // answer alone, because a question containing "licensed" would
        // otherwise be evidence toward a verdict about Tony.
        needsCredentialCheck(`${interviewerResult.text}\n${tonyGenerated.text}`)
      ) {
        // Layer two (spec 0013, Option 3). Reached only when the deterministic
        // guard PASSED, so this is the sentence a matcher could not decide.
        // The prefilter is over-inclusive on purpose: a false positive costs
        // one cheap call, a miss skips the safety check silently.
        const verdict = await this.credentialVerifier(tonyGenerated.text);
        credentialTokens = verdict.inputTokens + verdict.outputTokens;
        if (verdict.suppress) {
          // WHICH fallback depends on WHY. A model verdict means the answer
          // probably did claim the credential, so the credential copy is the
          // true and responsive reply. A failure means we do not know what the
          // answer said — and the prefilter is over-inclusive, so most runs
          // that reach here were triggered by ordinary engineering words. The
          // pre-deploy clinical audit measured seven of nine plain engineering
          // answers invoking this layer, which means a timeout on a question
          // about AWS certs would have answered with an unprompted disclosure
          // about a lapsed OT licence. Nothing false, but a non-sequitur that
          // implies the visitor asked something they did not.
          const modelDecided =
            verdict.category === 'current_claim' ||
            verdict.category === 'ambiguous';
          tonyText = modelDecided
            ? CREDENTIAL_GUARD_FALLBACK
            : (story.requiredFraming ?? GENERIC_GUARD_FALLBACK);
        }
        // Logged on EVERY run, not only on suppression. The measured risk here
        // is a model confidently returning past_tense_ok on a real claim, and
        // a pass that logs nothing is exactly the case that would hide it.
        // Verdict, category and story id only — never the answer text.
        this.logger.warn(
          `Credential check for story ${story.id}: ${verdict.category}` +
            `${verdict.suppress ? ' (suppressed)' : ''}`,
        );
      }

      for (const chunk of splitIntoChunks(tonyText)) {
        emit('token', { text: chunk });
      }

      const interviewerTokenCount =
        interviewerResult.inputTokens + interviewerResult.outputTokens;
      const tonyTokenCount =
        tonyGenerated.inputTokens + tonyGenerated.outputTokens;
      await this.prisma.$transaction([
        this.prisma.conversationTurn.update({
          where: { id: interviewerTurnId },
          data: {
            text: interviewerResult.text,
            tokenCount: interviewerTokenCount,
          },
        }),
        this.prisma.conversationTurn.create({
          data: {
            conversationId,
            topicId: topic.id,
            turnIndex,
            role: ConversationRole.TONY,
            text: tonyText,
            tokenCount: tonyTokenCount,
            hashedIp,
          },
        }),
        // Running counter incremented per persisted ConversationTurn row (one
        // interviewer + one Tony row this pair), not recomputed by aggregation,
        // so the AC-11 backstop check stays a single fast read.
        // Op count stays 2 — it counts persisted rows, and the credential
        // check persists none. Its tokens are still spend, so they are billed
        // here rather than added to ConversationTurn.tokenCount.
        this.dailyUsage.incrementOp(
          2,
          interviewerTokenCount + tonyTokenCount + credentialTokens,
        ),
      ]);

      committed = true;
      emit('turn_end', { conversationId, turnIndex, isFinal });
      this.logProviderCall('ok');
    } catch (error) {
      // Tokens billed before the failure still cost money, so they still count
      // against the daily cap. The tool loop can make several calls, and
      // without this a loop that failed on its third iteration billed two
      // calls that never reached the counters, letting a persistently failing
      // turn burn budget while DAILY_TOKEN_CAP never moved.
      const spent = usageFromError(error);
      if (spent) billedTokens += spent.inputTokens + spent.outputTokens;
      // `committed` guards the one path that would double count: the
      // transaction already charged the full turn, so a failure after it must
      // not charge it again.
      if (!committed && billedTokens > 0) {
        try {
          // Awaited in a try rather than chained with .catch, because
          // incrementOp returns a PrismaPromise and this must not depend on
          // that being a real promise.
          await this.dailyUsage.incrementOp(0, billedTokens);
        } catch {
          // Best effort: the turn already failed, and losing the counter
          // update must not replace the real error with a database one.
          this.logger.warn(
            `Failed to record ${billedTokens} tokens spent by a failed turn`,
          );
        }
      }

      // Release the reserved slot so a retry of the same call can re-claim it.
      await this.prisma.conversationTurn
        .delete({ where: { id: interviewerTurnId } })
        .catch(() => {
          // The row stays reserved with empty text. loadConversation counts it
          // for nextTurnIndex but hides it from the transcript, so it silently
          // burns one of the conversation's TURN_PAIR_CAP slots and there is no
          // reaper. Log it so an orphan is at least observable.
          this.logger.warn(
            `Failed to release reserved turn ${interviewerTurnId}; it will consume a turn slot`,
          );
        });
      // A disconnect is not a failure. The token billing and slot release
      // above still apply — those tokens were spent and that row must not
      // linger — but there is nobody to emit to, and logging it as an error
      // would make an ordinary navigation look like an outage.
      // As in Beta: an abort that coincides with a real upstream failure is
      // still a failure, and filing it as abandoned would hide it.
      const upstream = this.anthropic.classifyUpstreamError(error);
      if (
        error instanceof AbandonedTurnError ||
        (signal?.aborted === true && upstream === null)
      ) {
        this.logger.warn('Turn abandoned by the visitor');
        this.logProviderCall('abandoned');
        return;
      }

      // Name only in the log, fixed text to the visitor. See the constant.
      this.logger.warn(
        `Turn failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      emit('turn_error', { message: TURN_ERROR_MESSAGE });
      this.logProviderCall('error');
    }
  }

  /**
   * Minimal per-call structured log line for the interview path (spec 0005
   * provider-swap child, AC-P5): { provider, model, outcome }. Not full
   * parity with Beta's per-agent logging — that stays out of scope here.
   */
  /**
   * One structured line per turn that offered retrieval (AC-13).
   *
   * Records the fact of each call, how many results came back, how long it
   * took, and which documents were returned. It records NO query text: the
   * query is model generated from a visitor's conversation, and the umbrella's
   * AC-4 keeps visitor content out of every log and every table.
   *
   * Silent when the model chose not to search, which is the common case and is
   * not an event.
   */
  private logRetrieval(
    stats: RetrievalStats,
    stoppedOnIterationCap: boolean,
    stoppedOnMaxTokens: boolean,
    recoveredWithoutTools: boolean,
  ): void {
    // Fires for anything that happened, not only for a completed search. The
    // malformed and unknown tool paths skip every other counter, so without
    // them here the turns most worth seeing were the ones with no log line.
    const nothingHappened =
      stats.calls === 0 &&
      stats.capped === 0 &&
      stats.malformed === 0 &&
      stats.unknownTool === 0 &&
      !stoppedOnIterationCap &&
      !stoppedOnMaxTokens &&
      !recoveredWithoutTools;
    if (nothingHappened) return;
    this.logger.log(
      JSON.stringify({
        retrieval: {
          calls: stats.calls,
          capped: stats.capped,
          failures: stats.failures,
          malformed: stats.malformed,
          unknownTool: stats.unknownTool,
          // Searches where every hit was dropped by the guard filter. Expected
          // to be non zero for Product Forge stories, whose numeric rule is
          // broad, so a rising number is only a signal read per story.
          allSuppressed: stats.allSuppressed,
          // Chunks dropped because quoting them would have failed the
          // ownership guard. Logged rather than silent: a rising number here
          // means the corpus is accumulating text the persona cannot use.
          suppressed: stats.suppressed,
          resultCounts: stats.resultCounts,
          latenciesMs: stats.latenciesMs,
          sourcePaths: stats.sourcePaths,
          stoppedOnIterationCap,
          // The model was cut off mid tool call, so it neither searched nor
          // answered. Without this the turn looked like an ownership guard
          // failure, which is a different problem with a different fix.
          stoppedOnMaxTokens,
          // The turn cost one extra model call because the model stopped
          // without answering. Rare by design; a rising count is a prompt or
          // cap problem, not something to keep paying for.
          recoveredWithoutTools,
        },
      }),
    );
  }

  /**
   * Says once, not per turn, that retrieval is switched off by configuration.
   *
   * Per turn would be noise in a deployment that is never going to have
   * credentials; never would repeat the failure this whole phase keeps
   * hitting, where a capability quietly does nothing and no signal exists.
   */
  private warnedRetrievalUnconfigured = false;

  private warnRetrievalUnconfiguredOnce(): void {
    if (this.warnedRetrievalUnconfigured) return;
    this.warnedRetrievalUnconfigured = true;
    this.logger.warn(
      'searchKnowledge is not offered: UPSTASH_VECTOR_REST_URL / ' +
        'UPSTASH_VECTOR_REST_TOKEN are not set, so the persona answers from the ' +
        'story alone. Set them to enable retrieval.',
    );
  }

  private logProviderCall(outcome: 'ok' | 'error' | 'abandoned'): void {
    const { provider, model } = resolveConfiguredProvider();
    this.logger.log(JSON.stringify({ provider, model, outcome }));
  }
}

/**
 * Thrown when the visitor disconnected between the interviewer's turn and
 * Tony's. Not an upstream failure: the tokens already spent are still billed
 * and the reserved turn row is still released, but nothing is emitted and it
 * is not logged as an error.
 */
class AbandonedTurnError extends Error {
  constructor() {
    super('Turn abandoned by the visitor');
    this.name = 'AbandonedTurnError';
  }
}

function buildInterviewerUserMessage(
  topic: TopicWithStories,
  story: StoryModel,
  history: HistoryTurn[],
  isFinal: boolean,
): string {
  const historyBlock = formatHistory(history);
  const instruction = isFinal
    ? 'This is the final exchange of the conversation. Ask a warm, concluding wrap-up question inviting a reflection on this topic overall, not a fresh deep-dive question.'
    : 'Ask your next interview question now.';
  return [
    `Topic: ${topic.label} — ${topic.description}`,
    // The catalog is the topic's full material, one line per story (spec 0012
    // phase one, AC-2): a question may reference any of it, but only the
    // grounding story below carries details to ask into.
    `Other material in this topic (titles only — you may reference these, but never invent details about them):\n${formatStoryCatalog(topic, story)}`,
    `Story to ask about: ${story.title} (${story.engagement})`,
    `Story details: ${story.summary}`,
    historyBlock ? `Prior conversation:\n${historyBlock}` : null,
    instruction,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Title plus engagement, one line per story in the active topic. The grounding
 * story is excluded: it is already listed in full just below, and repeating it
 * would read as two different stories.
 */
function formatStoryCatalog(
  topic: TopicWithStories,
  groundingStory: StoryModel,
): string {
  const others = topic.stories.filter((s) => s.id !== groundingStory.id);
  if (others.length === 0) return '(none — this topic has one story)';
  return others.map((s) => `- ${s.title} (${s.engagement})`).join('\n');
}

function rolePosition(role: ConversationRole): number {
  return role === ConversationRole.INTERVIEWER ? 0 : 1;
}

function buildTonyUserMessage(
  story: StoryModel,
  interviewerQuestion: string,
  isFinal: boolean,
): string {
  const framingNote =
    story.ownership !== 'SOLO' && story.requiredFraming
      ? `\n\nYou must frame your ownership of this story using language consistent with: "${story.requiredFraming}"`
      : '';
  const instruction = isFinal
    ? 'Give a warm, concluding closing answer, in 2-4 sentences, that wraps up the conversation and invites the visitor to explore more of the portfolio, rather than a normal deep-dive answer.'
    : 'Answer as Tony now, in 2-4 sentences. Finish your final sentence.';
  return [
    `Interviewer just asked: "${interviewerQuestion}"`,
    `Story facts to answer from — title: ${story.title}; engagement: ${story.engagement}; ownership: ${story.ownership}; details: ${story.summary}${framingNote}`,
    instruction,
  ].join('\n\n');
}

function formatHistory(history: HistoryTurn[]): string {
  return history
    .map(
      (turn) =>
        `${turn.role === 'interviewer' ? 'Interviewer' : 'Tony'}: ${turn.text}`,
    )
    .join('\n');
}
