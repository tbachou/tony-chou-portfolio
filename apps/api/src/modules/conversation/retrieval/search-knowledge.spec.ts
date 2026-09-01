import {
  CAP_REACHED_RESULT,
  createSearchKnowledgeExecutor,
  MAX_SEARCHES_PER_TURN,
  NO_MATCH_RESULT,
  SEARCH_KNOWLEDGE_TOOL,
  UNAVAILABLE_RESULT,
} from './search-knowledge';
import { search } from './vector-store';

jest.mock('./vector-store', () => ({
  search: jest.fn(),
}));

const searchMock = search as jest.MockedFunction<typeof search>;

const chunk = (sourcePath: string, text = 'body', heading = 'Decision') => ({
  sourcePath,
  heading,
  text,
});

function makeExecutor(openIndex = jest.fn(() => ({}) as never)) {
  const onFailure = jest.fn();
  const { execute, stats } = createSearchKnowledgeExecutor({
    openIndex,
    onFailure,
  });
  return { execute, stats, onFailure, openIndex };
}

const call = (query: unknown = 'how does Tony spec a decision') => ({
  name: SEARCH_KNOWLEDGE_TOOL.name,
  input: { query },
});

describe('createSearchKnowledgeExecutor', () => {
  beforeEach(() => {
    searchMock.mockReset();
  });

  it('returns the chunks with their source paths so the answer can attribute', async () => {
    searchMock.mockResolvedValue([
      chunk('docs/specs/_root/0011-interview-simulator-eval-suite/index.md'),
      chunk('docs/specs/_root/0014-agent-skill-storage/index.md'),
    ]);
    const { execute, stats } = makeExecutor();

    const result = await execute(call());

    // The path is what makes AC-6 attribution possible at all.
    expect(result).toContain(
      'docs/specs/_root/0011-interview-simulator-eval-suite/index.md',
    );
    expect(result).toContain('docs/specs/_root/0014-agent-skill-storage/index.md');
    expect(stats.calls).toBe(1);
    expect(stats.resultCounts).toEqual([2]);
    expect(stats.sourcePaths).toHaveLength(2);
  });

  it('caps searches per turn in code, and the turn continues normally', async () => {
    searchMock.mockResolvedValue([chunk('docs/a.md')]);
    const { execute, stats } = makeExecutor();

    for (let i = 0; i < MAX_SEARCHES_PER_TURN; i += 1) {
      await execute(call());
    }
    const overCap = await execute(call());

    expect(overCap).toBe(CAP_REACHED_RESULT);
    expect(searchMock).toHaveBeenCalledTimes(MAX_SEARCHES_PER_TURN);
    expect(stats.calls).toBe(MAX_SEARCHES_PER_TURN);
    expect(stats.capped).toBe(1);
    // A refusal is not a failure: AC-7 says the turn completes normally.
    expect(stats.failures).toBe(0);
  });

  it('gives each turn its own counter', async () => {
    searchMock.mockResolvedValue([chunk('docs/a.md')]);
    const first = makeExecutor();
    for (let i = 0; i < MAX_SEARCHES_PER_TURN; i += 1) await first.execute(call());
    expect(await first.execute(call())).toBe(CAP_REACHED_RESULT);

    // AC-7: nothing is persisted or carried across turns.
    const second = makeExecutor();
    expect(await second.execute(call())).not.toBe(CAP_REACHED_RESULT);
  });

  it('degrades instead of throwing when the index is unreachable (AC-8)', async () => {
    searchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND upstash'));
    const { execute, stats, onFailure } = makeExecutor();

    const result = await execute(call());

    // A throw here would abort the whole generation and fail the turn, which
    // is exactly what AC-8 forbids.
    expect(result).toBe(UNAVAILABLE_RESULT);
    expect(stats.failures).toBe(1);
    expect(onFailure).toHaveBeenCalledWith('getaddrinfo ENOTFOUND upstash');
  });

  it('degrades when the credentials are missing rather than failing turn setup', async () => {
    const openIndex = jest.fn(() => {
      throw new Error('UPSTASH_VECTOR_REST_URL is not set');
    });
    const { execute, stats } = makeExecutor(openIndex as never);

    const result = await execute(call());

    // An API deployed without Upstash configuration answers every question
    // from the story instead of failing every turn.
    expect(result).toBe(UNAVAILABLE_RESULT);
    expect(stats.failures).toBe(1);
  });

  it('opens the index once and reuses it across calls in a turn', async () => {
    searchMock.mockResolvedValue([]);
    const { execute, openIndex } = makeExecutor();

    await execute(call());
    await execute(call());

    expect(openIndex).toHaveBeenCalledTimes(1);
  });

  it('reports no match as a normal outcome, not a failure', async () => {
    searchMock.mockResolvedValue([]);
    const { execute, stats } = makeExecutor();

    const result = await execute(call());

    expect(result).toBe(NO_MATCH_RESULT);
    expect(stats.failures).toBe(0);
    expect(stats.resultCounts).toEqual([0]);
  });

  it('does not spend a search on a missing or empty query', async () => {
    const { execute, stats, onFailure } = makeExecutor();

    expect(await execute(call('   '))).toBe(NO_MATCH_RESULT);
    expect(await execute({ name: SEARCH_KNOWLEDGE_TOOL.name, input: {} })).toBe(
      NO_MATCH_RESULT,
    );
    expect(await execute({ name: SEARCH_KNOWLEDGE_TOOL.name, input: null })).toBe(
      NO_MATCH_RESULT,
    );

    // An empty string embeds to a meaningless vector, so it is refused before
    // it reaches the index rather than counted as a search.
    expect(searchMock).not.toHaveBeenCalled();
    expect(stats.calls).toBe(0);
    expect(onFailure).toHaveBeenCalledTimes(3);
  });

  it('refuses a tool it never offered without throwing', async () => {
    const { execute, stats } = makeExecutor();

    const result = await execute({ name: 'deleteEverything', input: {} });

    expect(result).toContain('Unknown tool');
    expect(searchMock).not.toHaveBeenCalled();
    expect(stats.calls).toBe(0);
  });

  it('never puts the query text in anything it reports (AC-13)', async () => {
    const secret = 'a-visitor-phrase-that-must-not-be-logged';
    searchMock.mockRejectedValue(new Error('upstream 500'));
    const { execute, stats, onFailure } = makeExecutor();

    await execute(call(secret));

    // The log line is built from `stats` plus the onFailure cause, so proving
    // the query is absent from both proves it cannot reach a log.
    const reported = JSON.stringify({
      stats,
      failures: onFailure.mock.calls,
    });
    expect(reported).not.toContain(secret);
  });

  it('times failures as well as successes', async () => {
    searchMock.mockResolvedValueOnce([chunk('docs/a.md')]);
    searchMock.mockRejectedValueOnce(new Error('boom'));
    const { execute, stats } = makeExecutor();

    await execute(call());
    await execute(call());

    // A failure that took ten seconds and one that failed instantly are
    // different problems, so both are timed.
    expect(stats.latenciesMs).toHaveLength(2);
    for (const latency of stats.latenciesMs) {
      expect(typeof latency).toBe('number');
      expect(latency).toBeGreaterThanOrEqual(0);
    }
  });
});
