/**
 * Is the index actually populated? (spec 0012 phase three, AC-9.)
 *
 * The eval preflight used to prove retrieval by running one query and treating
 * "no exception" as success. That is not proof: a query against an EMPTY index
 * returns `[]` without throwing. Confirmed on 2026-09-01 against a real zero
 * vector namespace of the live index, and the consequence is that the check
 * written to enforce AC-9 violated it. Every search returned nothing, which is
 * a normal outcome rather than a failure, so the strict mode never fired and
 * the run wrote a results file indistinguishable from one where retrieval
 * worked.
 *
 * `corpusHash` does not cover this either, because it hashes the repo's
 * documents rather than the index's contents. Two runs can share a corpus hash
 * while their indexes differ arbitrarily, which is the incomparability AC-11
 * was supposed to make visible.
 *
 * The window is real rather than theoretical: `replaceAll` calls `reset()` and
 * then upserts in batches, and the embed script rebuilds the index even when no
 * document changed. An embed that dies between those two steps leaves the
 * manifest matching the repo byte for byte while the index holds nothing.
 */

/** The fields of Upstash's `index.info()` this check reads. */
export type IndexInfo = {
  vectorCount: number;
  /** Vectors accepted but not yet queryable. Counted: they are really there. */
  pendingVectorCount?: number;
};

export type PopulationVerdict =
  | { ok: true; vectorCount: number }
  | { ok: false; message: string };

/**
 * Exact equality, not a threshold.
 *
 * The manifest records the chunk count the embed script wrote, and the embed is
 * a full replace, so the index should hold precisely that many vectors. A
 * tolerance would let a half finished embed pass, which is the case this
 * exists to catch.
 */
export function checkIndexPopulation(
  info: IndexInfo,
  expectedChunkCount: number,
): PopulationVerdict {
  const total = info.vectorCount + (info.pendingVectorCount ?? 0);
  if (total === expectedChunkCount) {
    return { ok: true, vectorCount: total };
  }
  if (total === 0) {
    return {
      ok: false,
      message:
        `the index holds no vectors, but corpus.json describes ${expectedChunkCount} chunks. ` +
        'Every search would return nothing, which is a normal outcome rather than a failure, ' +
        'so the run would score as though retrieval had been switched off. ' +
        'Re embed: npm run embed:corpus --workspace=apps/api',
    };
  }
  return {
    ok: false,
    message:
      `the index holds ${total} vectors but corpus.json describes ${expectedChunkCount} chunks. ` +
      'An embed that failed part way leaves exactly this state, and the manifest still matches ' +
      'the repo, so nothing else would catch it. Re embed: npm run embed:corpus --workspace=apps/api',
  };
}
