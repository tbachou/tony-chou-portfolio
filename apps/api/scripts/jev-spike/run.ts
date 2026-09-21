#!/usr/bin/env node
/**
 * Does a System One model read the credential sentence better than the regex?
 *
 *   npm run spike:jev --workspace=apps/api            # baseline only, spends nothing
 *   npm run spike:jev --workspace=apps/api -- --live  # calls Jev, spends money
 *
 * Why this exists. `ownership-guard.ts` carries a KNOWN CEILING block written
 * after eight rounds of adversarial hardening, in which most defects were
 * introduced by the previous round's fix. Its conclusion is that assert-versus-
 * deny is not a property of the characters, and that the real fix is spec 0013:
 * a narrow structured call, with the regex demoted to a cheap first filter.
 * Spec 0013 is still Proposed and assumes a Haiku forced tool call. Jev
 * (typesafe.ai) is a different shape of answer — one binary question returning
 * a calibrated probability in 70-500ms — and the question this script answers
 * is whether that probability is good enough to gate a fail-closed safety path.
 *
 * It measures against the corpus the eight rounds already produced, extracted
 * live from the spec (see corpus.ts). That corpus is the most expensive asset
 * in this investigation and it is already labelled, so the spike costs almost
 * nothing to run and nothing at all to run in baseline mode.
 *
 * WHAT IT DOES NOT DO. It touches no production code, writes no file unless
 * asked, and prescribes no threshold. Choosing where the fail-closed band sits
 * is a judgement about a regulated healthcare credential; a script that picked
 * it would be making that call silently. It reports the sweep and stops, the
 * same way scripts/threshold-sweep.ts does for MINIMUM_SIMILARITY.
 *
 * READ THE CAVEAT the report prints at the end before quoting any number from
 * it. The corpus is adversarial, not representative.
 *
 * Requires a generated Prisma client, because the guard imports StoryOwnership
 * as a value. In a fresh worktree run `npx prisma generate` in apps/api first.
 */
