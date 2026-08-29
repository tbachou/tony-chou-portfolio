import type { TokenTotals } from './eval-types';

/**
 * USD per 1M tokens, from the Anthropic first party price list as of
 * 2026-08-29. Bedrock model ids are deliberately absent: Bedrock is partner
 * priced, and an unknown model prices the whole run as `null` rather than
 * wrong (AC-6).
 */
export const PRICE_TABLE: Record<
  string,
  { inputPer1M: number; outputPer1M: number }
> = {
  'claude-sonnet-5': { inputPer1M: 2, outputPer1M: 10 },
  'claude-sonnet-4-6': { inputPer1M: 3, outputPer1M: 15 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5 },
};

/**
 * Prices a run's per model token totals. Returns null when any model that
 * actually consumed tokens is missing from the table, so a partial price
 * never masquerades as the real cost.
 */
export function estimateCostUsd(
  tokensByModel: Record<string, TokenTotals>,
): number | null {
  let total = 0;
  for (const [model, tokens] of Object.entries(tokensByModel)) {
    if (tokens.inputTokens === 0 && tokens.outputTokens === 0) continue;
    const price = PRICE_TABLE[model];
    if (!price) return null;
    total +=
      (tokens.inputTokens / 1_000_000) * price.inputPer1M +
      (tokens.outputTokens / 1_000_000) * price.outputPer1M;
  }
  return total;
}
