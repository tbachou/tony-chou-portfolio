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
import { DRAFTER_MODEL } from '../src/modules/beta/beta.constants';
import type {
  AiProvider,
  ForceToolCallParams,
  ForceToolCallResult,
  StreamMessageParams,
  StreamMessageResult,
  RunToolConversationParams,
  RunToolConversationResult,
  UpstreamErrorClassification,
} from '../src/modules/anthropic/ai-provider.interface';
import { CORPUS, type CorpusProfile } from './beta-guard-corpus.profiles';

/**
 * Wraps the real provider so the screener and drafter can be recorded once
 * and replayed, while the coach still hits the live model every time.
 *
 * Rule calibration samples COACH variance — R8 compares the coach's paraphrase
 * against the drafter's caution, R2 catches full crimp the coach introduced —
 * but a full profile spends most of its tokens on the drafter (Sonnet 5,
 * ~2.5k output) to produce a plan that could simply be held fixed. Replaying
 * it drops a sampling run from roughly $0.048 to $0.008.
 *
 * It wraps the provider rather than reimplementing the calls, so the coach's
 * prompt, the guard call site and the section splitting are all still the
 * production ones. Reimplementing would drift: `buildVisitorProfile` is
 * module-private to beta.service.ts and could not be reused.
 */
type ProviderCache = { screener?: ForceToolCallResult; drafter?: ForceToolCallResult };

class CachingProvider implements AiProvider {
  constructor(
    private readonly real: AiProvider,
    private readonly cache: ProviderCache,
    private readonly mode: 'live' | 'record' | 'replay',
  ) {}

  // The drafted plan is written into the per-run AsyncLocalStorage store, not
  // a field on this provider. A single field is clobbered the moment two
  // profiles run concurrently: the first full --concurrency 3 run captured
  // only 15 plans out of 29, and recorded `null` for a profile whose firing
  // proved its caution was non-empty.

  /**
   * Beta makes no tool loop calls, so there is nothing to cache here. It is
   * delegated rather than thrown so that this wrapper stays a faithful
   * `AiProvider`: a stub that throws would turn a future Beta change into a
   * corpus run that fails for a reason that has nothing to do with Beta.
   */
  runToolConversation(
    params: RunToolConversationParams,
  ): Promise<RunToolConversationResult> {
    return this.real.runToolConversation(params);
  }

  async forceToolCall(params: ForceToolCallParams): Promise<ForceToolCallResult> {
    const role = params.model === DRAFTER_MODEL ? 'drafter' : 'screener';
    const cached = this.cache[role];
    if (this.mode === 'replay' && cached) {
      if (role === 'drafter') {
        const store = runStore.getStore();
        if (store) store.drafterInput = cached.input;
      }
      return cached;
    }
    const result = await this.real.forceToolCall(params);
    if (role === 'drafter') {
      const store = runStore.getStore();
      if (store) store.drafterInput = result.input;
    }
    if (this.mode === 'record') this.cache[role] = result;
    return result;
  }

  /** Always live: the coach is the output under test. */
  streamMessage(params: StreamMessageParams): Promise<StreamMessageResult> {
    return this.real.streamMessage(params);
  }

  classifyUpstreamError(error: unknown): UpstreamErrorClassification | null {
    return this.real.classifyUpstreamError(error);
  }
}

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
  /** The drafter's plan object, so an R8 firing names its own cause. */
  draftedPlan?: unknown;
  /** Pulled out of the plan: the field R8's presence and carry checks read. */
  overallCaution?: string | null;
};

/**
 * Captures the structured lines BetaService already emits, attributed to the
 * profile that produced them. AsyncLocalStorage rather than slicing a shared
 * array by index: with --concurrency > 1 several profiles interleave their
 * log writes, and index ranges would mix one profile's firings into another's.
 */
type RunStore = {
  lines: { level: string; message: string }[];
  drafterInput: unknown;
};
const runStore = new AsyncLocalStorage<RunStore>();

