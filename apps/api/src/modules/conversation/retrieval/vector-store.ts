import { Index } from '@upstash/vector';
import type { Chunk } from './chunk';

/**
 * The read and write paths to the Upstash Vector index (spec 0012 phase
 * three, AC-3, AC-5, AC-10).
 *
 * Two entry points on purpose, because they need different credentials and
 * the split is a real guarantee rather than a convention:
 *
 *   openReadOnly()  the running API and the eval harness. Reads the index's
 *                   READ ONLY token, so a bug in a path that should only
 *                   query cannot damage the corpus. Verified against the live
 *                   index: an upsert with this token returns
 *                   403 "Forbidden: /upsert is not allowed".
 *   openForWriting() the embed script alone, on a developer machine. The write
 *                   token is never set in the deployed environment.
 *
 * The index carries a hosted embedding model, so `data` takes raw text on both
 * write and read and Upstash embeds it. There is no embedding call here and no
 * OpenAI credential, which is the reason this store was chosen.
 */

/** A result handed to the model. Nothing else about the index reaches it. */
export type RetrievedChunk = {
  text: string;
  heading: string;
  sourcePath: string;
};

/** AC-5: at most three results per call. */
export const TOP_K = 3;

/**
 * AC-5: results below this similarity are dropped, so a query with no real
 * match returns nothing rather than the three least bad vectors in the index.
 * Upstash normalises scores to 0 to 1 whatever the metric, so this number
 * means the same thing regardless of how the index was configured.
 *
 * **This is a placeholder, not a calibration.** It replaced the spec's 0.7
 * starting value on 2026-08-31 after four probe queries against the real 566
 * chunk corpus:
 *
 *   0.736  "how do you approach testing"
 *   0.709  "what happens when a fix introduces the next bug"
 *   0.663  "what do you do when a guard keeps breaking"
 *   0.568  "what is your favourite colour"
 *
 * What that evidence actually supports is narrow: 0.7 was demonstrably wrong,
 * because it dropped the third query, which is one of the questions this phase
 * exists to answer. Where to land instead was a guess. The queries were written
 * and graded by the same author as the chunker, there is one negative example
 * and it is an absurd one rather than a near miss, and no winning chunk was
 * read to check it answers the question rather than merely coming from a
 * plausible file. Four points do not separate two distributions.
 *
 * **Evidence added 2026-09-01, while writing AC-14's cases.** Probing the live
 * 607 chunk index separated two populations more clearly than the original
 * four probes did:
 *
 *   0.787  "did the context engineering change improve the eval scores"   hit
 *   0.741  "specced a feature then decided it should not be built"        hit
 *   0.709  "a change that shipped but did not move the measured scores"   hit
 *   0.647  "how do you handle being on call and your rotation"            MISS
 *   0.644  "what is your approach to salary negotiation"                  MISS
 *   0.569  "favourite holiday destination and what you cook"              MISS
 *
 * The two misses at 0.644 and 0.647 are the problem: they are plausible
 * professional questions this corpus does not answer, and at 0.62 each one
 * returns three loosely related chunks about credential checks and provider
 * swaps. Genuine hits sit at 0.71 and above, so something near 0.68 to 0.70
 * would separate them. That is still six points rather than a sweep, and it is
 * recorded here as evidence rather than acted on, because changing the value
 * changes what every eval run retrieves and the calibration belongs with the
 * run that measures it.
 *
 * A real value needs a labelled set, and AC-14's golden cases are one: they are
 * questions with known correct answers, written for this purpose. Measure
 * precision and recall across thresholds when they land, and replace this.
 *
 * Until then it errs toward recall on purpose. A retrieved chunk the model
 * ignores costs little and is visible through attribution; a dropped chunk
 * makes the capability quietly not work, which is the failure actually
 * observed here.
 */
export const MINIMUM_SIMILARITY = 0.62;

type ChunkMetadata = { heading: string; headingPath: string; sourcePath: string };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Retrieval needs the Upstash index credentials; ` +
        'see the Configuration section of spec 0012 searchPortfolio retrieval.',
    );
  }
  return value;
}

/**
 * Is retrieval configured at all?
 *
 * Checked before the tool is offered rather than after it is called. Without
 * this the model spends a whole extra round trip to be told the search is
 * unavailable, on every turn where it decides to search, in a deployment that
 * could have known at startup. The degrade path (AC-8) still exists for a
 * failure that happens once retrieval IS configured.
 */
export function isRetrievalConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_VECTOR_REST_URL && process.env.UPSTASH_VECTOR_REST_TOKEN,
  );
}

/** Query only. Used by the API and by the eval harness. */
export function openReadOnly(): Index {
  return new Index({
    url: requireEnv('UPSTASH_VECTOR_REST_URL'),
    token: requireEnv('UPSTASH_VECTOR_REST_TOKEN'),
  });
}

/** Write capable. Used by the embed script and nothing else. */
export function openForWriting(): Index {
  return new Index({
    url: requireEnv('UPSTASH_VECTOR_REST_URL'),
    token: requireEnv('UPSTASH_VECTOR_WRITE_TOKEN'),
  });
}

/**
 * Replaces the whole index with these chunks (AC-3).
 *
 * A full replace rather than an incremental upsert, and this is load bearing.
 * Upsert adds and overwrites but never deletes, so a document that was removed
 * or a chunk whose boundaries moved would leave retrievable ghosts behind. The
 * corpus hash cannot detect them: it recomputes over the documents that exist
 * now and never sees what is actually in the index.
 *
 * `reset()` then upsert is not atomic, so there is a brief window where the
 * index is empty. Production handles that correctly already, since an empty
 * result degrades to a story only answer, but run this when traffic is not
 * expected.
 */
export async function replaceAll(index: Index, chunks: Chunk[]): Promise<void> {
  await index.reset();
  const BATCH = 50;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH).map((chunk) => ({
      id: chunk.id,
      data: chunk.text,
      metadata: {
        heading: chunk.heading,
        headingPath: chunk.headingPath,
        sourcePath: chunk.sourcePath,
      } satisfies ChunkMetadata,
    }));
    await index.upsert(batch);
  }
}

/**
 * The read path behind the `searchKnowledge` tool (AC-5).
 *
 * Returns at most three chunks, each carrying its heading and source path,
 * which is what makes the attribution in AC-6 possible at all: without the
 * path the persona has nothing to name.
 */
export async function search(index: Index, query: string): Promise<RetrievedChunk[]> {
  // includeData is required to get the chunk text back. Without it the query
  // returns ids, scores and metadata only, so the model would receive a
  // citation with nothing to cite. Caught by the first live query.
  const results = await index.query({
    data: query,
    topK: TOP_K,
    includeMetadata: true,
    includeData: true,
  });
  return results
    .filter((result) => result.score >= MINIMUM_SIMILARITY)
    .map((result) => {
      const metadata = (result.metadata ?? {}) as Partial<ChunkMetadata>;
      return {
        text: String(result.data ?? ''),
        heading: metadata.heading ?? '',
        sourcePath: metadata.sourcePath ?? '',
      };
    })
    .filter((chunk) => chunk.sourcePath.length > 0);
}
