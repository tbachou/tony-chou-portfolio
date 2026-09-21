#!/usr/bin/env node
/**
 * Mines the shadow corpus for sentences the Beta output guard let through that
 * a comprehension layer thinks it should not have.
 *
 *   npm run corpus --workspace=apps/api -- --concurrency 3 --dump-text  # first
 *   npm run spike:jev:discover --workspace=apps/api                     # dry
 *   npm run spike:jev:discover --workspace=apps/api -- --live
 *
 * WHY THIS IS A DISCOVERY RUN AND NOT A SCORE. The harvested coach prose is
 * UNLABELLED. Treating "the guard did not fire" as ground truth for "honest"
 * would be circular, and circular in the specific place it matters: R6's own
 * comment in `beta-output-guard.ts` records that a bare assertion ("the pulley
 * is torn") passes, so guard silence there is the known hole rather than
 * evidence of innocence. The 2026-09-20 run also showed the pipeline is
 * nondeterministic — `fp-01-load-only` fired R2 on a 2-profile run and not on
 * the 35-profile run — so guard silence is not even stable.
 *
 * So this script computes NO accuracy, NO false-positive rate, and NO
 * threshold recommendation. It ranks sentences by how strongly a Noul thinks
 * each asserts a diagnosis (R6) or promises recovery (R7), and prints the top
 * of that ranking for a human to adjudicate. Every sentence it surfaces was
 * passed by the guard, because the harvest it reads had zero firings.
 *
 * A hit here is a CANDIDATE guard miss, not a confirmed one. The output is a
 * worklist, and the only thing that turns an entry into a finding is Tony
 * reading it.
 */
import { config as loadEnv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

loadEnv({ path: path.resolve(__dirname, '..', '..', '.env') });

const CORPUS_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '.corpus',
  'ac-g9-corpus-run.json',
);
const QUESTIONS_PATH = path.join(__dirname, 'discover-questions.md');

/** Pinned for the same reason run.ts pins: a moving alias makes two runs
 *  incomparable, and this one is meant to be re-run against later harvests. */
const MODEL = 'jev-1.13.0';
const INPUT_PRICE_PER_MTOK = 0.042;

type Sentence = {
  text: string;
  /** The sentence before it, for pronoun resolution only. */
  context: string;
  /** Which corpus profiles produced this exact sentence. */
  profiles: string[];
};

type Prompt = { instructions: string; yes: string; no: string };

/**
 * Splits a markdown file into its `## ` sections.
 *
 * Split-based rather than a lookahead regex. The obvious
 * `(?=^## |\Z)` does not work in JavaScript: `\Z` is not an anchor here, it
 * matches a literal "Z", so the LAST section of a file silently fails to
 * parse. That bug was live in this directory and only stayed hidden because
 * the file it ran against happened to end with a `---` the lookahead caught.
 *
 * A `---` rule ends a section: what follows it is file-level prose, such as a
 * version note, and must not become part of a question the model is sent.
 */
function sections(markdown: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of markdown.split(/^## /m).slice(1)) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    let body = newline === -1 ? '' : part.slice(newline + 1);
    const rule = body.search(/^---\s*$/m);
    if (rule !== -1) body = body.slice(0, rule);
    map.set(heading, body.trim());
  }
  return map;
}

function section(markdown: string, heading: string): string {
  const body = sections(markdown).get(heading);
  if (!body) {
    throw new Error(
      `discover-questions.md has no \`## ${heading}\` section with a body.`,
    );
  }
  return body;
}

function loadPrompts(): { r6: Prompt; r7: Prompt } {
  const md = fs.readFileSync(QUESTIONS_PATH, 'utf8');
  return {
    r6: {
      instructions: section(md, 'R6 Instructions'),
      yes: section(md, 'R6 Yes'),
      no: section(md, 'R6 No'),
    },
    r7: {
      instructions: section(md, 'R7 Instructions'),
      yes: section(md, 'R7 Yes'),
      no: section(md, 'R7 No'),
    },
  };
}

/**
 * Splits one coach plan into candidate sentences.
 *
 * Markdown scaffolding is dropped rather than judged: headings, table rows,
 * bold-only labels and bullet markers are structure, and R3/R4 already own
 * structure in code. Both rules here are about prose making a claim.
 */
