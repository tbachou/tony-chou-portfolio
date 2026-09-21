#!/usr/bin/env node
/**
 * The missing comparison arm: spec 0013's ACTUAL chosen implementation —
 * Haiku 4.5 behind a forced tool call — over the same 149 sentences the Jev
 * spike used.
 *
 *   npm run spike:haiku --workspace=apps/api           # dry
 *   npm run spike:haiku --workspace=apps/api -- --live
 *
 * WHY THIS EXISTS. `run.ts` measured Jev against the deterministic guard, and
 * the guard is fitted to this corpus — it is its own spec, it scores 0/0 by
 * construction, it cannot lose. So that run compared Jev to a control, never
 * to the alternative anyone would actually ship. Latency and price favour Jev
 * from published numbers; on ACCURACY there was no Haiku figure at all. This
 * produces one.
 *
 * FIDELITY. This calls the real `AnthropicService.forceToolCall` with the same
 * model, system prompt, tool name, schema, maxTokens, timeout and retry count
 * as `ConversationService.credentialVerifier` on
 * `claude/spec-0013-self-implementation-5b307c`, and applies the same suppress
 * rule. The service takes no constructor dependencies — it reads
 * ANTHROPIC_API_KEY from the environment and builds its client lazily — so
 * this is the production path, not a reimplementation of it.
 *
 * Two things are transcribed from that branch rather than imported, because it
 * is a different worktree on a different base: `haiku-prompt.md` (a copy of
 * `skills/credential-check.md`) and the verdict schema below. If either is
 * edited there, this measurement is stale and must be re-run.
 */
import { config as loadEnv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

loadEnv({ path: path.resolve(import.meta.dirname, '..', '..', '.env') });

import { AnthropicService } from '../../src/modules/anthropic/anthropic.service.js';
import { loadCorpus, type Case } from './corpus.js';

const PROMPT_PATH = path.join(import.meta.dirname, 'haiku-prompt.md');

/** Transcribed from credential-check.ts on the spec-0013 branch. */
const CREDENTIAL_VERDICT_CATEGORIES = [
  'current_claim',
  'past_tense_ok',
  'no_credential_mentioned',
  'ambiguous',
] as const;

const CredentialVerdict = z.object({
  reasoning: z
    .string()
    .describe('One sentence: which part of the answer decided this, and why'),
  category: z
    .enum(CREDENTIAL_VERDICT_CATEGORIES)
    .describe('The single verdict category for this answer'),
});

const { $schema, ...CREDENTIAL_VERDICT_SCHEMA } = z.toJSONSchema(
  CredentialVerdict,
) as Record<string, unknown>;
void $schema;

const CREDENTIAL_CHECK_MODEL = 'claude-haiku-4-5';

type Verdict = {
  category: string;
  /** The branch's rule verbatim: a claim OR an unsure verdict suppresses. */
  suppress: boolean;
};

async function verdictFor(
  service: AnthropicService,
  text: string,
): Promise<Verdict> {
  try {
    const { input } = await service.forceToolCall({
      model: CREDENTIAL_CHECK_MODEL,
      system: fs.readFileSync(PROMPT_PATH, 'utf8'),
      userMessage: text,
      maxTokens: 200,
      toolName: 'report_credential_verdict',
      toolDescription:
        'Report the credential claim result with reasoning behind it',
      inputSchema: CREDENTIAL_VERDICT_SCHEMA,
      timeoutMs: 3000,
      maxRetries: 0,
    });
    const parsed = CredentialVerdict.safeParse(input);
    if (!parsed.success) return { category: 'unparsable', suppress: true };
    const { category } = parsed.data;
    return {
      category,
      suppress: category === 'current_claim' || category === 'ambiguous',
    };
  } catch {
    // The branch distinguishes timeout from provider_error; for a measurement
    // both are the same thing — the check could not answer, so it fails closed.
    return { category: 'provider_error', suppress: true };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const live = argv.includes('--live');
  const ci = argv.indexOf('--concurrency');
  const concurrency = ci === -1 ? 4 : Math.max(1, Number(argv[ci + 1]));
  const oi = argv.indexOf('--out');
  const out = oi === -1 ? null : (argv[oi + 1] ?? null);

  const cases: Case[] = loadCorpus();
  const claims = cases.filter((c) => c.label === 'claim').length;
  const honest = cases.length - claims;
  console.log(
    `\n${cases.length} sentences (${claims} claims / ${honest} honest), ` +
      `model ${CREDENTIAL_CHECK_MODEL}`,
  );

  if (!live) {
    console.log('\nDry run. Nothing called, nothing spent. Add --live.');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('\n--live needs ANTHROPIC_API_KEY in apps/api/.env.');
    process.exit(1);
  }

  const service = new AnthropicService();
  const verdicts = new Array<Verdict>(cases.length);
  let cursor = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= cases.length) return;
        verdicts[index] = await verdictFor(service, cases[index].text);
        if ((index + 1) % 25 === 0) {
          process.stderr.write(`  ...${index + 1}/${cases.length}\n`);
        }
      }
    }),
  );

  const elapsed = Date.now() - started;
  console.log(
    `  done in ${(elapsed / 1000).toFixed(1)}s at concurrency ${concurrency}`,
  );

  let missed = 0;
  let suppressedHonest = 0;
  const byCategory = new Map<string, number>();
  cases.forEach((c, i) => {
    const v = verdicts[i];
    byCategory.set(v.category, (byCategory.get(v.category) ?? 0) + 1);
    if (c.label === 'claim' && !v.suppress) missed += 1;
    if (c.label === 'honest' && v.suppress) suppressedHonest += 1;
  });

  console.log('\nHaiku 4.5, spec 0013 prompt and suppress rule');
  console.log(
    `  missed claims      ${String(missed).padStart(3)}/${claims} ` +
      `(${((100 * missed) / claims).toFixed(1)}%)`,
  );
  console.log(
    `  suppressed honest  ${String(suppressedHonest).padStart(3)}/${honest} ` +
      `(${((100 * suppressedHonest) / honest).toFixed(1)}%)`,
  );
  console.log('\n  verdict categories:');
  for (const [category, n] of [...byCategory].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${category.padEnd(24)} ${n}`);
  }

  const wrongClaims = cases.filter(
    (c, i) => c.label === 'claim' && !verdicts[i].suppress,
  );
  const wrongHonest = cases.filter(
    (c, i) => c.label === 'honest' && verdicts[i].suppress,
  );
  if (wrongClaims.length) {
    console.log('\n  CLAIMS IT LET THROUGH (the safety failures):');
    wrongClaims.forEach((c) => {
      const v = verdicts[cases.indexOf(c)];
      console.log(`    [${v.category}] ${c.text}`);
    });
  }
  if (wrongHonest.length) {
    console.log('\n  HONEST ANSWERS IT SUPPRESSED (the cost):');
    wrongHonest.forEach((c) => {
      const v = verdicts[cases.indexOf(c)];
      console.log(`    [${v.category}] ${c.text}`);
    });
  }

  if (out) {
    fs.writeFileSync(
      out,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          note: 'Sentences are test fixtures from ownership-guard.spec.ts, deliberately including false claims, and are NOT statements by Tony Chou.',
          model: CREDENTIAL_CHECK_MODEL,
          elapsedMs: elapsed,
          cases: cases.map((c, i) => ({ ...c, ...verdicts[i] })),
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