import { config as loadEnv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';

loadEnv({ path: path.resolve(import.meta.dirname, '..', '..', '.env') });

import type { StoryModel } from '../../src/generated/prisma/models.js';
import {
  CREDENTIAL_GUARD_REASON,
  evaluateTonyResponse,
} from '../../src/modules/conversation/ownership-guard.js';
import { loadCorpus, type Case } from './corpus.js';

const QUESTION_PATH = path.join(import.meta.dirname, 'question.md');

type Prompt = { instructions: string; yes: string; no: string };

/**
 * Splits question.md into the three fields a Noul request takes. Throws rather
 * than defaulting a missing section: an empty `criteria.false` would quietly
 * change the question being asked while the report still printed numbers.
 */
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

/**
 * Splits question.md into the three fields a Noul request takes. Throws rather
 * than defaulting a missing section: an empty `criteria.false` would quietly
 * change the question being asked while the report still printed numbers.
 */
function loadPrompt(markdown: string): Prompt {
  const found = sections(markdown);
  const need = (heading: string): string => {
    const body = found.get(heading);
    if (!body) {
      throw new Error(
        `question.md has no \`## ${heading}\` section with a body. The file ` +
          `must carry Instructions, Yes and No — see the note at its top.`,
      );
    }
    return body;
  };
  return {
    instructions: need('Instructions'),
    yes: need('Yes'),
    no: need('No'),
  };
}

/** Jev's published input price, $/MTok. Output is free. */
const INPUT_PRICE_PER_MTOK = 0.042;

/**
 * Pinned to a dated id, not the `jev-latest` alias. TypeSafe's own models page
 * says an alias moves when a release ships, so the answers behind it change
 * without a change on your side, and advises pinning the version whenever
 * confidence thresholds have been tuned against one. That is exactly this
 * spike's situation: the sweep's numbers belong to this model and to no other.
 * Versioned ids are accepted by the `model` field whether or not `GET
 * /v1/models` lists them, which is what makes spec 0013's AC-9 satisfiable here.
 */
const MODEL = 'jev-1.13.0';

/**
 * The thresholds the sweep walks. Weighted toward the low end on purpose: on a
 * fail-closed gate the interesting question is not "where is the model right
 * most often" but "how low must I set the bar before no claim gets through",
 * and what that costs in honest answers suppressed.
 */
const THRESHOLDS = [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9];

/**
 * The same fixture the spec uses. Ownership is SOLO so the ownership rules stay
 * out of the way: this spike is about the credential rule only.
 */
const soloStory = {
  id: 'story-1',
  title: 'Portfolio rebuild',
  engagement: 'Personal project',
  summary: 'Rebuilt the portfolio site end to end.',
  ownership: 'SOLO',
  requiredFraming: null,
} as unknown as StoryModel;

type Args = {
  live: boolean;
  out: string | null;
  concurrency: number;
  limit: number | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { live: false, out: null, concurrency: 2, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--live') args.live = true;
    else if (arg === '--out') args.out = argv[++i] ?? null;
    else if (arg === '--concurrency') args.concurrency = Number(argv[++i]);
    else if (arg === '--limit') args.limit = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: spike:jev [--live] [--out <path>] [--concurrency N] [--limit N]',
      );
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    console.error('--concurrency must be a positive number');
    process.exit(2);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

type Verdict = {
  /** Did this mechanism suppress the answer? */
  suppressed: boolean;
  /** For the guard: blocked, but by some OTHER rule. Reported separately so a
   *  block for the wrong reason is never counted as a win. */
  otherReason?: string;
};

function runGuard(text: string): Verdict {
  const result = evaluateTonyResponse(text, soloStory);
  if (result.ok) return { suppressed: false };
  if (result.reason === CREDENTIAL_GUARD_REASON) return { suppressed: true };
  return { suppressed: false, otherReason: result.reason };
}

type Confusion = {
  /** Claims the mechanism let through. The safety failure. */
  missedClaims: number;
  /** Honest answers the mechanism suppressed. The cost. */
  suppressedHonest: number;
  caughtClaims: number;
  allowedHonest: number;
};

function confuse(
  cases: Case[],
  suppressed: (index: number) => boolean,
): Confusion {
  const c: Confusion = {
    missedClaims: 0,
    suppressedHonest: 0,
    caughtClaims: 0,
    allowedHonest: 0,
  };
  cases.forEach((testCase, index) => {
    const blocked = suppressed(index);
    if (testCase.label === 'claim') {
      if (blocked) c.caughtClaims += 1;
      else c.missedClaims += 1;
    } else if (blocked) c.suppressedHonest += 1;
    else c.allowedHonest += 1;
  });
  return c;
}

// ---------------------------------------------------------------------------
// The one place that touches the SDK
// ---------------------------------------------------------------------------

/**
 * ISOLATED DELIBERATELY. This is the only place that touches the SDK, so an
 * early-access surface change is a one-function fix. Built against the v0.6.0
 * types (typesafe-ai/typesafe-sdk-js `src/types.ts`), not against prose.
 *
 * The question is a PLAIN OBJECT rather than the `noul()` factory the
 * quickstart uses for `choice()`. `NoulQuestion` is a documented interface —
 * `{ type, instructions?, criteria? }` — so the literal is guaranteed valid,
 * while whether a `noul` factory is exported is an assumption this spike does
 * not need to make.
 *
 * Imported dynamically so baseline mode runs today, before the package is
 * installed and before a key exists.
 */
type JevRun = {
  probabilities: number[];
  /** Real usage from the API, not an estimate. */
  inputTokens: number;
  outputTokens: number;
  /** What the service says it actually ran, which may differ from MODEL. */
  modelsSeen: Set<string>;
};

async function askJev(
  texts: string[],
  prompt: Prompt,
  concurrency: number,
): Promise<JevRun> {
  let sdk: Record<string, unknown>;
  try {
    // The specifier is in a variable ON PURPOSE. `apps/api/tsconfig.json` has
    // no `include`, so it typechecks everything under the workspace, scripts
    // included — and a literal `import('@typesafe-ai/sdk')` is resolved
    // statically, so it fails `npx tsc --noEmit` with TS2307 until the package
    // is installed. That would break the repo's commit gate for everyone on a
    // spike nobody else is running. Do not inline this back.
    const specifier = '@typesafe-ai/sdk';
    sdk = (await import(specifier)) as Record<string, unknown>;
  } catch {
    throw new Error(
      'Cannot load @typesafe-ai/sdk. Install it first:\n' +
        '  npm install --save-dev @typesafe-ai/sdk --workspace=apps/api\n' +
        'It is a devDependency on purpose: nothing in src/ imports it, and this ' +
        'spike must not become a production dependency by accident.',
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
      usage?: { input_tokens?: number; output_tokens?: number };
    }>;
  };
  if (typeof TypeSafeClient !== 'function') {
    throw new Error(
      'The SDK did not export TypeSafeClient. The early-access surface has ' +
        'changed; fix askJev() in this file.',
    );
  }

  const client = new TypeSafeClient();
  const run: JevRun = {
    probabilities: new Array<number>(texts.length),
    inputTokens: 0,
    outputTokens: 0,
    modelsSeen: new Set<string>(),
  };
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= texts.length) return;
      const response = await client.systemOne({
        model: MODEL,
        // A named field rather than a bare string: it tells the model what the
        // text IS, which is the difference between judging an answer and
        // judging a free-floating sentence.
        state: { answer: texts[index] },
        questions: {
          // The id is for code and is never sent to the model, so the whole
          // meaning has to live in instructions and criteria.
          claimsCurrentCredential: {
            type: 'noul',
            instructions: prompt.instructions,
            criteria: { true: prompt.yes, false: prompt.no },
          },
        },
      });
      const value = response.answers?.claimsCurrentCredential?.noul;
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(
          `Case ${index} returned no usable noul value: ` +
            `${JSON.stringify(response).slice(0, 300)}`,
        );
      }
      run.probabilities[index] = value;
      run.inputTokens += response.usage?.input_tokens ?? 0;
      run.outputTokens += response.usage?.output_tokens ?? 0;
      if (response.model) run.modelsSeen.add(response.model);
      if ((index + 1) % 10 === 0) {
        process.stderr.write(`  ...${index + 1}/${texts.length}\n`);
      }
    }
  };

  // Default concurrency is 2 because early access publishes no rate limits.
  // Raise it once a limit is known, not before.
  await Promise.all(
    Array.from({ length: Math.min(concurrency, texts.length) }, worker),
  );
  return run;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function pct(n: number, total: number): string {
  return total === 0
    ? '   -  '
    : `${((100 * n) / total).toFixed(1).padStart(5)}%`;
}