function sentencesOf(plan: string): { text: string; context: string }[] {
  const prose = plan
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      if (t === '' || t.startsWith('#') || t.startsWith('|')) return false;
      // A line that is only a bold label ("**When:** Week 1") carries no claim.
      return !/^\*\*[^*]+:\*\*\s*\S{0,24}$/.test(t);
    })
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/\*\*/g, ''))
    .join(' ');

  const raw = prose.split(/(?<=[.!?])\s+/);
  const out: { text: string; context: string }[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const text = raw[i].replace(/\s+/g, ' ').trim();
    // Too short to carry a claim; too long means the split failed and the
    // "sentence" is really a run of them, which would blur what was judged.
    if (text.length < 25 || text.length > 320) continue;
    out.push({ text, context: (raw[i - 1] ?? '').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

function loadSentences(): Sentence[] {
  if (!fs.existsSync(CORPUS_PATH)) {
    throw new Error(
      `No harvest at ${CORPUS_PATH}.\n` +
        `Run it first, which costs real model spend:\n` +
        `  npm run corpus --workspace=apps/api -- --concurrency 3 --dump-text`,
    );
  }
  const data = JSON.parse(fs.readFileSync(CORPUS_PATH, 'utf8')) as {
    firings: unknown[];
    results: { id: string; planText?: string }[];
  };

  if (data.firings.length > 0) {
    // Not fatal, but it changes what a hit means: with firings present, some
    // of what follows may be a sentence the guard DID catch.
    console.log(
      `NOTE: this harvest recorded ${data.firings.length} guard firing(s), so ` +
        `"passed by the guard" is no longer true of every sentence below.\n`,
    );
  }

  const byText = new Map<string, Sentence>();
  for (const result of data.results) {
    if (!result.planText) continue;
    for (const { text, context } of sentencesOf(result.planText)) {
      const existing = byText.get(text);
      if (existing) {
        if (!existing.profiles.includes(result.id)) {
          existing.profiles.push(result.id);
        }
      } else {
        byText.set(text, { text, context, profiles: [result.id] });
      }
    }
  }
  return [...byText.values()];
}

// ---------------------------------------------------------------------------

type Scored = Sentence & { r6: number; r7: number };

async function score(
  sentences: Sentence[],
  prompts: { r6: Prompt; r7: Prompt },
  concurrency: number,
): Promise<{ scored: Scored[]; inputTokens: number; models: Set<string> }> {
  let sdk: Record<string, unknown>;
  try {
    // Variable specifier: a literal would make `tsc --noEmit` fail across the
    // whole api workspace until the package is installed. See run.ts.
    const specifier = '@typesafe-ai/sdk';
    sdk = (await import(specifier)) as Record<string, unknown>;
  } catch {
    throw new Error(
      'Cannot load @typesafe-ai/sdk. Install it as a devDependency first:\n' +
        '  npm install --save-dev @typesafe-ai/sdk --workspace=apps/api',
    );
  }
  const TypeSafeClient = sdk.TypeSafeClient as new () => {
    systemOne: (input: {
      model: string;
      state: unknown;
      questions: Record<string, unknown>;
    }) => Promise<{
      model?: string;
      answers: Record<string, { noul?: number }>;
      usage?: { input_tokens?: number };
    }>;
  };
  if (typeof TypeSafeClient !== 'function') {
    throw new Error('SDK did not export TypeSafeClient; fix score() here.');
  }

  const noul = (p: Prompt) => ({
    type: 'noul',
    instructions: p.instructions,
    criteria: { true: p.yes, false: p.no },
  });

  const client = new TypeSafeClient();
  const scored = new Array<Scored>(sentences.length);
  const models = new Set<string>();
  let inputTokens = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= sentences.length) return;
      const sentence = sentences[index];
      // Both questions in ONE request: they are independent judgments over the
      // same state, so they run in parallel and the state is sent once.
      const response = await client.systemOne({
        model: MODEL,
        state: {
          target: sentence.text,
          precedingContext: sentence.context,
        },
        questions: {
          assertsDiagnosis: noul(prompts.r6),
          promisesRecovery: noul(prompts.r7),
        },
      });
      const r6 = response.answers?.assertsDiagnosis?.noul;
      const r7 = response.answers?.promisesRecovery?.noul;
      if (typeof r6 !== 'number' || typeof r7 !== 'number') {
        throw new Error(
          `Sentence ${index} returned no usable noul pair: ` +
            `${JSON.stringify(response).slice(0, 300)}`,
        );
      }
      scored[index] = { ...sentence, r6, r7 };
      inputTokens += response.usage?.input_tokens ?? 0;
      if (response.model) models.add(response.model);
      if ((index + 1) % 100 === 0) {
        process.stderr.write(`  ...${index + 1}/${sentences.length}\n`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, sentences.length) }, worker),
  );
  return { scored, inputTokens, models };
}

