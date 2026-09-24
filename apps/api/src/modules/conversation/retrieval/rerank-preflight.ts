import { isRerankConfigured, rerankCandidates, type SystemOneCaller } from './reranker.js';
import type { ScoredChunk } from './vector-store.js';

/**
 * Does the reranker actually answer? (spec 0012 phase six, AC-10.)
 *
 * The eval harness forces `enforce`, because the phase's scoreboard entry is
 * only meaningful if the eval exercised what ships. But the reranker fails
 * open by design (AC-6): with no key, a wrong key, or the provider down, every
 * search quietly returns the cosine selection. So a forced `enforce` alone
 * proves nothing, and a run in that state would score the pre phase six path
 * while being recorded as a reranked one. The pre deploy gate found that
 * nothing checked, and the retrieval half of this harness already refuses the
 * same quiet substitution (phase three, AC-9).
 *
 * One probe, one candidate, before anything is spent. It checks that a
 * judgement came back, not what the judgement was: the model's opinion of a
 * fixed sentence is not something a preflight should gate on.
 *
 * Exists in `src/` only so the test runner collects it; its one caller is
 * `scripts/interview-eval/run.ts`.
 */

export type RerankPreflight = { ok: true } | { ok: false; reason: string };

/** Data for the probe, not prompt text: the prompt stays in `rerank.md`. */
const PROBE: ScoredChunk = {
  sourcePath: 'preflight',
  heading: 'Preflight',
  text: 'The retrieval similarity threshold was calibrated against twenty labelled queries.',
  score: 1,
};

export async function rerankPreflight(caller?: SystemOneCaller): Promise<RerankPreflight> {
  if (!isRerankConfigured()) {
    return { ok: false, reason: 'TYPESAFE_API_KEY is not set' };
  }
  const result = await rerankCandidates({
    candidates: [PROBE],
    interviewerQuestion: 'How was the retrieval similarity threshold chosen?',
    searchQuery: 'similarity threshold calibration',
    caller,
  });
  if (result.fellBack) {
    return {
      ok: false,
      reason: `the reranker did not answer a one candidate probe (${result.cause ?? 'unknown cause'})`,
    };
  }
  return { ok: true };
}
