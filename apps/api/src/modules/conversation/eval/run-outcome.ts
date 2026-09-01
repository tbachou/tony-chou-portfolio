/**
 * Does a finished eval run pass or fail? (spec 0012 phase three, AC-9.)
 *
 * The preflight refuses before spending when retrieval is misconfigured, which
 * covers the credentials and the stale index. It cannot cover a failure that
 * happens DURING a run: a transient outage, a rate limit, an index that goes
 * away mid flight. Strict mode was supposed to cover those by throwing.
 *
 * It did not, and this file is why the run now checks. Measured on 2026-09-01:
 * the throw is caught by `generateTurnPair`, surfaces as a `turn_error`, the
 * harness retries the case once (doubling generator spend) and records
 * `generation_error`. Every case still produces a result, so `partial` stays
 * false, the run writes its results, regenerates the scoreboard and exits 0.
 * It would even have been accepted by `--save-baseline`. AC-9 says the RUN
 * fails loudly; only the preflight did.
 *
 * Separated from `run.ts` so the decision can be tested without a script that
 * calls `process.exit`.
 */

export type RunOutcome = {
  exitCode: 0 | 1;
  /** Printed when the run is being failed. Empty when it passes. */
  message: string;
};

/**
 * A generation error under strict retrieval is a failed run, not a low score.
 *
 * Only under strict mode. Production style degradation is a deliberate choice
 * elsewhere, and a generation error in a non strict run has always been
 * recorded as a scored outcome rather than a failure; changing that would be a
 * separate decision about a path this spec does not own.
 */
export function evaluateRunOutcome(params: {
  strictRetrieval: boolean;
  generationErrors: string[];
}): RunOutcome {
  if (!params.strictRetrieval || params.generationErrors.length === 0) {
    return { exitCode: 0, message: '' };
  }
  return {
    exitCode: 1,
    message:
      `${params.generationErrors.length} case(s) failed to generate while retrieval was strict: ` +
      `${params.generationErrors.join(', ')}. ` +
      'The results file was still written so the failures can be read, but this run did not ' +
      'measure what it claims to and must not be compared or baselined.',
  };
}

/**
 * Whether a run may become the committed baseline.
 *
 * `partial` was the only gate, and it does not catch a run where every case
 * produced a result and some of those results were generation errors. A
 * baseline is the thing every later run is measured against, so it has to be a
 * run that actually ran.
 */
export function canSaveBaseline(params: {
  partial: boolean;
  generationErrors: string[];
}): { ok: true } | { ok: false; message: string } {
  if (params.partial) {
    return {
      ok: false,
      message:
        'refusing --save-baseline on a partial run (capped or aborted): the baseline must be a full-set run.',
    };
  }
  if (params.generationErrors.length > 0) {
    return {
      ok: false,
      message:
        `refusing --save-baseline: ${params.generationErrors.length} case(s) failed to generate ` +
        `(${params.generationErrors.join(', ')}). A baseline every later run is measured against ` +
        'has to be a run where every case actually generated.',
    };
  }
  return { ok: true };
}
