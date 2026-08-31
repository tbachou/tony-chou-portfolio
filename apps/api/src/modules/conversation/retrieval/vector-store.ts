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
 * Calibrated against the real 566 chunk corpus on 2026-08-31, replacing the
 * spec's 0.7 starting value. Measured on four probe queries:
 *
 *   0.736  "how do you approach testing"            -> the eval suite spec
 *   0.709  "what happens when a fix introduces the next bug" -> phase two writeup
 *   0.663  "what do you do when a guard keeps breaking"      -> Beta guardrails spec
 *   0.568  "what is your favourite colour"          -> noise, correctly nothing
 *
 * Signal sits at 0.66 to 0.74 and noise at 0.57, so 0.7 cut through the middle
 * of the signal band and silently dropped a question the spec named as a target
 * capability. 0.62 clears the observed noise floor by 0.05 and admits every
 * genuine hit by at least 0.04.
 *
 * Deliberately favours recall over precision at this stage: a retrieved chunk
 * the model ignores costs little and is visible through attribution, while a
 * dropped chunk makes the capability silently not work, which is the failure
 * that was actually observed.
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