// ---------------------------------------------------------------------------

function report(scored: Scored[], key: 'r6' | 'r7', label: string): void {
  const ranked = [...scored].sort((a, b) => b[key] - a[key]);
  const bands = [0.9, 0.7, 0.5, 0.3];
  console.log(`\n${label}`);
  for (const band of bands) {
    const n = ranked.filter((s) => s[key] >= band).length;
    console.log(`  p >= ${band}: ${n}`);
  }
  const worklist = ranked.filter((s) => s[key] >= 0.3).slice(0, 15);
  if (worklist.length === 0) {
    console.log(
      '  Nothing at or above 0.3. On this harvest the comprehension layer found\n' +
        '  no candidate miss for this rule, which is itself the finding.',
    );
    return;
  }
  console.log('  Worklist, highest first — each needs a human verdict:');
  for (const s of worklist) {
    console.log(
      `    p=${s[key].toFixed(3)} [${s.profiles.length} profile(s)] ${s.text}`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live');
  const outIndex = argv.indexOf('--out');
  const out = outIndex === -1 ? null : (argv[outIndex + 1] ?? null);
  const concurrencyIndex = argv.indexOf('--concurrency');
  const concurrency =
    concurrencyIndex === -1
      ? 3
      : Math.max(1, Number(argv[concurrencyIndex + 1]));

  const prompts = loadPrompts();
  const sentences = loadSentences();
  const promptChars = Object.values(prompts).reduce(
    (sum, p) => sum + p.instructions.length + p.yes.length + p.no.length,
    0,
  );
  const estimatedTokens = sentences.reduce(
    (sum, s) =>
      sum + Math.ceil((s.text.length + s.context.length + promptChars) / 4),
    0,
  );

  console.log(
    `\n${sentences.length} unique sentences from the shadow harvest ` +
      `(${CORPUS_PATH.split('/').slice(-2).join('/')})`,
  );

  if (!live) {
    console.log(
      `\nDry run. Nothing called, nothing spent.\n` +
        `--live would send ~${estimatedTokens.toLocaleString()} input tokens ` +
        `(~$${((estimatedTokens / 1e6) * INPUT_PRICE_PER_MTOK).toFixed(4)}), ` +
        `one request per sentence carrying both questions.`,
    );
    return;
  }
  if (!process.env.TYPESAFE_API_KEY) {
    console.error('\n--live needs TYPESAFE_API_KEY in apps/api/.env.');
    process.exit(1);
  }

  console.log(`\nScoring at concurrency ${concurrency}...`);
  const started = Date.now();
  const { scored, inputTokens, models } = await score(
    sentences,
    prompts,
    concurrency,
  );
  console.log(
    `  done in ${((Date.now() - started) / 1000).toFixed(1)}s · ` +
      `${inputTokens.toLocaleString()} input tokens · ` +
      `$${((inputTokens / 1e6) * INPUT_PRICE_PER_MTOK).toFixed(4)} · ` +
      `model ${[...models].join(', ')}`,
  );

  report(
    scored,
    'r6',
    'R6 — diagnosis asserted as fact (guard was silent on all of these)',
  );
  report(
    scored,
    'r7',
    'R7 — recovery promised as fact (guard was silent on all of these)',
  );

  console.log(
    '\nHOW TO READ THIS. Every line is a CANDIDATE, not a finding. The harvest\n' +
      '  is unlabelled, so nothing here has been checked against truth — a high\n' +
      '  score means a comprehension layer disagrees with the guard, and the\n' +
      '  disagreement is resolved by a person reading the sentence, not by this\n' +
      '  script. Sentences that are genuinely fine will appear; that is expected\n' +
      '  and is not a false-positive rate, because there is no rate to compute.',
  );

  if (out) {
    fs.writeFileSync(
      out,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note:
            'Discovery output. Sentences are MODEL-GENERATED coach text from a ' +
            'shadow corpus run, not statements by Tony Chou, and no entry here ' +
            'has been confirmed as a guard miss.',
          model: MODEL,
          reportedModels: [...models],
          inputTokens,
          sentences: scored,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nWrote ${out}.`);
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
