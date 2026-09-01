#!/usr/bin/env node
/**
 * Fails when the committed documents no longer match the embedded index
 * (spec 0012 phase three, AC-1, AC-11, AC-12).
 *
 * Why this exists as its own CI check rather than living inside the eval.
 * The corpus changes when a spec is written, and `evals.yml` does not trigger
 * on `docs/specs/**`, so the normal way drift happens (write a spec, forget to
 * re embed) fires nothing at all. AC-12's refusal would only surface later, on
 * an unrelated pull request that happens to touch the conversation module,
 * blocking that change for a reason belonging to a different one.
 *
 * This reads files only. It never contacts Upstash and needs no credentials,
 * which is what lets it run on every pull request including forks. It cannot
 * prove the index matches the manifest; it proves the REPO matches the
 * manifest, and the embed script is the only thing that writes both.
 *
 * It imports the same selection and hashing the embed script uses rather than
 * restating them, because two copies of a rule are the drift this phase argues
 * against. It lives in apps/api rather than the repo root because it runs under
 * tsx, which is declared there; running it from the root would rely on npm
 * hoisting an undeclared dependency.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { collectCorpus, hashCorpus } from '../src/modules/conversation/retrieval/corpus';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'evals', 'interview', 'corpus.json');
const REMEDY = 'Re embed and commit the manifest: npm run embed:corpus --workspace=apps/api';

function fail(lines: string[]): never {
  console.error('check:corpus FAILED\n');
  for (const line of lines) console.error(`  ${line}`);
  console.error(`\n${REMEDY}`);
  process.exit(1);
}

if (!existsSync(MANIFEST_PATH)) {
  fail([
    'docs/evals/interview/corpus.json is missing, so nothing records which',
    'documents are embedded in the retrieval index.',
  ]);
}

let manifest: { corpusHash?: string; chunkCount?: number; documents?: { path: string; hash: string }[] };
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
} catch (error: unknown) {
  fail([`corpus.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`]);
}

const documents = collectCorpus(REPO_ROOT).map(({ path: p, hash }) => ({ path: p, hash }));
const actualHash = hashCorpus(documents);

if (actualHash === manifest.corpusHash) {
  console.log(
    `check:corpus ok — ${documents.length} documents, ${manifest.chunkCount} chunks, ` +
      `hash ${actualHash.slice(0, 12)}…`,
  );
  process.exit(0);
}

// Name what moved. A refusal that says only "the hash changed" sends someone
// hunting; the per document hashes exist precisely so this message can be
// specific about which files are responsible.
const recorded = new Map((manifest.documents ?? []).map((d) => [d.path, d.hash]));
const current = new Map(documents.map((d) => [d.path, d.hash]));
const added = [...current.keys()].filter((p) => !recorded.has(p));
const removed = [...recorded.keys()].filter((p) => !current.has(p));
const changed = [...current.entries()]
  .filter(([p, h]) => recorded.has(p) && recorded.get(p) !== h)
  .map(([p]) => p);

const lines = [
  'The committed documents no longer match the embedded corpus.',
  `  manifest: ${String(manifest.corpusHash).slice(0, 12)}…  (${(manifest.documents ?? []).length} documents)`,
  `  repo now: ${actualHash.slice(0, 12)}…  (${documents.length} documents)`,
  '',
];
for (const p of added) lines.push(`+ ${p}`);
for (const p of removed) lines.push(`- ${p}`);
for (const p of changed) lines.push(`~ ${p}`);
if (added.length + removed.length + changed.length === 0) {
  lines.push('No document differs by name or content, so the manifest itself was hand edited.');
}
fail(lines);
