/**
 * Numeric environment variables, and the only sanctioned way to read one.
 *
 * `Number(process.env.X ?? fallback)` is the shape this file exists to
 * replace. A typo or an empty value makes it NaN, and every comparison
 * against NaN is false — so `count >= CAP` stops being a cap and the
 * variable that was supposed to bound the Anthropic bill silently removes
 * the bound instead. The failure is invisible: no error, no log, just an
 * uncapped spend path.
 *
 * So a bad value fails CLOSED here: `readNumericEnv` throws rather than
 * return NaN, and `validateEnv()` runs at boot (main.ts) so the process
 * refuses to start at all. A deploy that will not come up is recoverable;
 * a deploy that serves without a cap is not.
 *
 * Adding a numeric variable means adding it to NUMERIC_ENV_DEFAULTS and
 * giving it a ceiling in MAX_NUMERIC_ENV, which the compiler requires
 * because that Record is total over these keys. Nothing else: `validateEnv`
 * iterates this object, so registration and boot coverage cannot drift.
 */
export const NUMERIC_ENV_DEFAULTS = {
  /** Conversation turn pairs served per UTC day, across all visitors. */
  DAILY_TURN_CAP: 300,
  /** Model tokens billed per UTC day, across all visitors. */
  DAILY_TOKEN_CAP: 150_000,
  /** Turn pairs in a single conversation before it concludes. */
  TURN_PAIR_CAP: 5,
} as const;

export type NumericEnvName = keyof typeof NUMERIC_ENV_DEFAULTS;

/**
 * The largest value each variable may take. Per variable, because the
 * justification is not the same for all three — a single flat ceiling was
 * the first cut, and its stated reason was simply untrue for one of them.
 *
 * For the two daily counters the bound is physical: `turnCount` and
 * `tokenCount` are Prisma `Int` (prisma/schema.prisma), so Postgres int4.
 * A cap above int4 is not merely large, it is UNREACHABLE — the column
 * cannot hold a value satisfying `count >= cap`, so the comparison is
 * false forever. That is the same fail-open this file exists to prevent,
 * reached by an extra run of zeros instead of a typo. A pre-deploy gate
 * caught exactly that: `DAILY_TOKEN_CAP=1e21` passed the first cut of this
 * parser, because `Number.isInteger(1e21)` is true.
 *
 * TURN_PAIR_CAP has no such column, and since spec 0012 phase one no HTTP
 * bound either (history is rebuilt server side, so the request carries no
 * turn list to validate). It is the ONLY bound on conversation length, and
 * `formatHistory` concatenates every prior turn into the next prompt, so
 * the value directly sets how large a prompt can grow: measured at roughly
 * 10k prompt tokens at 100 turns and 100k at 1000. 100 is far above any
 * real interview and still bounds the overshoot of DAILY_TOKEN_CAP, which
 * is checked before a turn and never during it.
 *
 * Typed as a total Record so the compiler refuses a new variable added to
 * NUMERIC_ENV_DEFAULTS until it is given a ceiling here too.
 */
const MAX_NUMERIC_ENV: Record<NumericEnvName, number> = {
  DAILY_TURN_CAP: 2_147_483_647,
  DAILY_TOKEN_CAP: 2_147_483_647,
  TURN_PAIR_CAP: 100,
};

/**
 * Render a rejected value so an operator can see what is actually wrong
 * with it. `JSON.stringify` alone escapes quotes and newlines but leaves
 * zero-width and bidi characters invisible, so a value pasted out of a doc
 * would fail the boot with `got "300"` beside a message insisting 300 is
 * out of range — which reads as a broken validator rather than a bad
 * paste. Escaping runs AFTER stringify so its own backslashes are not
 * re-escaped.
 */
function describeValue(raw: string): string {
  return JSON.stringify(raw).replace(
    /[^\x20-\x7e]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * Why a digits-only grammar rather than "anything Number() accepts":
 * `Number()` is a coercion, not a parser, and it silently answers a
 * different question than the one asked. '0b1010' is ten rather than one
 * thousand and ten, '0x2710' is 10000, '1e21' is past every counter this
 * bounds, and '9007199254740993' is enforced as ...992. Each of those is a
 * cap that is not the number someone typed. Matching decimal digits first
 * means the only values that reach `Number()` are ones it cannot surprise
 * us on.
 *
 * Then positive and within this variable's own ceiling, because every one
 * of these bounds a count compared with `>=`. Zero would reject the first
 * request of the day, a negative would reject every request, and anything
 * above the ceiling would reject none. None is a value anyone means to
 * deploy, so all are refused at boot rather than discovered in production.
 */
function parseNumericEnv(name: NumericEnvName, raw: string): number | null {
  // Trimmed first, because a value pasted from a dashboard arrives with
  // surrounding whitespace (including U+00A0, which `trim` does handle).
  // A blank is rejected here too: `Number('')` is 0, which would otherwise
  // slip past as a deliberate zero.
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  if (value <= 0 || value > MAX_NUMERIC_ENV[name]) return null;
  return value;
}

/**
 * The configured value, or the default when the variable is unset.
 *
 * Read at the call site rather than captured in a module-level const: a
 * const freezes the value at import time, which is both untestable and
 * ordered before `validateEnv()` can report anything. The parse is a
 * `Number()` on a short string, which costs nothing next to the database
 * round trip every caller is already making.
 */
export function readNumericEnv(
  name: NumericEnvName,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (raw === undefined) return NUMERIC_ENV_DEFAULTS[name];

  const value = parseNumericEnv(name, raw);
  if (value === null) {
    throw new Error(
      `${name} must be a whole number between 1 and ` +
        `${MAX_NUMERIC_ENV[name]}, got ${describeValue(raw)}`,
    );
  }
  return value;
}

/**
 * Validate every numeric variable at once, for `main.ts` to call before the
 * Nest app is created.
 *
 * All of them, reported together, on purpose: failing on the first bad
 * value turns a config review into one redeploy per typo, and each of those
 * redeploys is several minutes of a service that is down.
 */
export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const problems: string[] = [];

  for (const name of Object.keys(NUMERIC_ENV_DEFAULTS) as NumericEnvName[]) {
    try {
      readNumericEnv(name, env);
    } catch (error) {
      problems.push(`  - ${(error as Error).message}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${problems.join('\n')}`,
    );
  }
}
