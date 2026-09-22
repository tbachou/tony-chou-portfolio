import { TypeSafeClient, noul } from '@typesafe-ai/sdk';
import { loadRerankPrompt } from './rerank-prompt.js';
import { TOP_K, type ScoredChunk } from './vector-store.js';

/**
 * The judgement stage of two stage retrieval (spec 0012 phase six).
 *
 * Cosine similarity is good at recall and cannot tell "shares vocabulary with
 * the question" from "answers the question". This module asks a System One
 * model that second question, once per candidate, and returns the candidates
 * worth handing to the persona.
 *
 * It decides nothing on its own. The caller reads the mode, and every failure
 * here is reported rather than thrown: the worst outcome of this file is that
 * retrieval behaves exactly as it did before phase six (AC-6).
 */

/**
 * AC-7: an explicit dated model id, never a moving alias.
 *
 * `RERANK_KEEP_THRESHOLD` below is tuned against one version of one model, so
 * a threshold and a floating alias cannot both be right. The SDK would
 * otherwise default to `jev-latest`, which is exactly the alias this must not
 * be. This is the version spec 0013's spike measured.
 */
export const RERANK_MODEL_ID = 'jev-1.13.0';

/** AC-4: the cut. Candidates at or above this are kept, in score order. */
export const RERANK_KEEP_THRESHOLD = 0.5;

/**
 * AC-6: the per request budget, inside the tool loop and up to twice a turn.
 *
 * Retries are disabled rather than left at the SDK's default of two, and the
 * two facts are connected: the SDK's timeout is per attempt with no total
 * budget, so three attempts would put 4.5 seconds in front of a visitor's
 * first token while promising 1.5. Failing open after one attempt is cheaper
 * than a retry, because the fallback is a selection we already hold.
 */
export const RERANK_TIMEOUT_MS = 1500;

export const RETRIEVAL_RERANK_MODE_ENV = 'RETRIEVAL_RERANK_MODE';

/**
 * AC-5. `off` is byte identical to pre phase six behaviour, `shadow` computes
 * and logs without deciding, `enforce` decides. Unset means `off`, so the
 * merge is safe on its own and nothing changes for a visitor until an
 * environment variable says so.
 *
 * Three states rather than a boolean, mirroring `BETA_OUTPUT_GUARD_MODE`,
 * which already proved the shape in this repo.
 */
export type RerankMode = 'off' | 'shadow' | 'enforce';

export function rerankModeFromEnv(): RerankMode {
  const raw = process.env[RETRIEVAL_RERANK_MODE_ENV];
  // An unrecognised value reads as `off` rather than throwing. A typo in a
  // Render environment variable must not take the API down, and the safe
  // reading of "I do not understand this" is the mode that changes nothing.
  return raw === 'shadow' || raw === 'enforce' ? raw : 'off';
}

/**
 * Is the reranker configured at all?
 *
 * Same shape as `isRetrievalConfigured()`, and checked for the same reason:
 * the client constructor throws when the key is absent, and a throw during
 * setup is not the fail open path AC-6 asks for.
 */
export function isRerankConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

