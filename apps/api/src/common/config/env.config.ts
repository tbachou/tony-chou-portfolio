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
 * nothing else — `validateEnv` iterates this object, so registration and
 * boot coverage cannot drift apart.
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
 * Why positive integers only, rather than "anything Number() accepts":
 * every one of these bounds a count compared with `>=`. Zero would reject
 * the first request of the day, a negative would reject every request, and
 * a fraction would round-trip through the database columns (all Int) as
 * something other than what was configured. None of those is a value
 * anyone means to deploy, so all three are refused at boot instead of
 * discovered in production.
 */
function parseNumericEnv(raw: string): number | null {
  // Number('') and Number('  ') are both 0, which would slip past a NaN
  // check and then read as a deliberate zero. Reject blanks explicitly.
  if (raw.trim() === '') return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
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

  const value = parseNumericEnv(raw);
  if (value === null) {
    throw new Error(
      `${name} must be a positive integer, got ${JSON.stringify(raw)}`,
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
