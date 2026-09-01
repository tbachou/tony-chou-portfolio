import { canSaveBaseline, evaluateRunOutcome } from './run-outcome';
import { checkIndexPopulation } from '../retrieval/index-health';

describe('evaluateRunOutcome (AC-9, the mid-run half)', () => {
  it('fails the run when retrieval was strict and a case failed to generate', () => {
    // The confirmed reproduction from 2026-09-01: the strict-mode throw is
    // caught by generateTurnPair, surfaces as a turn_error, the harness records
    // generation_error, `partial` stays false, and the run exited 0.
    const outcome = evaluateRunOutcome({
      strictRetrieval: true,
      generationErrors: ['c'],
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.message).toContain('retrieval was strict');
    expect(outcome.message).toContain('c');
    // The results file is still written; the failure has to be readable.
    expect(outcome.message).toContain('still written');
  });

  it('passes a strict run with no generation errors', () => {
    expect(
      evaluateRunOutcome({ strictRetrieval: true, generationErrors: [] }),
    ).toEqual({ exitCode: 0, message: '' });
  });

  it('leaves a non-strict run alone', () => {
    // A generation error outside strict retrieval has always been a scored
    // outcome rather than a failed run. Changing that is a separate decision.
    expect(
      evaluateRunOutcome({
        strictRetrieval: false,
        generationErrors: ['a', 'b'],
      }).exitCode,
    ).toBe(0);
  });
});

describe('canSaveBaseline', () => {
  it('refuses a run whose cases all completed but some failed to generate', () => {
    // The hole: `partial` is false here, because every case produced a result.
    const verdict = canSaveBaseline({
      partial: false,
      generationErrors: ['c'],
    });

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({ message: expect.stringContaining('c') });
  });

  it('still refuses a partial run', () => {
    expect(canSaveBaseline({ partial: true, generationErrors: [] }).ok).toBe(
      false,
    );
  });

  it('allows a full run where every case generated', () => {
    expect(canSaveBaseline({ partial: false, generationErrors: [] })).toEqual({
      ok: true,
    });
  });
});

describe('checkIndexPopulation (AC-9, the empty-index hole)', () => {
  it('refuses an index holding no vectors', () => {
    // The confirmed reproduction: a query against an empty index returns []
    // without throwing, so the reachability probe passed and every search
    // returned "no match", which is not a failure and never trips strict mode.
    const verdict = checkIndexPopulation({ vectorCount: 0 }, 580);

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({
      message: expect.stringContaining('no vectors'),
    });
  });

  it('refuses a half-written index, which is what an aborted embed leaves', () => {
    // replaceAll resets and then upserts in batches, so dying between the two
    // leaves this state with the manifest still matching the repo.
    const verdict = checkIndexPopulation({ vectorCount: 412 }, 580);

    expect(verdict.ok).toBe(false);
    expect(verdict).toMatchObject({
      message: expect.stringContaining('412'),
    });
  });

  it('accepts an exact match, counting vectors still pending', () => {
    // Pending vectors are accepted but not yet queryable; they are really
    // there, so counting them avoids a spurious refusal right after an embed.
    expect(
      checkIndexPopulation({ vectorCount: 578, pendingVectorCount: 2 }, 580),
    ).toEqual({ ok: true, vectorCount: 580 });
    expect(checkIndexPopulation({ vectorCount: 580 }, 580)).toEqual({
      ok: true,
      vectorCount: 580,
    });
  });

  it('refuses an index holding more than the manifest describes', () => {
    // Exact equality, not a floor: a full replace should leave precisely the
    // manifest's count, and more means the index is not what was embedded.
    expect(checkIndexPopulation({ vectorCount: 640 }, 580).ok).toBe(false);
  });
});
