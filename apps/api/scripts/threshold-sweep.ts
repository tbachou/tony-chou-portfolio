#!/usr/bin/env node
/**
 * Re measures how MINIMUM_SIMILARITY separates answerable questions from
 * unanswerable ones (spec 0012 phase three, AC-5).
 *
 *   npm run sweep:threshold --workspace=apps/api
 *
 * Why this exists. The threshold was calibrated once, against the 607 chunk
 * index, and then the corpus was re embedded. The chunking finding
 * (2026-09-01-heading-prefix-per-chunk) established that a re embed
 * REPARTITIONS: which paragraphs land together is an accident of their
 * lengths and the packer's arithmetic, so a chunk that was a tight match can
 * simply stop existing. Nothing in the repo noticed that the last time it
 * happened, because check:corpus compares the repo to the manifest and the
 * population check compares the manifest to the index BY COUNT. Neither can
 * see retrieval quality move. This can.
 *
 * READ ONLY. It opens the index with the read token and issues queries; it
 * never writes, so it cannot disturb the index it is measuring. Embedding
 * stays a deliberate local act (see embed-corpus.ts). The queries themselves
 * are embedded by Upstash to be matched, which spends a little of the daily
 * Upstash quota and no Anthropic budget.
 *
 * It reports rather than prescribing a new number. Moving MINIMUM_SIMILARITY
 * is a judgement about the recall/precision trade this design deliberately
 * errs on (see the comment above the constant); a script that edited it would
 * be making that call silently.
 */
import { config as loadEnv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

loadEnv({ path: path.resolve(__dirname, '..', '.env') });

import {
  MINIMUM_SIMILARITY,
  openReadOnly,
  isRetrievalConfigured,
} from '../src/modules/conversation/retrieval/vector-store';
import { checkIndexPopulation } from '../src/modules/conversation/retrieval/index-health';
import { POSITIVES, NEGATIVES, type LabelledQuery } from './threshold-sweep.queries';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'evals', 'interview', 'corpus.json');

/** The thresholds the report walks, so the table is comparable to the one
 * recorded above MINIMUM_SIMILARITY in vector-store.ts. */
const CANDIDATES = [0.62, 0.65, 0.68, 0.7, 0.73];

type Scored = LabelledQuery & {
  /** Top-1 similarity, UNFILTERED. `search()` applies the threshold, which is
   * the very thing under test, so this queries the index directly. */
  score: number;
  /** Where the top hit actually came from, for diagnosing a drop. */
  matched: string;
};

async function scoreAll(
  index: ReturnType<typeof openReadOnly>,
  queries: LabelledQuery[],
): Promise<Scored[]> {
  const out: Scored[] = [];
  for (const q of queries) {
    const results = await index.query({
      data: q.query,
      topK: 1,
      includeMetadata: true,
    });
    const top = results[0];
    const metadata = (top?.metadata ?? {}) as { sourcePath?: string };
    out.push({
      ...q,
      score: top?.score ?? 0,
      matched: metadata.sourcePath ?? '(none)',
    });
  }
  return out;
}

function fmt(n: number): string {
  return n.toFixed(3);
}

async function main(): Promise<void> {
  if (!isRetrievalConfigured()) {
    console.error(
      'sweep:threshold needs UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN.\n' +
        'They live in apps/api/.env on a developer machine.',
    );
    process.exit(1);
  }

  // Refuse against an index that does not match the manifest. A sweep over a
  // half written index produces a table of real looking numbers that describe
  // nothing, and the whole point of this script is to be the thing that does
  // not quietly measure the wrong index.
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as {
    chunkCount: number;
    corpusHash: string;
  };
  const index = openReadOnly();
  const info = await index.info();
  const population = checkIndexPopulation(info, manifest.chunkCount);
  if (!population.ok) {
    console.error(`sweep:threshold refused — ${population.message}`);
    process.exit(1);
  }

  console.log(
    `index ${population.vectorCount} vectors, corpus ${manifest.corpusHash.slice(0, 12)}…, ` +
      `threshold in code ${MINIMUM_SIMILARITY}\n`,
  );

  const positives = await scoreAll(index, POSITIVES);
  const negatives = await scoreAll(index, NEGATIVES);

  const sortedPos = [...positives].sort((a, b) => a.score - b.score);
  const sortedNeg = [...negatives].sort((a, b) => a.score - b.score);
  console.log(`positives top-1  ${sortedPos.map((r) => fmt(r.score)).join(' ')}`);
  console.log(`negatives top-1  ${sortedNeg.map((r) => fmt(r.score)).join(' ')}\n`);

  console.log('  threshold   positives kept   negatives rejected');
  for (const t of CANDIDATES) {
    const kept = positives.filter((r) => r.score >= t).length;
    const rejected = negatives.filter((r) => r.score < t).length;
    const marker = t === MINIMUM_SIMILARITY ? '  <- in code' : '';
    console.log(
      `  ${t.toFixed(2)}        ${String(kept).padStart(5)}/10        ${String(rejected).padStart(8)}/10${marker}`,
    );
  }

  // A positive that no longer clears the threshold is the failure this design
  // cares about: a dropped chunk makes the capability quietly not work, while
  // a retrieved chunk the model ignores is cheap and visible through
  // attribution. So a lost positive fails the run; a lost negative warns.
  const lost = positives.filter((r) => r.score < MINIMUM_SIMILARITY);
  const wrongDoc = positives.filter(
    (r) => r.score >= MINIMUM_SIMILARITY && r.expects !== '' && r.matched !== r.expects,
  );

  if (wrongDoc.length > 0) {
    console.log('\nCleared the threshold but reached a different document than expected:');
    for (const r of wrongDoc) {
      console.log(`  ${fmt(r.score)}  "${r.query}"`);
      console.log(`         expected ${r.expects}`);
      console.log(`         matched  ${r.matched}`);
    }
    console.log(
      '  Not a failure by itself: another document may answer it as well or better.\n' +
        '  It is the signature of a boundary shift, so read it before re embedding again.',
    );
  }

  if (lost.length > 0) {
    console.error(
      `\nsweep:threshold FAILED — ${lost.length} of 10 positives no longer clear ${MINIMUM_SIMILARITY}:`,
    );
    for (const r of lost) {
      console.error(`  ${fmt(r.score)}  "${r.query}"`);
      console.error(`         expected ${r.expects}`);
      console.error(`         matched  ${r.matched}`);
    }
    console.error(
      '\nThe corpus answers these questions, so retrieval returning nothing for them is\n' +
        'the capability quietly not working. Either the threshold no longer suits the\n' +
        'index, or a re embed moved the chunk that used to match.',
    );
    process.exit(1);
  }

  console.log(
    `\nsweep:threshold ok — 10/10 positives clear ${MINIMUM_SIMILARITY}, ` +
      `${negatives.filter((r) => r.score < MINIMUM_SIMILARITY).length}/10 negatives rejected.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
