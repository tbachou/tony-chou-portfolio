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

loadEnv({ path: path.resolve(import.meta.dirname, '..', '.env') });

import {
  MINIMUM_SIMILARITY,
  cosineSelection,
  openReadOnly,
  isRetrievalConfigured,
  searchCandidates,
} from '../src/modules/conversation/retrieval/vector-store.js';
import {
  RERANK_KEEP_THRESHOLD,
  RERANK_MODEL_ID,
  isRerankConfigured,
  rerankCandidates,
} from '../src/modules/conversation/retrieval/reranker.js';
import { checkIndexPopulation } from '../src/modules/conversation/retrieval/index-health.js';
import { POSITIVES, NEGATIVES, type LabelledQuery } from './threshold-sweep.queries.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
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

/**
 * The reranked arm (spec 0012 phase six, AC-11).
 *
 * Runs both selection paths over the same widened candidate set and reports
 * them side by side, which is what makes the decision to enforce an evidence
 * based one rather than a preference. The exit bar in the spec's migration
 * plan reads directly off this table: the reranked arm must reach the expected
 * document at least as often as 0.68 does, must beat it on at least one query,
 * and must lose no labelled positive.
 *
 * Two honest limits, both deliberate. `filterChunksForStory` is NOT applied
 * here, because it is story aware and a labelled query has no story; this
 * measures retrieval, not the guard. And the interviewer's question and the
 * search query are the same string, because a labelled query is the question,
 * with no persona paraphrase in between. Production judges against both, so
 * this arm measures the easier of the two cases.
 */
type ArmResult = LabelledQuery & {
  /** Paths the cosine path would hand the persona. */
  cosinePaths: string[];
  /** Paths the reranker would hand the persona. */
  rerankPaths: string[];
  fellBack: boolean;
};

async function runArms(
  index: ReturnType<typeof openReadOnly>,
  queries: LabelledQuery[],
): Promise<ArmResult[]> {
  const out: ArmResult[] = [];
  for (const q of queries) {
    const candidates = await searchCandidates(index, q.query);
    const cosine = cosineSelection(candidates);
    const reranked = await rerankCandidates({
      candidates,
      interviewerQuestion: q.query,
      searchQuery: q.query,
    });
    out.push({
      ...q,
      cosinePaths: cosine.map((c) => c.sourcePath),
      rerankPaths: reranked.kept.map((c) => c.sourcePath),
      fellBack: reranked.fellBack,
    });
  }
  return out;
}

/** A positive is reached when the expected document is in the selection. */
function reached(paths: string[], expects: string): boolean {
  return expects !== '' && paths.includes(expects);
}

function reportArms(positives: ArmResult[], negatives: ArmResult[]): void {
  const fellBack = [...positives, ...negatives].filter((r) => r.fellBack).length;
  if (fellBack > 0) {
    console.log(
      `\n  WARNING: the reranker fell back on ${fellBack} of ${positives.length + negatives.length} queries.\n` +
        '  Those rows show the cosine selection in the rerank column, so the comparison\n' +
        '  below understates the difference. Read the cause before trusting the table.',
    );
  }

  const cosineHits = positives.filter((r) => reached(r.cosinePaths, r.expects)).length;
  const rerankHits = positives.filter((r) => reached(r.rerankPaths, r.expects)).length;
  const cosineRejects = negatives.filter((r) => r.cosinePaths.length === 0).length;
  const rerankRejects = negatives.filter((r) => r.rerankPaths.length === 0).length;

  console.log(`\n  arm                      positives reached   negatives rejected`);
  console.log(
    `  cosine ${MINIMUM_SIMILARITY} top-${3}              ${String(cosineHits).padStart(5)}/${positives.length}` +
      `             ${String(cosineRejects).padStart(5)}/${negatives.length}`,
  );
  console.log(
    `  rerank ${RERANK_MODEL_ID} @ ${RERANK_KEEP_THRESHOLD}    ${String(rerankHits).padStart(5)}/${positives.length}` +
      `             ${String(rerankRejects).padStart(5)}/${negatives.length}`,
  );

  // Per query disagreement is the useful detail: a tie on the totals can still
  // mean the two arms disagree on half the rows.
  const disagreed = [...positives, ...negatives].filter(
    (r) => r.cosinePaths.join('|') !== r.rerankPaths.join('|'),
  );
  if (disagreed.length > 0) {
    console.log(`\n  the two arms disagreed on ${disagreed.length} of ${positives.length + negatives.length} queries:`);
    for (const r of disagreed) {
      console.log(`    "${r.query}"`);
      console.log(`      expected ${r.expects === '' ? '(nothing)' : r.expects}`);
      console.log(`      cosine   ${r.cosinePaths.join(', ') || '(nothing)'}`);
      console.log(`      rerank   ${r.rerankPaths.join(', ') || '(nothing)'}`);
    }
  }

  const regressed = positives.filter(
    (r) => reached(r.cosinePaths, r.expects) && !reached(r.rerankPaths, r.expects),
  );
  const won = positives.filter(
    (r) => !reached(r.cosinePaths, r.expects) && reached(r.rerankPaths, r.expects),
  );

  console.log('\n  exit bar (spec 0012 phase six, migration step 3):');
  console.log(
    `    reaches expected at least as often   ${rerankHits >= cosineHits ? 'PASS' : 'FAIL'}` +
      `  (${rerankHits} vs ${cosineHits})`,
  );
  console.log(
    `    beats cosine on at least one query   ${won.length > 0 ? 'PASS' : 'FAIL'}  (${won.length})`,
  );
  console.log(
    `    loses no labelled positive           ${regressed.length === 0 ? 'PASS' : 'FAIL'}` +
      `  (${regressed.length} lost)`,
  );
  console.log(
    '\n  Reported, not enforced. Whether to set enforce is a judgement about the\n' +
      '  trade this table describes, and a script that decided it would be making\n' +
      '  that call silently.',
  );
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

  // AC-11. Skipped rather than failed without a key: the threshold table above
  // is the reason this script exists and still stands on its own.
  if (!isRerankConfigured()) {
    console.log(
      '\nreranked arm skipped — TYPESAFE_API_KEY is not set.\n' +
        'It lives in apps/api/.env on a developer machine.',
    );
    return;
  }
  console.log(`\nreranked arm — ${RERANK_MODEL_ID}, one judgement per candidate. This spends TypeSafe budget.`);
  const posArms = await runArms(index, POSITIVES);
  const negArms = await runArms(index, NEGATIVES);
  reportArms(posArms, negArms);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
