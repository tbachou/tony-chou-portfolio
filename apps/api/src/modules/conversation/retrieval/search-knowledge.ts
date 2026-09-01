import type { Index } from '@upstash/vector';
import type { ToolDefinition, ToolExecutor } from '../../anthropic/ai-provider.interface';
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

export type RetrievalStats = {
  calls: number;
  /** Calls refused because the per turn cap was already reached. */
  capped: number;
  /** Calls that threw or reported the index unreachable. */
  failures: number;
  /** Every source path returned this turn, in order, for the log line. */
  sourcePaths: string[];
  /** Milliseconds per attempted search, successes and failures alike (AC-13). */
  latenciesMs: number[];
  /** Results returned per successful search, for the log line (AC-13). */
  resultCounts: number[];
};

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
  onFailure: (cause: string) => void;
}): { execute: ToolExecutor; stats: RetrievalStats } {
  const stats: RetrievalStats = {
    calls: 0,
    capped: 0,
    failures: 0,
    sourcePaths: [],
    latenciesMs: [],
    resultCounts: [],
  };
  let index: Index | null = null;

  const execute: ToolExecutor = async (call) => {
    if (call.name !== SEARCH_KNOWLEDGE_TOOL.name) {
      // The model asked for a tool that was never offered. Not a failure of
      // retrieval, so it is not counted as one, but it must not throw either.
      params.onFailure(`unknown tool requested: ${call.name}`);
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
      params.onFailure('searchKnowledge called with no query');
      return NO_MATCH_RESULT;
    }

    stats.calls += 1;
    const startedAt = Date.now();
    try {
      index ??= params.openIndex();
      const chunks = await search(index, query);
      stats.latenciesMs.push(Date.now() - startedAt);
      stats.resultCounts.push(chunks.length);
      stats.sourcePaths.push(...chunks.map((chunk) => chunk.sourcePath));
      if (chunks.length === 0) return NO_MATCH_RESULT;
      return renderResults(chunks);
    } catch (error) {
      // Timed too, because a failure that took ten seconds and one that failed
      // instantly are different problems and the log should tell them apart.
      stats.latenciesMs.push(Date.now() - startedAt);
      // AC-8: never fails the turn, never reaches the visitor, always logged.
      // The cause only. The query is visitor adjacent content and AC-13 keeps
      // it out of every log.
      stats.failures += 1;
      params.onFailure(
        error instanceof Error ? error.message : 'unknown retrieval error',
      );
      return UNAVAILABLE_RESULT;
    }
  };

  return { execute, stats };
}