function installLogCapture(): void {
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = Logger.prototype[level];
    Logger.prototype[level] = function patched(
      this: Logger,
      message: unknown,
      ...rest: unknown[]
    ) {
      runStore.getStore()?.lines.push({ level, message: String(message) });
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
  _provider: CachingProvider,
  label = profile.id,
): Promise<ProfileResult> {
  const store: RunStore = { lines: [], drafterInput: null };
  const lines = store.lines;
  let planText = '';
  // Held on an object: the assignments below happen inside a callback, and
  // control-flow narrowing on a plain `let` would type it as 'unknown' here.
  const state: { terminatedBy: ProfileResult['terminatedBy'] } = {
    terminatedBy: 'unknown',
  };

  await runStore.run(store, () =>
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

  const drafted = store.drafterInput as { overallCaution?: string } | null;

  return {
    id: label,
    tags: profile.tags,
    reachedGuard: state.terminatedBy === 'plan',
    terminatedBy: state.terminatedBy,
    firings,
    calls,
    planChars: planText.length,
    ...(failure ? { pipelineError: failure.message } : {}),
    ...(dumpText ? { planText } : {}),
    ...(drafted
      ? { draftedPlan: drafted, overallCaution: drafted.overallCaution ?? null }
      : {}),
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
    // Defaults OUTSIDE version control. With --dump-text a run holds several
    // thousand words of model prose per profile, and a default that wrote into
    // the repo is one `git add -A` away from committing all of it. Pass --out
    // explicitly to place an artifact you actually mean to keep.
    path.resolve(__dirname, '..', '.corpus', 'ac-g9-corpus-run.json');

  let profiles = CORPUS;
  if (only) profiles = profiles.filter((p) => p.id === only);
  if (Number.isFinite(limit)) profiles = profiles.slice(0, limit);

  if (profiles.length === 0) {
    console.error(`❌ no profiles matched (--only ${only ?? ''})`);
    process.exit(1);
  }

  const recordPath = arg('record');
  const replayPath = arg('replay');
  const repeat = Math.max(1, Number(arg('repeat') ?? 1));
  const rescreen = Math.max(0, Number(arg('rescreen') ?? 2));
  if (recordPath && replayPath) {
    console.error('❌ --record and --replay are mutually exclusive');
    process.exit(1);
  }
  const cache: ProviderCache = replayPath
    ? (JSON.parse(fs.readFileSync(replayPath, 'utf8')) as ProviderCache)
    : {};
  const providerMode = recordPath ? 'record' : replayPath ? 'replay' : 'live';
  if (providerMode === 'replay' && !cache.drafter) {
    console.error(`❌ ${replayPath} holds no drafter result to replay`);
    process.exit(1);
  }

  installLogCapture();
  const provider = new CachingProvider(
    new AnthropicService(),
    cache,
    providerMode,
  );
  const service = new BetaService(
    prismaStub,
    provider as unknown as AnthropicService,
    usageStub,
  );

  console.log(
    `Running ${profiles.length} profile(s) at mode=shadow, concurrency=${concurrency}\n`,
  );

  const results: ProfileResult[] = [];
  const queue: { profile: CorpusProfile; label: string }[] = profiles.flatMap(
    (profile) =>
      Array.from({ length: repeat }, (_, i) => ({
        profile,
        label: repeat > 1 ? `${profile.id}#${i + 1}` : profile.id,
      })),
  );
  const workers = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const { profile, label } = item;
      try {
        // The screener is a model and its borderline verdicts vary run to
        // run — the same profile passed 3/3 in one session and was
        // red-flagged in the next. A screened-out run proves nothing about
        // the guard, so re-attempt it a bounded number of times (AC-G9 as
        // amended: sampling a stochastic gate, not weakening it). Red flags
        // are re-attempted too: only firings and reached-counts feed the
        // verdict, so a flaky pass here cannot mask anything.
        let result = await runProfile(service, profile, dumpText, provider, label);
        for (
          let attempt = 0;
          attempt < rescreen &&
          (result.terminatedBy === 'red_flag' || result.terminatedBy === 'refusal');
          attempt += 1
        ) {
          console.log(
            `  ↻ ${label} screened out (${result.terminatedBy}); re-attempting`,
          );
          result = await runProfile(service, profile, dumpText, provider, label);
        }
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
        console.log(`💥 ${label} threw: ${String(error)}`);
        results.push({
          id: label,
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

  if (recordPath) {
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, `${JSON.stringify(cache, null, 2)}\n`);
    console.log(`\nRecorded screener + drafter to ${recordPath}`);
  }

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
  const partial = profiles.length < CORPUS.length || repeat > 1 || providerMode === 'replay';
  if (partial) {
    console.log(
      `\n◐ Partial run (${profiles.length}/${CORPUS.length}${repeat > 1 ? ` x${repeat}` : ''}` +
        `${providerMode === 'replay' ? ', replayed plan' : ''}) — AC-G9 verdict not applicable.` +
        (fired.length ? ' Firings above still need tuning.' : ' No firings in this slice.'),
    );
    process.exit(fired.length === 0 ? 0 : 1);
  }
  // AC-G9 as amended (2026-08-20): coverage counts only runs that reached
  // the guard, reported per required category; firings do not fail the run
  // by existing — they fail it by being undiagnosed. A false positive blocks
  // enforce until the rule is fixed; a true positive (the model violated its
  // own skill file and the guard caught it) is the evidence enforce exists
  // to act on, and feeds the skill file. Diagnosis is a human step — this
  // harness reports, it does not classify.
  const REQUIRED_CATEGORIES = [
    'blunt-injury-description',
    'profanity',
    'constant-pain-wording',
  ];
  console.log('\ncoverage per required category (runs reaching the guard):');
  let uncovered = 0;
  for (const cat of REQUIRED_CATEGORIES) {
    const n = reached.filter((r) => r.tags.includes(cat)).length;
    if (n === 0) uncovered += 1;
    console.log(`  ${cat.padEnd(26)} ${n}${n === 0 ? '  ⚠ UNCOVERED — its rules are untested where enforce would first meet them' : ''}`);
  }

  const coverageOk = reached.length >= 30 && uncovered === 0;
  if (coverageOk && fired.length === 0) {
    console.log('\n✅ AC-G9 satisfied — coverage met, zero firings, nothing to diagnose.');
    process.exit(0);
  }
  if (!coverageOk) {
    console.log(
      `\n❌ Coverage not met (${reached.length}/30 reached${uncovered ? `, ${uncovered} required categor${uncovered === 1 ? 'y' : 'ies'} uncovered` : ''}) — enlarge or re-run the corpus.`,
    );
  }
  if (fired.length > 0) {
    console.log(
      `\n◆ ${fired.length} firing(s) need DIAGNOSIS before enforce (run \`npm run judge\` against this output, then read both):`,
    );
    console.log('    false positive -> blocks enforce until the rule is fixed');
    console.log('    true positive  -> does not block; feed it back into the skill file');
  }
  process.exit(1);
}

void main();