function reportConfusion(
  label: string,
  c: Confusion,
  claims: number,
  honest: number,
): void {
  console.log(
    `  ${label.padEnd(26)} missed claims ${String(c.missedClaims).padStart(3)}/${claims}` +
      ` (${pct(c.missedClaims, claims)})   ` +
      `suppressed honest ${String(c.suppressedHonest).padStart(3)}/${honest}` +
      ` (${pct(c.suppressedHonest, honest)})`,
  );
}

function reportCalibration(cases: Case[], probabilities: number[]): void {
  console.log(
    '\nCalibration — is the probability meaningful, or just a score?',
  );
  console.log('  bucket        n    observed claim rate');
  const buckets = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0001];
  for (let b = 0; b < buckets.length - 1; b += 1) {
    const lo = buckets[b];
    const hi = buckets[b + 1];
    const inBucket = cases.filter(
      (_, i) => probabilities[i] >= lo && probabilities[i] < hi,
    );
    if (inBucket.length === 0) continue;
    const claims = inBucket.filter((c) => c.label === 'claim').length;
    console.log(
      `  ${lo.toFixed(2)}-${Math.min(hi, 1).toFixed(2)}  ${String(inBucket.length).padStart(4)}    ` +
        `${pct(claims, inBucket.length)}`,
    );
  }
  console.log(
    '  A calibrated model puts the observed rate near the middle of each bucket.\n' +
      '  Buckets that are all-or-nothing mean it is discriminating well but the\n' +
      '  number is not a probability, which changes how a threshold should be read.',
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let cases = loadCorpus();
  if (args.limit !== null) {
    // Stratified, not `slice(0, n)`. The corpus is grouped by label, so a plain
    // head would hand back claims only and the report would still print a
    // confident false-positive rate over zero honest sentences.
    const half = Math.max(1, Math.floor(args.limit / 2));
    cases = [
      ...cases.filter((c) => c.label === 'claim').slice(0, half),
      ...cases.filter((c) => c.label === 'honest').slice(0, args.limit - half),
    ];
  }

  const claims = cases.filter((c) => c.label === 'claim').length;
  const honest = cases.length - claims;
  const questionMarkdown = fs.readFileSync(QUESTION_PATH, 'utf8');
  const prompt = loadPrompt(questionMarkdown);
  const promptChars =
    prompt.instructions.length + prompt.yes.length + prompt.no.length;

  console.log(
    `\nCorpus: ${cases.length} labelled sentences from ownership-guard.spec.ts`,
  );
  console.log(
    `  ${claims} claims (must suppress) · ${honest} honest (must allow)`,
  );
  for (const group of [...new Set(cases.map((c) => c.group))]) {
    const n = cases.filter((c) => c.group === group).length;
    console.log(`    ${group.padEnd(28)} ${String(n).padStart(3)}`);
  }

  const guard = cases.map((c) => runGuard(c.text));
  const guardConfusion = confuse(cases, (i) => guard[i].suppressed);

  console.log('\nBaseline — the regex guard as it ships today');
  reportConfusion('ownership-guard.ts', guardConfusion, claims, honest);
  // The baseline is a CONTROL, not a competitor. This corpus IS the guard's own
  // spec, so the guard is fitted to it and should read 0 and 0; anything else
  // means the extraction is wrong, not that the guard regressed. So the question
  // this spike asks is NOT "who scores higher here" — the regex cannot lose on
  // its own training set. It is: does Jev reach the same place WITHOUT eight
  // rounds of hand-tuning, and where does it sit on the cases each round had to
  // be told about? A Jev score near the guard's is therefore a strong result,
  // not a tie.
  if (
    guardConfusion.missedClaims !== 0 ||
    guardConfusion.suppressedHonest !== 0
  ) {
    console.log(
      '  WARNING: the guard did not score 0/0 on its own spec. Either the spec\n' +
        '  and the guard have drifted, or this extractor is mislabelling. Fix that\n' +
        '  before reading anything else in this report.',
    );
  }
  const otherBlocks = guard.filter((v) => v.otherReason).length;
  if (otherBlocks > 0) {
    console.log(
      `  note: ${otherBlocks} case(s) were blocked by a DIFFERENT rule and are ` +
        `counted as not-suppressed here, since a block for the wrong reason is ` +
        `not evidence about this one.`,
    );
  }

  const estimatedTokens = cases.reduce(
    (sum, c) => sum + Math.ceil((c.text.length + promptChars) / 4),
    0,
  );
  const estimatedCost = (estimatedTokens / 1_000_000) * INPUT_PRICE_PER_MTOK;

  if (!args.live) {
    console.log(
      `\nBaseline only. Nothing was called and nothing was spent.\n` +
        `A --live run would send ~${estimatedTokens.toLocaleString()} input tokens ` +
        `(~$${estimatedCost.toFixed(4)} at $${INPUT_PRICE_PER_MTOK}/MTok).\n` +
        `Rerun with --live once TYPESAFE_API_KEY is in apps/api/.env.`,
    );
    return;
  }

  if (!process.env.TYPESAFE_API_KEY) {
    console.error(
      '\n--live needs TYPESAFE_API_KEY. Put it in apps/api/.env (which is ' +
        'gitignored) — never on the command line, where it lands in shell history.',
    );
    process.exit(1);
  }

  console.log(
    `\nCalling Jev on ${cases.length} sentences at concurrency ${args.concurrency} ` +
      `(~$${estimatedCost.toFixed(4)})...`,
  );
  const started = Date.now();
  const jev = await askJev(
    cases.map((c) => c.text),
    prompt,
    args.concurrency,
  );
  const probabilities = jev.probabilities;
  const elapsed = Date.now() - started;
  const actualCost = (jev.inputTokens / 1_000_000) * INPUT_PRICE_PER_MTOK;
  console.log(
    `  done in ${(elapsed / 1000).toFixed(1)}s ` +
      `(~${Math.round(elapsed / cases.length)}ms per case at concurrency ` +
      `${args.concurrency} — NOT a per-call latency figure)`,
  );
  console.log(
    `  actual usage: ${jev.inputTokens.toLocaleString()} input + ` +
      `${jev.outputTokens.toLocaleString()} output tokens, ` +
      `$${actualCost.toFixed(4)} (estimate was $${estimatedCost.toFixed(4)})`,
  );
  // If the service answered on a different model than MODEL pins, every number
  // below belongs to that model instead. Say so rather than silently attributing.
  const models = [...jev.modelsSeen];
  if (models.length !== 1 || models[0] !== MODEL) {
    console.log(
      `  NOTE: requested ${MODEL}, service reported ${models.join(', ') || '(nothing)'}.`,
    );
  }

  console.log('\nThreshold sweep — suppress when p >= t');
  console.log('  Fail-closed means the left column is the one that matters.');
  let safestThreshold: number | null = null;
  for (const t of THRESHOLDS) {
    const c = confuse(cases, (i) => probabilities[i] >= t);
    reportConfusion(`t = ${t}`, c, claims, honest);
    if (c.missedClaims === 0)
      safestThreshold = Math.max(safestThreshold ?? 0, t);
  }
  console.log(
    safestThreshold === null
      ? '\n  No swept threshold caught every claim. On a fail-closed gate that is\n' +
          '  the finding: Jev alone cannot replace the regex here, though it may\n' +
          '  still be worth having as the second layer spec 0013 describes.'
      : `\n  Highest threshold with zero missed claims: ${safestThreshold}. ` +
          `Read it as a ceiling,\n  not a recommendation — it is fitted to this corpus.`,
  );

  reportCalibration(cases, probabilities);

  console.log('\nDisagreements with the regex, at t = 0.5');
  const wins: string[] = [];
  const losses: string[] = [];
  cases.forEach((c, i) => {
    const jevSuppressed = probabilities[i] >= 0.5;
    if (jevSuppressed === guard[i].suppressed) return;
    const jevRight = (c.label === 'claim') === jevSuppressed;
    const line = `    p=${probabilities[i].toFixed(3)} [${c.label}/${c.group}] ${c.text}`;
    (jevRight ? wins : losses).push(line);
  });
  console.log(`  Jev right where the regex was wrong: ${wins.length}`);
  wins.forEach((l) => console.log(l));
  console.log(`  Jev wrong where the regex was right: ${losses.length}`);
  losses.forEach((l) => console.log(l));

  console.log(
    '\nCAVEAT, read before quoting any number above.\n' +
      '  This corpus is adversarial, not representative. Every sentence in it was\n' +
      '  found by someone hunting for a regex bypass, so hard cases are massively\n' +
      '  over-sampled relative to what the persona actually generates. A score here\n' +
      '  is a score on the hardest distribution anyone could assemble, which makes a\n' +
      '  bad result damning and a good result merely encouraging. It says nothing\n' +
      '  about the base rate in production, where the guard has never once fired on\n' +
      `  a licensure claim. Calibration measured on it is calibration on a corpus\n` +
      `  that is ${claims}/${honest} by construction, not on reality.`,
  );

  if (args.out) {
    const payload = {
      generatedAt: new Date().toISOString(),
      note:
        'Spike output. Every sentence here is a test fixture from ' +
        'ownership-guard.spec.ts, deliberately including false claims, and is ' +
        'NOT a statement by Tony Chou.',
      questionPath: path.relative(process.cwd(), QUESTION_PATH),
      question: questionMarkdown,
      requestedModel: MODEL,
      reportedModels: [...jev.modelsSeen],
      elapsedMs: elapsed,
      concurrency: args.concurrency,
      inputTokens: jev.inputTokens,
      outputTokens: jev.outputTokens,
      cases: cases.map((c, i) => ({
        ...c,
        probability: probabilities[i],
        guardSuppressed: guard[i].suppressed,
      })),
    };
    fs.writeFileSync(args.out, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(
      `\nWrote ${args.out}. It contains model output and fixture sentences — ` +
        `this repo is public, so decide deliberately before committing it.`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
