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
 * **Calibrated 2026-09-01** against the 607 chunk index, replacing a 0.62
 * placeholder that had been guessed from four self written probes. Twenty
 * labelled queries: ten the corpus genuinely answers, ten plausible interview
 * questions it does not.
 *
 *   positives top-1  0.699 0.710 0.725 0.763 0.765 0.784 0.788 0.796 0.808 0.852
 *   negatives top-1  0.569 0.602 0.631 0.644 0.650 0.652 0.668 0.705 0.711 0.720
 *
 * The two populations OVERLAP, so no value separates them and none was
 * expected to. Three negatives outscore the weakest positive, and all three
 * are process and people questions (hiring loops, performance reviews, daily
 * standups) against a corpus full of documents about how this engineer works.
 * They are semantically near because they ARE near.
 *
 *   threshold   positives kept   negatives rejected
 *   0.62               10/10            2/10          <- the old placeholder
 *   0.65               10/10            5/10
 *   0.68               10/10            7/10          <- here
 *   0.70                9/10            7/10
 *   0.73                7/10           10/10
 *
 * 0.68 keeps every positive, sits just under the weakest at 0.699, and takes
 * negatives rejected from two to seven. Going further costs real recall: 0.73
 * buys the last three negatives for three positives, and this design errs
 * toward recall on purpose. A retrieved chunk the model ignores is cheap and
 * visible through attribution; a dropped chunk makes the capability quietly
 * not work, which is the failure actually observed here.
 *
 * What the number does NOT do is keep junk out entirely. At 0.68 three of ten
 * unrelated questions still return chunks, which is why the persona is told
 * not to cite material that does not answer the question, and why a golden
 * case tests exactly that.
 */
export const MINIMUM_SIMILARITY = 0.68;

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
