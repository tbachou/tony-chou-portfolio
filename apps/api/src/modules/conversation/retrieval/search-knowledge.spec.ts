import type { MockedFunction } from 'vitest';
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
} from './search-knowledge.js';
import { search, searchCandidates, type ScoredChunk } from './vector-store.js';
import { rerankCandidates, RETRIEVAL_RERANK_MODE_ENV } from './reranker.js';
import { StoryOwnership } from '../../../generated/prisma/enums.js';
import type { StoryModel } from '../../../generated/prisma/models.js';

// The real module is kept for the pure helpers (`cosineSelection`, `TOP_K`,
// `MINIMUM_SIMILARITY`): the cosine path is the thing the fall back promises
// to reproduce, so a test that stubbed it would prove nothing.
vi.mock('./vector-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./vector-store.js')>()),
  search: vi.fn(),
  searchCandidates: vi.fn(),
}));

// `rerankModeFromEnv` stays real and is driven by the environment variable,
// which is the thing under test in the mode cases below.
vi.mock('./reranker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reranker.js')>()),
  rerankCandidates: vi.fn(),
}));

const searchMock = search as MockedFunction<typeof search>;
const searchCandidatesMock = searchCandidates as MockedFunction<typeof searchCandidates>;
const rerankMock = rerankCandidates as MockedFunction<typeof rerankCandidates>;

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
  openIndex = vi.fn(() => ({}) as never),
  storyOverride: StoryModel = story,
) {
  const onFailure = vi.fn();
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
      'Error: getaddrinfo ENOTFOUND upstash',
    );
  });

  it('degrades when the credentials are missing rather than failing turn setup', async () => {
    const openIndex = vi.fn(() => {
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
    const onFailure = vi.fn();
    const { execute, stats } = createSearchKnowledgeExecutor({
      openIndex: vi.fn(() => ({}) as never),
      story,
      onFailure,
      failLoudly: true,
    });

    // An eval run must never quietly become a non retrieval run and report
    // scores as though nothing changed. Production does the opposite (AC-8),
    // which the test above pins.
    await expect(execute(call())).rejects.toThrow(/upstream 503/);
    expect(stats.failures).toBe(1);
    expect(onFailure).toHaveBeenCalledWith('Error: upstream 503');
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

  describe('what a failure reports', () => {
    async function causeOf(error: unknown): Promise<string> {
      searchMock.mockRejectedValueOnce(error);
      const { execute, onFailure } = makeExecutor();
      await execute(call());
      return (onFailure.mock.calls[0] as [string])[0];
    }

    it('names the error type as well as the message', async () => {
      // No judgement about whose fault it is: three versions of a classifier
      // here were each wrong in a different direction. The type and message
      // are more useful than a wrong level and cannot be wrong.
      expect(await causeOf(new TypeError('fetch failed'))).toBe(
        'TypeError: fetch failed',
      );
      // The mid-response disconnect that the last classifier called our bug.
      expect(await causeOf(new TypeError('terminated'))).toBe(
        'TypeError: terminated',
      );
      expect(
        await causeOf(new SyntaxError('Unexpected token < is not valid JSON')),
      ).toBe('SyntaxError: Unexpected token < is not valid JSON');
      expect(await causeOf(new Error('Forbidden'))).toBe('Error: Forbidden');
    });

    it('survives a thrown non-error', async () => {
      expect(await causeOf('just a string')).toBe('unknown retrieval error');
    });
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

  it('survives a tool_use block that carries no name at all', async () => {
    // isToolUse gates only on the block type, so a nameless tool_use reaches
    // the executor as undefined. Calling .replace on it threw from inside the
    // executor that must not throw, and the visitor lost the whole turn.
    const { execute, stats } = makeExecutor();

    const result = await execute({ name: undefined as unknown as string, input: {} });

    // The exact string, so dropping the fallback fails rather than passing on
    // "Unknown tool: undefined".
    expect(result).toBe('Unknown tool: unnamed');
    expect(stats.unknownTool).toBe(1);
  });

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a zero width format character', '\u200b'],
    ['a lone surrogate', '\uD83D'],
    ['undefined', undefined],
  ])('always names the tool, given %s', async (_label, name) => {
    const { execute, onFailure } = makeExecutor();

    // The fallback has to run AFTER normalisation. A name can be non empty and
    // still normalise to nothing, and falling back first caught only the
    // literal empty string, leaving the log line with no subject.
    await execute({ name: name as unknown as string, input: {} });

    expect(onFailure).toHaveBeenCalledWith('unknown tool requested: unnamed');
  });

  it('bounds and flattens the provider error text too', async () => {
    // Third party text: @upstash/vector throws the HTTP response body
    // verbatim, so its length and characters are not ours to trust. The tool
    // name was hardened and this was not, which was the inconsistency.
    const nasty = new Error('bad\u001b[2K\rWARN fake line');
    nasty.name = 'X'.repeat(10_000);
    searchMock.mockRejectedValueOnce(nasty);
    const { execute, onFailure } = makeExecutor();

    await execute(call());

    const [cause] = onFailure.mock.calls[0] as [string];
    expect(cause.length).toBeLessThanOrEqual(200);
    expect([...cause].some((c) => c.charCodeAt(0) < 0x20)).toBe(false);
  });

  it('strips control characters, not only whitespace', async () => {
    const { execute, onFailure } = makeExecutor();

    // \s matches neither ESC nor NUL, and an escape sequence in model derived
    // text can rewrite or hide a line in a terminal reading the logs.
    await execute({ name: 'a\u001b[31mRED\u001b[0m\u0000b', input: {} });

    const [cause] = onFailure.mock.calls[0] as [string];
    // Built from char codes rather than a literal control-character class,
    // which eslint's no-control-regex rejects for good reason.
    const controls = [...cause].some((c) => c.charCodeAt(0) < 0x20);
    expect(controls).toBe(false);
    expect(cause).toBe('unknown tool requested: a [31mRED [0m b');
  });

  it('drops a lone surrogate that arrived in the input', async () => {
    const { execute, onFailure } = makeExecutor();

    await execute({ name: '\uD83Dorphan', input: {} });

    const [cause] = onFailure.mock.calls[0] as [string];
    // Splitting by code point avoids CREATING one; it does not remove one
    // that was already there.
    expect(/[\uD800-\uDFFF]/.test(cause)).toBe(false);
  });

  it('flattens newlines in a tool name even when it is short', async () => {
    const { execute, onFailure } = makeExecutor();

    // Short on purpose. The previous version of this test used a 500 character
    // name, so the newline sat past the truncation point and `slice` removed
    // it: deleting the flatten entirely left the suite green. The flatten is
    // the log-injection defence, so it needs an input only it can handle.
    await execute({ name: 'search\nERROR fake log line', input: {} });

    const [cause] = onFailure.mock.calls[0] as [string];
    expect(cause).toBe('unknown tool requested: search ERROR fake log line');
  });

  it('truncates a long tool name at exactly 64 code points', async () => {
    const { execute, onFailure } = makeExecutor();

    await execute({ name: 'x'.repeat(200), input: {} });

    const [cause] = onFailure.mock.calls[0] as [string];
    expect(cause).toBe(`unknown tool requested: ${'x'.repeat(64)}`);
  });

  it('does not split an emoji across the truncation boundary', async () => {
    const { execute, onFailure } = makeExecutor();

    await execute({ name: `${'x'.repeat(63)}\u{1F525}tail`, input: {} });

    const [cause] = onFailure.mock.calls[0] as [string];
    // A lone surrogate reaching a log is a hazard this codebase already
    // guards against elsewhere.
    expect(cause).toContain('\u{1F525}');
    expect(/[\uD800-\uDFFF]/.test(cause.replace(/\u{1F525}/gu, ''))).toBe(false);
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

/**
 * Two stage retrieval (spec 0012 phase six).
 *
 * The mode is driven by the real `rerankModeFromEnv`, so these exercise the
 * switch a deployment actually flips.
 */
describe('retrieval reranking', () => {
  const scored = (sourcePath: string, score: number, text = 'body'): ScoredChunk => ({
    sourcePath,
    heading: 'Decision',
    text,
    score,
  });

  /** Two above the cosine floor, two only above the candidate floor. */
  const wide: ScoredChunk[] = [
    scored('top.md', 0.81),
    scored('second.md', 0.7),
    scored('below.md', 0.55),
    scored('lowest.md', 0.44),
  ];

  const rerankResult = (kept: ScoredChunk[], over: Partial<Awaited<ReturnType<typeof rerankCandidates>>> = {}) => ({
    kept,
    fellBack: false,
    inputTokens: 300,
    outputTokens: 0,
    durationMs: 42,
    ...over,
  });

  function makeRerankExecutor(storyOverride: StoryModel = story) {
    const onFailure = vi.fn();
    const onRerank = vi.fn();
    const { execute, stats } = createSearchKnowledgeExecutor({
      openIndex: vi.fn(() => ({}) as never),
      story: storyOverride,
      interviewerQuestion: 'How do you decide between two approaches?',
      onFailure,
      onRerank,
    });
    return { execute, stats, onFailure, onRerank };
  }

  /**
   * A first person present tense licensure claim, which the ownership guard
   * rejects. Borrowed from the suppression test above rather than invented,
   * because a chunk the guard does NOT actually reject would make every
   * assertion below pass for the wrong reason.
   */
  const GUARD_TRIPPING =
    'Note that "I\'m still a licensed OT" and "I\'m no longer a licensed OT" differ by one word.';

  beforeEach(() => {
    // The describe blocks above leave calls on the shared search mock, and
    // these tests assert on call counts.
    searchMock.mockClear();
    searchCandidatesMock.mockClear();
    rerankMock.mockClear();
  });

  afterEach(() => {
    delete process.env[RETRIEVAL_RERANK_MODE_ENV];
    rerankMock.mockReset();
    searchCandidatesMock.mockReset();
  });

  it('off issues no widened query and returns exactly what it returned before (AC-1, AC-5)', async () => {
    searchMock.mockResolvedValue([chunk('top.md'), chunk('second.md')]);
    const { execute, stats, onRerank } = makeRerankExecutor();

    const result = await execute(call());

    expect(searchCandidatesMock).not.toHaveBeenCalled();
    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(rerankMock).not.toHaveBeenCalled();
    expect(onRerank).not.toHaveBeenCalled();
    expect(result).toContain('top.md');
    expect(result).toContain('second.md');
    expect(stats.rerankInputTokens).toBe(0);
  });

  it('shadow returns the cosine selection while logging the reranked one (AC-5, AC-9)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'shadow';
    searchCandidatesMock.mockResolvedValue(wide);
    // The reranker prefers a chunk the cosine floor would have dropped.
    rerankMock.mockResolvedValue(rerankResult([scored('below.md', 0.55)]));
    const { execute, onRerank } = makeRerankExecutor();

    const result = await execute(call());

    // Shadow decides nothing: what reaches the model is the cosine selection.
    expect(result).toContain('top.md');
    expect(result).toContain('second.md');
    expect(result).not.toContain('below.md');
    // But the disagreement is countable from the log alone.
    expect(onRerank).toHaveBeenCalledTimes(1);
    expect(onRerank.mock.calls[0][0]).toMatchObject({
      mode: 'shadow',
      candidates: 4,
      kept: 1,
      fellBack: false,
      cosinePaths: ['top.md', 'second.md'],
      rerankedPaths: ['below.md'],
    });
  });

  it('enforce returns the reranked selection (AC-4, AC-5)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'enforce';
    searchCandidatesMock.mockResolvedValue(wide);
    rerankMock.mockResolvedValue(
      rerankResult([scored('below.md', 0.55), scored('top.md', 0.81)]),
    );
    const { execute, stats, onRerank } = makeRerankExecutor();

    const result = await execute(call());

    // In the reranker's order, not the index's.
    expect(result.indexOf('below.md')).toBeLessThan(result.indexOf('top.md'));
    expect(result).not.toContain('second.md');
    expect(stats.sourcePaths).toEqual(['below.md', 'top.md']);
    expect(stats.resultCounts).toEqual([2]);
    // Enforce logs counts, not the two path lists: there is no second
    // selection to disagree with once the reranker is deciding.
    expect(onRerank.mock.calls[0][0]).toMatchObject({ mode: 'enforce', kept: 2 });
    expect(onRerank.mock.calls[0][0]).not.toHaveProperty('cosinePaths');
  });

  it('never spends a judgement on a chunk the guard would reject (AC-2)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'enforce';
    searchCandidatesMock.mockResolvedValue([
      scored('guarded.md', 0.8, GUARD_TRIPPING),
      scored('fine.md', 0.75, 'The decision was recorded in a spec.'),
    ]);
    rerankMock.mockResolvedValue(rerankResult([scored('fine.md', 0.75)]));
    const { execute } = makeRerankExecutor();

    await execute(call());

    const passed = rerankMock.mock.calls[0][0].candidates;
    expect(passed.map((c) => c.sourcePath)).toEqual(['fine.md']);
  });

  it('threads what was actually asked, not only the persona paraphrase (AC-3)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'shadow';
    searchCandidatesMock.mockResolvedValue(wide);
    rerankMock.mockResolvedValue(rerankResult([]));
    const { execute } = makeRerankExecutor();

    await execute(call('decision records'));

    expect(rerankMock.mock.calls[0][0]).toMatchObject({
      interviewerQuestion: 'How do you decide between two approaches?',
      searchQuery: 'decision records',
    });
  });

  it('falls back to the cosine selection without a second query (AC-6)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'enforce';
    searchCandidatesMock.mockResolvedValue(wide);
    rerankMock.mockResolvedValue(
      rerankResult([], { fellBack: true, cause: 'APITimeoutError', inputTokens: 0 }),
    );
    const { execute, stats, onRerank } = makeRerankExecutor();

    const result = await execute(call());

    // The widened set is a superset of the narrow one, so the fall back costs
    // no round trip: one query was issued, not two.
    expect(searchCandidatesMock).toHaveBeenCalledTimes(1);
    expect(searchMock).not.toHaveBeenCalled();
    expect(result).toContain('top.md');
    expect(result).toContain('second.md');
    expect(stats.rerankFallbacks).toBe(1);
    expect(stats.failures).toBe(0);
    expect(onRerank.mock.calls[0][0]).toMatchObject({ fellBack: true, cause: 'APITimeoutError' });
  });

  it('tells the persona nothing matched when the reranker kept nothing (AC-4)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'enforce';
    searchCandidatesMock.mockResolvedValue(wide);
    rerankMock.mockResolvedValue(rerankResult([]));
    const { execute, stats } = makeRerankExecutor();

    // From the persona's side this is the "nothing to cite" case it already
    // handles, not a fourth model facing string.
    expect(await execute(call())).toBe(NO_MATCH_RESULT);
    expect(stats.allSuppressed).toBe(0);
  });

  it('records reranker tokens on the log line and nowhere else (AC-8)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'shadow';
    searchCandidatesMock.mockResolvedValue(wide);
    rerankMock.mockResolvedValue(rerankResult([scored('top.md', 0.81)]));
    const { execute, stats, onRerank } = makeRerankExecutor();

    await execute(call());

    expect(onRerank.mock.calls[0][0]).toMatchObject({ inputTokens: 300, outputTokens: 0 });
    expect(stats.rerankInputTokens).toBe(300);
    // Shadow decided nothing, so what reached the model is still the two
    // chunk cosine selection rather than the reranker's single pick.
    expect(stats.resultCounts).toEqual([2]);
  });

  it('keeps the query and the chunk text out of the log line (AC-9)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'shadow';
    const secret = 'a distinctive sentence from a committed document';
    searchCandidatesMock.mockResolvedValue([scored('top.md', 0.81, secret)]);
    rerankMock.mockResolvedValue(rerankResult([scored('top.md', 0.81, secret)]));
    const { execute, onRerank } = makeRerankExecutor();

    await execute(call('a query naming the visitor topic'));

    const line = JSON.stringify(onRerank.mock.calls[0][0]);
    expect(line).not.toContain(secret);
    expect(line).not.toContain('a query naming the visitor topic');
  });

  it('still separates nothing matched from everything withheld (AC-9)', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'shadow';
    // Cleared the cosine floor, then dropped by the guard.
    searchCandidatesMock.mockResolvedValue([
      scored('guarded.md', 0.8, GUARD_TRIPPING),
    ]);
    rerankMock.mockResolvedValue(rerankResult([]));
    const { execute, stats } = makeRerankExecutor();

    expect(await execute(call())).toBe(ALL_SUPPRESSED_RESULT);
    expect(stats.allSuppressed).toBe(1);
  });

  it('does not call the reranker when the guard withheld everything', async () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'enforce';
    searchCandidatesMock.mockResolvedValue([
      scored('guarded.md', 0.8, GUARD_TRIPPING),
    ]);
    const { execute } = makeRerankExecutor();

    await execute(call());

    expect(rerankMock).not.toHaveBeenCalled();
  });
});
