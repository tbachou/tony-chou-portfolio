import {
  CAP_REACHED_RESULT,
  createSearchKnowledgeExecutor,
  MAX_SEARCHES_PER_TURN,
  NO_MATCH_RESULT,
  SEARCH_KNOWLEDGE_TOOL,
  UNAVAILABLE_RESULT,
  ALL_SUPPRESSED_RESULT,
  NO_QUERY_RESULT,
  RETRIEVAL_STRICT_ENV,
  retrievalStrictFromEnv,
} from './search-knowledge';
import { search } from './vector-store';
import { StoryOwnership } from '../../../generated/prisma/enums';
import type { StoryModel } from '../../../generated/prisma/models';

jest.mock('./vector-store', () => ({
  search: jest.fn(),
}));

const searchMock = search as jest.MockedFunction<typeof search>;

const chunk = (sourcePath: string, text = 'body', heading = 'Decision') => ({
  sourcePath,
  heading,
  text,
});

/**
 * A solo, non Product Forge story, so the story dependent guard branches stay
 * quiet and a test that wants a clean pass gets one. The suppression tests
 * below pick a story deliberately.
 */
const story = {
  id: 'story-1',
  title: 'Portfolio rebuild',
  ownership: StoryOwnership.SOLO,
  engagement: 'Personal project',
  summary: 'Rebuilt the portfolio.',
  requiredFraming: null,
} as StoryModel;

