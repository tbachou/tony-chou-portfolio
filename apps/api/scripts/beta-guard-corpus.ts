/**
 * AC-G9 corpus run (spec 0005 guardrails child, build plan step 7).
 *
 * Drives the REAL beta pipeline — real screener, drafter and coach calls
 * against the live model — with `BETA_OUTPUT_GUARD_MODE=shadow`, and reports
 * every guard firing. Shadow never alters output, so this changes nothing a
 * visitor would see; it only makes the guard evaluate and log.
 *
 * Deliberately NOT a `.spec.ts`. The repo's tests are fully mocked, and a
 * mocked corpus run would certify the rule set against text the model never
 * actually wrote — the exact failure that let the feedback classifier ship
 * broken behind 130 green tests. The point of this harness is that nothing
 * about the model's output is faked.
 *
 * It calls BetaService directly rather than going over HTTP because the
 * controller enforces 3 requests/hour/IP and the persisted daily caps, which
 * a 33-profile run would exhaust immediately. Usage accounting and Postgres
 * are stubbed for the same reason; neither is what AC-G9 is measuring.
 *
 *   npm run corpus -- --limit 2          # smoke test, 2 profiles
 *   npm run corpus                       # full run, all 33
 *   npm run corpus -- --only fp-05-profanity
 *   npm run corpus -- --concurrency 3 --dump-text
 *
 * Costs real API spend: roughly 3 model calls per profile.
 */
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

loadEnv({ path: path.resolve(__dirname, '..', '.env') });

// Shadow, always. Set before BetaService is imported so there is no window in
// which a stray read sees the ambient value, and hard-coded rather than
// inherited so a shell that happens to export `enforce` cannot make this run
// substitute copy on a live model call.
process.env.BETA_OUTPUT_GUARD_MODE = 'shadow';

import { BetaService } from '../src/modules/beta/beta.service';
import { AnthropicService } from '../src/modules/anthropic/anthropic.service';
import type { PrismaService } from '../src/modules/prisma/prisma.service';
import type { BetaUsageService } from '../src/modules/beta/beta-usage.service';
import { CORPUS, type CorpusProfile } from './beta-guard-corpus.profiles';

type GuardFiring = {
  guard: string;
  mode: string;
  rule: string;
  source: 'coach' | 'plan';
  outcome: string;
};

type AgentCall = {
  agent: string;
  model: string;
  provider: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  retried: boolean;
  outcome: string;
};

type ProfileResult = {
  id: string;
  tags: string[];
  /** Did the request actually reach the guard? Only these count toward AC-G9. */
  reachedGuard: boolean;
  // `error` is the transient the emit callback sets; it is resolved into
  // `refusal` or `pipeline_error` below, and only survives if the harness
  // itself threw outside generatePlan.
  terminatedBy:
    | 'plan'
    | 'red_flag'
    | 'refusal'
    | 'pipeline_error'
    | 'error'
    | 'unknown';
  /** Present when the pipeline threw: BetaService's own failure description. */
  pipelineError?: string;
  firings: GuardFiring[];
  calls: AgentCall[];
  planChars: number;
  planText?: string;
};

/**
 * Captures the structured lines BetaService already emits, attributed to the
 * profile that produced them. AsyncLocalStorage rather than slicing a shared
 * array by index: with --concurrency > 1 several profiles interleave their
 * log writes, and index ranges would mix one profile's firings into another's.
 */
const logStore = new AsyncLocalStorage<{ level: string; message: string }[]>();

function installLogCapture(): void {
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = Logger.prototype[level];
    Logger.prototype[level] = function patched(
      this: Logger,
      message: unknown,
      ...rest: unknown[]
    ) {
      logStore.getStore()?.push({ level, message: String(message) });
      return original.call(this, message, ...rest);
    } as typeof original;
  }
}

function parseLines<T>(
  lines: { message: string }[],
  predicate: (value: Record<string, unknown>) => boolean,
): T[] {
  const out: T[] = [];
  for (const line of lines) {
    if (!line.message.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line.message) as Record<string, unknown>;
      if (predicate(parsed)) out.push(parsed as T);
    } catch {
      // Not every log line is JSON; the non-structured ones are not signal here.
    }
  }
  return out;
}

