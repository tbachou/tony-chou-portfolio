/**
 * Rebuilds the retrieval index from the committed corpus (spec 0012 phase
 * three, AC-1, AC-2, AC-3).
 *
 *   npm run embed:corpus --workspace=apps/api            # rebuild and write the manifest
 *   npm run embed:corpus --workspace=apps/api -- --dry-run   # show what would change, touch nothing
 *
 * Run deliberately, never automatically. It is the only thing that writes to
 * the index, and it needs UPSTASH_VECTOR_WRITE_TOKEN, which exists only on a
 * developer machine and never in the deployed environment.
 */
import { config as loadEnv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

loadEnv({ path: path.resolve(__dirname, '..', '.env') });

import { chunkMarkdown, oversizedChunks, type Chunk } from '../src/modules/conversation/retrieval/chunk';
import {
  collectCorpus,
  hashCorpus,
  type CorpusManifest,
} from '../src/modules/conversation/retrieval/corpus';
import { openForWriting, replaceAll } from '../src/modules/conversation/retrieval/vector-store';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'evals', 'interview', 'corpus.json');

function readManifest(): CorpusManifest | null {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as CorpusManifest;
  } catch (cause) {
    throw new Error(`corpus.json exists but is not valid JSON: ${MANIFEST_PATH}`, { cause });
  }
}

/** What changed since the last embed, so a run says what it did. */
function describeChanges(previous: CorpusManifest | null, documents: { path: string; hash: string }[]) {
  const before = new Map((previous?.documents ?? []).map((d) => [d.path, d.hash]));
  const after = new Map(documents.map((d) => [d.path, d.hash]));
  const added = [...after.keys()].filter((p) => !before.has(p));
  const removed = [...before.keys()].filter((p) => !after.has(p));
  const changed = [...after.entries()]
    .filter(([p, h]) => before.has(p) && before.get(p) !== h)
    .map(([p]) => p);
  return { added, removed, changed };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const documents = collectCorpus(REPO_ROOT);
  if (documents.length === 0) {
    console.error('❌ the corpus selection matched no documents. Check the rules in retrieval/corpus.ts.');
    process.exit(1);
  }

  const chunks: Chunk[] = documents.flatMap((doc) => chunkMarkdown(doc.text, doc.path));
  const corpusHash = hashCorpus(documents);
  const previous = readManifest();
  const { added, removed, changed } = describeChanges(previous, documents);

  console.log(`Corpus: ${documents.length} documents, ${chunks.length} chunks`);
  console.log(`corpusHash: ${corpusHash.slice(0, 12)}…`);
  if (previous) {
    console.log(`previous:   ${previous.corpusHash.slice(0, 12)}… (${previous.documents.length} documents)`);
  } else {
    console.log('previous:   none, this is the first embed');
  }

  if (added.length || removed.length || changed.length) {
    console.log('\nChanges since the last embed:');
    for (const p of added) console.log(`  + ${p}`);
    for (const p of removed) console.log(`  - ${p}`);
    for (const p of changed) console.log(`  ~ ${p}`);
  } else if (previous) {
    console.log('\nNo document changed. The index is rebuilt anyway, which is cheap and keeps it exact.');
  }

  // A paragraph longer than the cap is embedded whole rather than cut mid
  // sentence, so the document is worth fixing at the source.
  const oversized = oversizedChunks(chunks);
  if (oversized.length > 0) {
    console.warn(`\n⚠ ${oversized.length} chunk(s) exceed the character cap as a single paragraph:`);
    for (const chunk of oversized.slice(0, 10)) {
      console.warn(`   ${chunk.text.length} chars  ${chunk.sourcePath}  (${chunk.headingPath})`);
    }
    console.warn('   They are embedded whole. Splitting the paragraph in the source document is the fix.');
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing was written to the index or to corpus.json.');
    return;
  }

  // The write happens BEFORE the manifest is rewritten, and the manifest is
  // only written if every batch succeeded. A partial write leaves the old
  // manifest in place, which under claims the index and so fails the eval's
  // staleness check loudly. The reverse, a manifest describing an index state
  // that never existed, would quietly defeat that check.
  const index = openForWriting();
  console.log('\nReplacing the index…');
  await replaceAll(index, chunks);

  const manifest: CorpusManifest = {
    corpusHash,
    chunkCount: chunks.length,
    embeddedAt: new Date().toISOString(),
    documents: documents.map(({ path: p, hash }) => ({ path: p, hash })),
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${path.relative(REPO_ROOT, MANIFEST_PATH)}`);
  console.log('Commit it: the eval compares this against the documents on disk and refuses on a mismatch.');
}

main().catch((error: unknown) => {
  console.error('❌ embed failed:');
  console.error(error instanceof Error ? error.message : String(error));
  console.error('\ncorpus.json was NOT rewritten, so it still describes the previous index.');
  process.exit(1);
});
