import type { Index } from '@upstash/vector';
import type { ToolDefinition, ToolExecutor } from '../../anthropic/ai-provider.interface';
import type { StoryModel } from '../../../generated/prisma/models';
import { evaluateTonyResponse } from '../ownership-guard';
import { search, type RetrievedChunk } from './vector-store';

/**
 * The `searchKnowledge` tool the Tony persona may call (spec 0012 phase three,
 * AC-4, AC-5, AC-7, AC-8, AC-13).
 *
 * The provider seam knows the tool protocol; this file knows the policy. The
 * per turn cap, the degrade path and the logging rules all live here, which is
 * why `tool-conversation.ts` has no idea retrieval exists.
 */

/** AC-7: at most two searches per turn, capped in code and not by prompt. */
export const MAX_SEARCHES_PER_TURN = 2;

/**
 * Model turns allowed inside one generation.
 *
 * Not the same number as the search cap and not derived from it. Once the cap
 * is reached the executor still returns a result, so a model that keeps asking
 * would spin at one upstream call per iteration. Four leaves room for two
 * searches, the answer, and one wasted turn, and is the backstop rather than
 * the mechanism.
 */
export const MAX_TOOL_ITERATIONS = 4;

export const SEARCH_KNOWLEDGE_TOOL: ToolDefinition = {
  name: 'searchKnowledge',
  description:
    "Search Tony's own committed engineering documents: specs, decision " +
    'records, findings and eval writeups from this repository. Use it when a ' +
    'question asks how Tony works, what he decided on a project, or why he ' +
    'chose an approach, and the story you were given does not already answer ' +
    'it. Returns up to three sections, each with the document it came from. ' +
    'Name that document in your answer.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'What to look for, in plain words. A question or a description of ' +
          'the topic works better than keywords.',
      },
    },
    required: ['query'],
  },
};

/** What the model is told when the cap is reached. Not an error (AC-7). */
export const CAP_REACHED_RESULT =
  'No further searches are available for this turn. Answer with what you ' +
  'already have.';

/** What the model is told when nothing cleared the threshold. Not an error (AC-8). */
export const NO_MATCH_RESULT =
  'No matching sections were found. Answer from the story instead, and do ' +
  'not mention the search.';

/**
 * What the model is told when retrieval actually failed (AC-8).
 *
 * Deliberately indistinguishable, from the visitor's side, from a search that
 * found nothing: the persona is told to carry on either way and never to
 * mention it. The difference is recorded in the log, not in the answer.
 */
export const UNAVAILABLE_RESULT =
  'The document search is unavailable. Answer from the story instead, and do ' +
  'not mention the search.';

/**
 * Env var that flips retrieval from degrading to failing loudly (AC-9).
 *
 * Production must degrade: a retrieval failure can never cost a visitor their
 * turn (AC-8). An eval run must do the opposite, because a run that silently
 * becomes a non retrieval run and reports scores as though nothing changed is
 * exactly the outcome AC-9 forbids, and eval runs cost real money.
 *
 * An env var rather than plumbing, because the executor is created inside
 * `generateTurnPair` and the harness deliberately drives the production call
 * site rather than reimplementing it. The eval sets this; nothing else does.
 */
export const RETRIEVAL_STRICT_ENV = 'RETRIEVAL_STRICT';

export function retrievalStrictFromEnv(): boolean {
  return process.env[RETRIEVAL_STRICT_ENV] === '1';
}

/**
 * What the model is told when matches were found but none may be quoted.
 *
 * Distinct from NO_MATCH_RESULT because the two are different events and the
 * log has to tell them apart: nothing matched is a corpus or threshold
 * question, everything was withheld is a guard question. The wording still
 * says "no usable sections" rather than "results were withheld", because the
 * model reads this and must not narrate the machinery to a visitor.
 */
export const ALL_SUPPRESSED_RESULT =
  'No usable sections were found. Answer from the story instead, and do not ' +
  'mention the search.';

export type RetrievalStats = {
  calls: number;
  /** Chunks dropped because quoting them would fail the ownership guard. */
  suppressed: number;
  /** Calls refused because the per turn cap was already reached. */
  capped: number;
  /** Calls that threw or reported the index unreachable. */
  failures: number;
  /** Calls rejected before the index: no query, or an empty one. */
  malformed: number;
  /** Calls naming a tool that was never offered. */
  unknownTool: number;
  /** Searches where every hit was dropped by the guard filter. */
  allSuppressed: number;
  /** Every source path returned this turn, in order, for the log line. */
  sourcePaths: string[];
  /** Milliseconds per attempted search, successes and failures alike (AC-13). */
  latenciesMs: number[];
  /** Results returned per successful search, for the log line (AC-13). */
  resultCounts: number[];
};

/**
 * Drops chunks that the ownership guard would reject if the persona quoted
 * them (found by the adversarial pass, 2026-09-01).
 *
 * The tool description tells the model to name the document it used, so an
 * honest answer quotes the retrieved section. That answer is then judged by
 * `evaluateTonyResponse`. Some committed documents quote guard tripping text
 * as EXAMPLES: the credential check spec quotes a licensure claim in order to
 * discuss it, and eval writeups quote figures a model once fabricated in order
 * to record that it did. Handing those to the model made its own honest answer
 * fail, and the visitor got scripted framing while the log blamed the guard.
 *
 * Filtering here rather than loosening the guard is the whole point. The guard
 * judges the answer and must stay exactly as strict; what changes is that the
 * model is never handed material that would make a truthful answer fail it.
 *
 * Story aware, because the guard is: the Product Forge numeric rule and the
 * sole credit rule fire only for some stories, so a chunk dropped for one
 * story is legitimately available for another. Excluding whole documents from
 * the corpus instead would lose good sections over one bad paragraph.
 */
