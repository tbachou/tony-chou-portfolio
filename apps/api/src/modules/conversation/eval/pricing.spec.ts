import { estimateCostUsd, PRICE_TABLE } from './pricing';

describe('estimateCostUsd', () => {
  it('prices tokens per model from the table', () => {
    const cost = estimateCostUsd({
      'claude-sonnet-5': { inputTokens: 1_000_000, outputTokens: 500_000 },
      'claude-haiku-4-5': { inputTokens: 2_000_000, outputTokens: 0 },
    });
    // sonnet-5: 1M in at $2 + 0.5M out at $10 = $7; haiku: 2M in at $1 = $2
    expect(cost).toBeCloseTo(9);
  });

  it('returns null when a model with spend is missing from the table', () => {
    const cost = estimateCostUsd({
      'us.anthropic.claude-sonnet-4-6-something': {
        inputTokens: 1000,
        outputTokens: 1000,
      },
    });
    expect(cost).toBeNull();
  });

  it('ignores unknown models with zero tokens', () => {
    const cost = estimateCostUsd({
      'unknown-model': { inputTokens: 0, outputTokens: 0 },
      'claude-haiku-4-5': { inputTokens: 1_000_000, outputTokens: 0 },
    });
    expect(cost).toBeCloseTo(1);
  });

  it('covers the models this suite actually uses', () => {
    expect(PRICE_TABLE['claude-sonnet-5']).toBeDefined();
    expect(PRICE_TABLE['claude-haiku-4-5']).toBeDefined();
  });
});