function makeExecutor(
  openIndex = jest.fn(() => ({}) as never),
  storyOverride: StoryModel = story,
) {
  const onFailure = jest.fn();
  const { execute, stats } = createSearchKnowledgeExecutor({
    openIndex,
    story: storyOverride,
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
    expect(onFailure).toHaveBeenCalledWith(
      'getaddrinfo ENOTFOUND upstash',
      'network',
    );
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

    expect(await execute(call('   '))).toBe(NO_QUERY_RESULT);
    expect(await execute({ name: SEARCH_KNOWLEDGE_TOOL.name, input: {} })).toBe(
      NO_QUERY_RESULT,
    );
    expect(await execute({ name: SEARCH_KNOWLEDGE_TOOL.name, input: null })).toBe(
      NO_QUERY_RESULT,
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

  it('drops a chunk the persona could not quote without failing the guard', async () => {
    // The failing input from the adversarial pass on 2026-09-01: the credential
    // check spec quotes a licensure claim in order to discuss it, and it is the
    // top hit for the most obvious visitor question. Handed to the model, the
    // model quotes it as the tool description instructs, and the guard then
    // replaces the whole answer with scripted framing.
    searchMock.mockResolvedValue([
      chunk(
        'docs/specs/_root/0013-credential-check-second-layer.md',
        'Note that "I\'m still a licensed OT" and "I\'m no longer a licensed OT" differ by one word.',
      ),
      chunk('docs/specs/_root/0014-agent-skill-storage/index.md', 'Safe prose.'),
    ]);
    const { execute, stats } = makeExecutor();

    const result = await execute(call());

    expect(result).not.toContain('licensed OT');
    expect(result).toContain('0014-agent-skill-storage');
    expect(stats.suppressed).toBe(1);
    // Only what survived is reported as a source.
    expect(stats.sourcePaths).toEqual([
      'docs/specs/_root/0014-agent-skill-storage/index.md',
    ]);
    expect(stats.resultCounts).toEqual([1]);
  });

  it('applies the story dependent guard branches, not just the universal ones', async () => {
    const productForge = {
      ...story,
      engagement: 'Product Forge',
    } as StoryModel;
    searchMock.mockResolvedValue([
      chunk('docs/specs/_root/0006-grade-guesser-daily-game.md', 'Fixed cost of about $0.02 per day.'),
    ]);

    // Same chunk, two stories: dropped for Product Forge, kept otherwise.
    const forge = makeExecutor(undefined, productForge);
    // Everything found was withheld by the guard filter, which is now its own
    // result rather than being reported as "nothing matched".
    expect(await forge.execute(call())).toBe(ALL_SUPPRESSED_RESULT);
    expect(forge.stats.suppressed).toBe(1);

    const personal = makeExecutor();
    expect(await personal.execute(call())).toContain('0006-grade-guesser');
    expect(personal.stats.suppressed).toBe(0);
  });

  it('throws instead of degrading when the eval asks it to (AC-9)', async () => {
    searchMock.mockRejectedValue(new Error('upstream 503'));
    const onFailure = jest.fn();
    const { execute, stats } = createSearchKnowledgeExecutor({
      openIndex: jest.fn(() => ({}) as never),
      story,
      onFailure,
      failLoudly: true,
    });

    // An eval run must never quietly become a non retrieval run and report
    // scores as though nothing changed. Production does the opposite (AC-8),
    // which the test above pins.
    await expect(execute(call())).rejects.toThrow(/upstream 503/);
    expect(stats.failures).toBe(1);
    expect(onFailure).toHaveBeenCalledWith('upstream 503', 'network');
  });

  it('reads strict mode from the environment, defaulting to degrade', () => {
    const original = process.env[RETRIEVAL_STRICT_ENV];
    try {
      delete process.env[RETRIEVAL_STRICT_ENV];
      expect(retrievalStrictFromEnv()).toBe(false);
      process.env[RETRIEVAL_STRICT_ENV] = '1';
      expect(retrievalStrictFromEnv()).toBe(true);
      // Anything else is not strict: a half set variable must not silently
      // turn a production API into one that fails turns.
      process.env[RETRIEVAL_STRICT_ENV] = 'true';
      expect(retrievalStrictFromEnv()).toBe(false);
    } finally {
      if (original === undefined) delete process.env[RETRIEVAL_STRICT_ENV];
      else process.env[RETRIEVAL_STRICT_ENV] = original;
    }
  });

  it('distinguishes "nothing matched" from "everything was withheld"', async () => {
    const productForge = { ...story, engagement: 'Product Forge' } as StoryModel;
    searchMock.mockResolvedValue([
      chunk('docs/specs/_root/0006-grade-guesser-daily-game.md', 'It cost $0.02 per day.'),
    ]);
    const withheld = makeExecutor(undefined, productForge);

    expect(await withheld.execute(call())).toBe(ALL_SUPPRESSED_RESULT);
    expect(withheld.stats.allSuppressed).toBe(1);

    // Truly nothing matched is a different event with a different cause: a
    // corpus or threshold question rather than a guard question.
    searchMock.mockResolvedValue([]);
    const empty = makeExecutor();
    expect(await empty.execute(call())).toBe(NO_MATCH_RESULT);
    expect(empty.stats.allSuppressed).toBe(0);
  });

  it('counts the paths that used to skip every counter', async () => {
    const { execute, stats } = makeExecutor();

    await execute(call('   '));
    await execute({ name: 'deleteEverything', input: {} });

    // Without these the AC-13 log line was suppressed for exactly the turns
    // most worth seeing: the tool was called and did nothing.
    expect(stats.malformed).toBe(1);
    expect(stats.unknownTool).toBe(1);
  });

  it('classifies a fetch failure as network, not as a bug in our own code', async () => {
    // @upstash/vector uses fetch, and WHATWG fetch rejects with a TypeError on
    // every genuine network failure. Treating TypeError as "unexpected" made a
    // real outage log as our bug, which is exactly backwards.
    const fetchFailure = new TypeError('fetch failed');
    Object.defineProperty(fetchFailure, 'cause', {
      value: new Error('getaddrinfo ENOTFOUND'),
    });
    searchMock.mockRejectedValueOnce(fetchFailure);
    const outage = makeExecutor();

    await outage.execute(call());

    expect(outage.onFailure).toHaveBeenCalledWith('fetch failed', 'network');
  });

  it('tells the model a query was missing rather than that nothing matched', async () => {
    const { execute, stats } = makeExecutor();

    const result = await execute(call('   '));

    // "No matching sections were found" is false when nothing was searched:
    // the same conflation ALL_SUPPRESSED_RESULT was created to eliminate.
    expect(result).toBe(NO_QUERY_RESULT);
    expect(stats.malformed).toBe(1);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('bounds a model-supplied tool name before it reaches a log', async () => {
    const { execute, onFailure } = makeExecutor();

    await execute({ name: `evil${'x'.repeat(500)}\nsecond line`, input: {} });

    const [cause] = onFailure.mock.calls[0] as [string, string];
    expect(cause.length).toBeLessThan(120);
    expect(cause).not.toContain('\n');
  });

  it('separates a bug in our own code from an outage upstream', async () => {
    searchMock.mockRejectedValueOnce(new TypeError("Cannot read properties of null"));
    const bug = makeExecutor();
    await bug.execute(call());
    expect(bug.onFailure).toHaveBeenCalledWith(
      expect.stringContaining('Cannot read properties'),
      'unexpected',
    );

    searchMock.mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
    const outage = makeExecutor();
    await outage.execute(call());
    expect(outage.onFailure).toHaveBeenCalledWith(
      expect.stringContaining('ENOTFOUND'),
      'network',
    );
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