/** What the reranker gives back. Always usable, never thrown (AC-6). */
export type RerankResult = {
  /**
   * The reranked selection: at or above the keep threshold, descending, capped
   * at `TOP_K`. Empty means nothing cleared, which is a decision, not a
   * failure — read it together with `fellBack`.
   */
  kept: ScoredChunk[];
  /** True when the reranker could not decide. The caller uses cosine instead. */
  fellBack: boolean;
  /** Why it fell back. Never carries query or chunk text. */
  cause?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

/** The one method this module needs, so a test can supply a fake. */
export type SystemOneCaller = Pick<TypeSafeClient, 'systemOne'>;

let client: SystemOneCaller | null = null;

function getClient(): SystemOneCaller {
  if (client) return client;
  client = new TypeSafeClient({
    // Read from TYPESAFE_API_KEY by the SDK, but passed explicitly so the
    // presence check above and the client agree on one source.
    apiKey: process.env.TYPESAFE_API_KEY,
    timeout: RERANK_TIMEOUT_MS,
    retry: { maxRetries: 0 },
    // Pinned, not merely defaulted. The SDK falls back to TYPESAFE_LOG_LEVEL,
    // and at `debug` it logs request bodies — which here are the search query
    // and the retrieved chunk text. AC-9 says neither is ever logged, so that
    // invariant cannot be left to an environment variable nobody reviews.
    logLevel: 'off',
  });
  return client;
}

/** Test only. Production builds the client once per process. */
export function setRerankClient(fake: SystemOneCaller | null): void {
  client = fake;
}

/** Question keys are for code and are never sent to the model. */
function keyFor(position: number): string {
  return `c${position}`;
}

/**
 * Scores every candidate in one request and returns those worth keeping (AC-3).
 *
 * One `Noul` per candidate over a single shared state. The state holds the
 * interviewer's question and the persona's search query; each question's own
 * instructions carry that candidate's section, because instructions are per
 * question and state is shared by definition.
 *
 * The question is included alongside the query deliberately. A search query is
 * the persona's paraphrase, and judging relevance against the paraphrase alone
 * optimises for the paraphrase rather than for what was asked. Spec 0013's gate
 * found the same shape of gap from the other direction.
 *
 * Callers must have run `filterChunksForStory` first (AC-2): no reranking
 * question is spent on a chunk the ownership guard would reject.
 */
export async function rerankCandidates(params: {
  candidates: ScoredChunk[];
  interviewerQuestion: string;
  searchQuery: string;
  caller?: SystemOneCaller;
}): Promise<RerankResult> {
  const startedAt = Date.now();
  const empty = { inputTokens: 0, outputTokens: 0 };

  if (params.candidates.length === 0) {
    return { kept: [], fellBack: false, ...empty, durationMs: 0 };
  }

  try {
    if (!params.caller && !isRerankConfigured()) {
      // AC-6: a missing key is a fall back, not an error, and not a throw.
      return {
        kept: [],
        fellBack: true,
        cause: 'reranker not configured',
        ...empty,
        durationMs: Date.now() - startedAt,
      };
    }

    const prompt = loadRerankPrompt();
    const questions = Object.fromEntries(
      params.candidates.map((candidate, position) => [
        keyFor(position),
        noul(
          { task: prompt.task, section: candidate.text },
          { true: prompt.relevant, false: prompt.notRelevant },
        ),
      ]),
    );

    const caller = params.caller ?? getClient();
    const result = await caller.systemOne(
      {
        state: {
          interviewerQuestion: params.interviewerQuestion,
          searchQuery: params.searchQuery,
        },
        questions,
        model: RERANK_MODEL_ID,
      },
      { timeout: RERANK_TIMEOUT_MS, retry: { maxRetries: 0 } },
    );

    const scored: { chunk: ScoredChunk; relevance: number }[] = [];
    for (const [position, candidate] of params.candidates.entries()) {
      const answer = result.answers?.[keyFor(position)];
      const relevance = answer?.noul;
      if (typeof relevance !== 'number' || !Number.isFinite(relevance)) {
        // A partial answer set is treated as a malformed response rather than
        // silently dropping the candidates it missed: a selection built from
        // half the judgements is not the selection this was asked for.
        throw new Error(`missing or malformed answer for candidate ${position}`);
      }
      scored.push({ chunk: candidate, relevance });
    }

    const kept = scored
      .filter((entry) => entry.relevance >= RERANK_KEEP_THRESHOLD)
      // Descending by relevance. Array.prototype.sort is stable and the input
      // is in cosine order, so equal judgements keep the index's own ranking
      // rather than an arbitrary one.
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, TOP_K)
      .map((entry) => entry.chunk);

    return {
      kept,
      fellBack: false,
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    // AC-6: a timeout, a provider error, a malformed response and a missing
    // prompt file all land here, and all mean the same thing to the caller.
    // Nothing is rethrown, because this runs inside a tool executor that must
    // not throw, and because the fallback is a selection the caller already
    // holds.
    //
    // Name and status only, never the provider's message text. The repo's
    // logging convention already says so for SDK errors, and here it also
    // keeps third party text out of a line that must carry no chunk content.
    const status = (error as { status?: unknown })?.status;
    const name = error instanceof Error ? error.name : 'unknown';
    return {
      kept: [],
      fellBack: true,
      cause: typeof status === 'number' ? `${name}:${status}` : name,
      ...empty,
      durationMs: Date.now() - startedAt,
    };
  }
}