export function filterChunksForStory<T extends { text: string }>(
  chunks: T[],
  story: StoryModel,
): T[] {
  return chunks.filter((chunk) => evaluateTonyResponse(chunk.text, story).ok);
}

/** Formats chunks for the model. Path first, because attribution needs it. */
function renderResults(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (chunk, i) =>
        `[${i + 1}] ${chunk.sourcePath}` +
        (chunk.heading ? ` — ${chunk.heading}` : '') +
        `\n${chunk.text}`,
    )
    .join('\n\n');
}

/**
 * Builds the executor for one turn.
 *
 * The counter is a closure variable, created per `generateTurnPair` call and
 * discarded with it (AC-7: nothing persisted, nothing carried across turns).
 *
 * `openIndex` is a function rather than an `Index`, so a missing credential
 * fails on first use inside the try below and degrades, instead of throwing
 * while the turn is being set up. In production that distinction is the whole
 * of AC-8: an API with no Upstash configuration answers every question from
 * the story rather than failing every turn.
 */
export function createSearchKnowledgeExecutor(params: {
  openIndex: () => Index;
  /** The story under discussion. The guard filter below is story aware. */
  story: StoryModel;
  /**
   * `kind` separates an outage from a bug in our own code. Both degrade, but
   * only one is someone else's problem, and before this they produced an
   * identical model facing string and an identical failure count.
   */
  onFailure: (cause: string, kind: 'network' | 'unexpected') => void;
  /**
   * AC-9. When true a retrieval failure throws instead of degrading, which
   * aborts the generation and fails the eval case loudly. Production leaves
   * this false: AC-8 says a visitor never loses a turn to a search.
   */
  failLoudly?: boolean;
}): { execute: ToolExecutor; stats: RetrievalStats } {
  const stats: RetrievalStats = {
    calls: 0,
    suppressed: 0,
    capped: 0,
    failures: 0,
    malformed: 0,
    unknownTool: 0,
    allSuppressed: 0,
    sourcePaths: [],
    latenciesMs: [],
    resultCounts: [],
  };
  let index: Index | null = null;

  const execute: ToolExecutor = async (call) => {
    if (call.name !== SEARCH_KNOWLEDGE_TOOL.name) {
      // The model asked for a tool that was never offered. Not a failure of
      // retrieval, so it is not counted as one, but it must not throw either.
      stats.unknownTool += 1;
      params.onFailure(`unknown tool requested: ${call.name}`, 'unexpected');
      return `Unknown tool: ${call.name}`;
    }

    if (stats.calls >= MAX_SEARCHES_PER_TURN) {
      stats.capped += 1;
      return CAP_REACHED_RESULT;
    }

    const query = (call.input as { query?: unknown } | null)?.query;
    if (typeof query !== 'string' || query.trim().length === 0) {
      // The schema says query is required, but the schema is a request, not a
      // guarantee, and an empty string would embed to a meaningless vector.
      stats.malformed += 1;
      params.onFailure('searchKnowledge called with no query', 'unexpected');
      return NO_MATCH_RESULT;
    }

    stats.calls += 1;
    const startedAt = Date.now();
    try {
      index ??= params.openIndex();
      const found = await search(index, query);
      // Filtered BEFORE anything is counted or logged, so the recorded source
      // paths are the ones actually handed to the model.
      const chunks = filterChunksForStory(found, params.story);
      stats.suppressed += found.length - chunks.length;
      stats.latenciesMs.push(Date.now() - startedAt);
      stats.resultCounts.push(chunks.length);
      stats.sourcePaths.push(...chunks.map((chunk) => chunk.sourcePath));
      if (chunks.length === 0) {
        // Nothing matched, versus everything matched and was withheld. Same
        // instruction to the model, different event in the log.
        if (found.length > 0) {
          stats.allSuppressed += 1;
          return ALL_SUPPRESSED_RESULT;
        }
        return NO_MATCH_RESULT;
      }
      return renderResults(chunks);
    } catch (error) {
      // Timed too, because a failure that took ten seconds and one that failed
      // instantly are different problems and the log should tell them apart.
      stats.latenciesMs.push(Date.now() - startedAt);
      // AC-8: never fails the turn, never reaches the visitor, always logged.
      // The cause only. The query is visitor adjacent content and AC-13 keeps
      // it out of every log.
      stats.failures += 1;
      const cause =
        error instanceof Error ? error.message : 'unknown retrieval error';
      // A TypeError from a bad refactor and a genuine Upstash outage used to
      // produce an identical model facing string and an identical count, with
      // only the free text warn to tell them apart and nothing alerting on it.
      // AC-8 requires not failing the turn; it does not require erasing the
      // distinction.
      const kind =
        error instanceof TypeError ||
        error instanceof RangeError ||
        error instanceof ReferenceError ||
        error instanceof SyntaxError
          ? 'unexpected'
          : 'network';
      params.onFailure(cause, kind);
      if (params.failLoudly) {
        // The one place the seam's "an executor must not throw" rule is broken
        // on purpose. It aborts the generation, which is the point: an eval
        // run must never quietly become a non retrieval run (AC-9).
        throw new Error(
          `Retrieval failed and ${RETRIEVAL_STRICT_ENV}=1, so this run fails rather than ` +
            `scoring as though retrieval worked: ${cause}`,
        );
      }
      return UNAVAILABLE_RESULT;
    }
  };

  return { execute, stats };
}