/**
 * No Postgres. `$transaction` is the only member BetaService touches, and it
 * is handed operations this stub's usage service returns as an empty list.
 */
const prismaStub = {
  $transaction: async () => [],
} as unknown as PrismaService;

const counters = {
  redFlagBlock: 0,
  injectionBlock: 0,
  guardBlock: 0,
  refund: 0,
  success: 0,
};

const usageStub = {
  reserveGlobalSlot: async () => true,
  refundGlobalSlot: async () => {
    counters.refund += 1;
  },
  recordRedFlagBlock: async () => {
    counters.redFlagBlock += 1;
  },
  recordInjectionBlock: async () => {
    counters.injectionBlock += 1;
  },
  recordGuardBlock: async () => {
    counters.guardBlock += 1;
  },
  successIncrementOps: () => {
    counters.success += 1;
    return [];
  },
} as unknown as BetaUsageService;

async function runProfile(
  service: BetaService,
  profile: CorpusProfile,
  dumpText: boolean,
): Promise<ProfileResult> {
  const lines: { level: string; message: string }[] = [];
  let planText = '';
  // Held on an object: the assignments below happen inside a callback, and
  // control-flow narrowing on a plain `let` would type it as 'unknown' here.
  const state: { terminatedBy: ProfileResult['terminatedBy'] } = {
    terminatedBy: 'unknown',
  };

  await logStore.run(lines, () =>
    service.generatePlan({
      input: profile.request,
      hashedIp: `corpus-${profile.id}`,
      emit: (event, data) => {
        if (event === 'plan_delta') {
          planText += (data as { text: string }).text;
        } else if (event === 'red_flag') {
          state.terminatedBy = 'red_flag';
        } else if (event === 'error') {
          // REFUSAL and FRIENDLY_ERROR both arrive as `error`; the screener's
          // refusal refunds the slot, the pipeline failure path does too, so
          // the distinction comes from whether any agent call errored.
          state.terminatedBy = 'error';
        } else if (event === 'done') {
          state.terminatedBy = 'plan';
        }
      },
    }),
  );

  const firings = parseLines<GuardFiring>(lines, (v) => v.guard === 'beta-output');
  const calls = parseLines<AgentCall>(lines, (v) => typeof v.agent === 'string');

  // Both a screener refusal and a pipeline throw surface as an `error` event,
  // and agent-call outcomes do not separate them: a throw in parseDraftPlan
  // happens AFTER the drafter call logged `outcome: 'ok'`. The catch block's
  // own line is the only thing that distinguishes them.
  const failure = lines.find((l) =>
    l.message.startsWith('Beta pipeline failed:'),
  );
  if (state.terminatedBy === 'error') {
    state.terminatedBy = failure ? 'pipeline_error' : 'refusal';
  }

  return {
    id: profile.id,
    tags: profile.tags,
    reachedGuard: state.terminatedBy === 'plan',
    terminatedBy: state.terminatedBy,
    firings,
    calls,
    planChars: planText.length,
    ...(failure ? { pipelineError: failure.message } : {}),
    ...(dumpText ? { planText } : {}),
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY is not set (looked in apps/api/.env)');
    process.exit(1);
  }

  const only = arg('only');
  const limit = Number(arg('limit') ?? Number.NaN);
  const concurrency = Math.max(1, Number(arg('concurrency') ?? 1));
  const dumpText = process.argv.includes('--dump-text');
  const outPath =
    arg('out') ??
    path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      'docs/specs/_root/0005-aws-genai-integration/ac-g9-corpus-run.json',
    );

  let profiles = CORPUS;
  if (only) profiles = profiles.filter((p) => p.id === only);
  if (Number.isFinite(limit)) profiles = profiles.slice(0, limit);

  if (profiles.length === 0) {
    console.error(`❌ no profiles matched (--only ${only ?? ''})`);
    process.exit(1);
  }

  installLogCapture();
  const service = new BetaService(
    prismaStub,
    new AnthropicService(),
    usageStub,
  );

  console.log(
    `Running ${profiles.length} profile(s) at mode=shadow, concurrency=${concurrency}\n`,
  );

  const results: ProfileResult[] = [];
  const queue = [...profiles];
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const profile = queue.shift();
      if (!profile) return;
      try {
        const result = await runProfile(service, profile, dumpText);
        results.push(result);
        const mark = !result.reachedGuard
          ? '·'
          : result.firings.length === 0
            ? '✅'
            : '🚨';
        console.log(
          `${mark} ${result.id.padEnd(26)} ${result.terminatedBy.padEnd(9)} ` +
            `${result.planChars} chars` +
            (result.firings.length
              ? `  FIRED: ${result.firings.map((f) => `${f.rule}/${f.source}`).join(', ')}`
              : '') +
            (result.pipelineError ? `  ${result.pipelineError}` : ''),
        );
      } catch (error) {
        console.log(`💥 ${profile.id} threw: ${String(error)}`);
        results.push({
          id: profile.id,
          tags: profile.tags,
          reachedGuard: false,
          terminatedBy: 'error',
          firings: [],
          calls: [],
          planChars: 0,
        });
      }
    }
  });
  await Promise.all(workers);

  const reached = results.filter((r) => r.reachedGuard);
  const fired = results.filter((r) => r.firings.length > 0);
  const coachCalls = results
    .flatMap((r) => r.calls)
    .filter((c) => c.agent === 'coach' && c.outcome === 'ok')
    .map((c) => c.durationMs)
    .sort((a, b) => a - b);

  const percentile = (p: number): number =>
    coachCalls.length === 0
      ? 0
      : coachCalls[Math.min(coachCalls.length - 1, Math.floor((p / 100) * coachCalls.length))];

  console.log('\n──────── AC-G9 ────────');
  console.log(`profiles run:        ${results.length}`);
  console.log(`reached the guard:   ${reached.length}  (AC-G9 needs >= 30)`);
  console.log(`guard firings:       ${fired.length}    (AC-G9 needs 0)`);
  if (fired.length) {
    console.log('\nFirings — each one blocks `enforce` until the rule is tuned:');
    for (const r of fired) {
      for (const f of r.firings) {
        console.log(`  ${r.id}  rule=${f.rule}  source=${f.source}  tags=[${r.tags.join(',')}]`);
      }
    }
  }
  const broke = results.filter((r) => r.terminatedBy === 'pipeline_error');
  if (broke.length) {
    console.log(
      `\nPipeline errors (${broke.length}) — visitor sees FRIENDLY_ERROR_MESSAGE and no plan:`,
    );
    for (const r of broke) console.log(`  ${r.id}  ${r.pipelineError}`);
  }
  const screened = results.filter(
    (r) => r.terminatedBy === 'red_flag' || r.terminatedBy === 'refusal',
  );
  if (screened.length) {
    console.log(`\nScreened out before the guard (${screened.length}):`);
    for (const r of screened)
      console.log(`  ${r.id.padEnd(28)} ${r.terminatedBy}  tags=[${r.tags.join(',')}]`);
  }
  console.log('\n──────── coach durationMs (the buffering question) ────────');
  console.log(
    coachCalls.length
      ? `n=${coachCalls.length}  min=${coachCalls[0]}  p50=${percentile(50)}  p90=${percentile(90)}  max=${coachCalls[coachCalls.length - 1]}`
      : 'no successful coach calls',
  );

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    `${JSON.stringify(
      { mode: 'shadow', profiles: results.length, reachedGuard: reached.length, firings: fired.length, coachDurationMs: coachCalls, counters, results },
      null,
      2,
    )}\n`,
  );
  console.log(`\nWrote ${outPath}`);

  // A --limit/--only run cannot reach 30 by construction, so reporting it as
  // "AC-G9 not satisfied" would read as a corpus failure rather than a partial
  // run. Only a full run gets to render a verdict on the AC.
  const partial = profiles.length < CORPUS.length;
  if (partial) {
    console.log(
      `\n◐ Partial run (${profiles.length}/${CORPUS.length}) — AC-G9 verdict not applicable.` +
        (fired.length ? ' Firings above still need tuning.' : ' No firings in this slice.'),
    );
    process.exit(fired.length === 0 ? 0 : 1);
  }
  const pass = reached.length >= 30 && fired.length === 0;
  console.log(
    pass
      ? '\n✅ AC-G9 satisfied — enforce is unblocked on this evidence.'
      : '\n❌ AC-G9 NOT satisfied — do not flip to enforce.',
  );
  process.exit(pass ? 0 : 1);
}

void main();
