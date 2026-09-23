import { createServer, type Server } from 'node:http';
import { APITimeoutError } from '@typesafe-ai/sdk';
import {
  RERANK_KEEP_THRESHOLD,
  RERANK_MODEL_ID,
  RERANK_TIMEOUT_MS,
  RETRIEVAL_RERANK_MODE_ENV,
  isRerankConfigured,
  rerankCandidates,
  rerankModeFromEnv,
  setRerankClient,
  type SystemOneCaller,
} from './reranker.js';
import type { ScoredChunk } from './vector-store.js';

/**
 * The reranker in isolation (spec 0012 phase six).
 *
 * Fully mocked: the fake caller stands in for the provider, so nothing here
 * touches the network or spends anything.
 */

const candidate = (sourcePath: string, score: number, text = `body of ${sourcePath}`): ScoredChunk => ({
  sourcePath,
  heading: 'Decision',
  text,
  score,
});

/** The shape this module actually sends, so the assertions need no casts. */
type SentRequest = {
  state: { interviewerQuestion: string; searchQuery: string };
  questions: Record<string, { instructions: { task: string; section: string } }>;
  model: string;
};
type SentOptions = { timeout: number; retry: { maxRetries: number } };
type SentResult = {
  model: string;
  answers: Record<string, { type: string; noul: number }>;
  usage: { input_tokens: number; output_tokens: number };
};

/** A caller that answers each question with the probability it is given. */
function fakeCaller(probabilities: number[], usage = { input_tokens: 120, output_tokens: 0 }) {
  // Typed on the mock rather than the implementation, so the recorded call
  // tuple carries the options argument the assertions read.
  const systemOne = vi.fn<(request: SentRequest, options?: SentOptions) => Promise<SentResult>>(
    (request) => {
      const answers = Object.fromEntries(
        Object.keys(request.questions).map((key, i) => [
          key,
          { type: 'noul', noul: probabilities[i] },
        ]),
      );
      return Promise.resolve({ model: RERANK_MODEL_ID, answers, usage });
    },
  );
  return { caller: { systemOne } as unknown as SystemOneCaller, systemOne };
}

/** A caller that rejects, for the fail open paths. */
function failingCaller(error: unknown) {
  const systemOne = vi.fn(() => Promise.reject(error));
  return { caller: { systemOne } as unknown as SystemOneCaller, systemOne };
}

describe('rerankModeFromEnv', () => {
  afterEach(() => {
    delete process.env[RETRIEVAL_RERANK_MODE_ENV];
  });

  it('defaults to off when unset, so merging the code changes nothing (AC-5)', () => {
    expect(rerankModeFromEnv()).toBe('off');
  });

  it('reads shadow and enforce', () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'shadow';
    expect(rerankModeFromEnv()).toBe('shadow');
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'enforce';
    expect(rerankModeFromEnv()).toBe('enforce');
  });

  it('reads an unrecognised value as off rather than throwing', () => {
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'ENFORCE';
    expect(rerankModeFromEnv()).toBe('off');
    process.env[RETRIEVAL_RERANK_MODE_ENV] = 'on';
    expect(rerankModeFromEnv()).toBe('off');
  });
});

describe('isRerankConfigured', () => {
  const saved = process.env.TYPESAFE_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  });

  it('is false without a key and true with one', () => {
    delete process.env.TYPESAFE_API_KEY;
    expect(isRerankConfigured()).toBe(false);
    process.env.TYPESAFE_API_KEY = 'ts-test-key';
    expect(isRerankConfigured()).toBe(true);
  });
});

describe('rerankCandidates', () => {
  it('sends one question per candidate in one request, over one shared state (AC-3)', async () => {
    const candidates = [candidate('a.md', 0.8), candidate('b.md', 0.7), candidate('c.md', 0.5)];
    const { caller, systemOne } = fakeCaller([0.9, 0.8, 0.7]);

    await rerankCandidates({
      candidates,
      interviewerQuestion: 'How do you decide between two approaches?',
      searchQuery: 'decision records',
      caller,
    });

    expect(systemOne).toHaveBeenCalledTimes(1);
    const [request] = systemOne.mock.calls[0];
    expect(Object.keys(request.questions)).toHaveLength(3);
    // The shared state carries the question AND the persona's paraphrase,
    // because a search query can drift from what was actually asked.
    expect(request.state).toEqual({
      interviewerQuestion: 'How do you decide between two approaches?',
      searchQuery: 'decision records',
    });
    // The section cannot live in the shared state, which is shared by
    // definition and would then be the same for every candidate.
    const sections = Object.values(request.questions).map((q) => q.instructions.section);
    expect(sections).toEqual(candidates.map((c) => c.text));
  });

  it('pins an explicit dated model id rather than a moving alias (AC-7)', async () => {
    const { caller, systemOne } = fakeCaller([0.9]);
    await rerankCandidates({
      candidates: [candidate('a.md', 0.8)],
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });
    const [request] = systemOne.mock.calls[0];
    expect(request.model).toBe(RERANK_MODEL_ID);
    expect(RERANK_MODEL_ID).toMatch(/^jev-\d+\.\d+\.\d+$/);
    expect(RERANK_MODEL_ID).not.toContain('latest');
  });

  it('bounds the request and disables retries, so the budget is what it says (AC-6)', async () => {
    const { caller, systemOne } = fakeCaller([0.9]);
    await rerankCandidates({
      candidates: [candidate('a.md', 0.8)],
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });
    const [, options] = systemOne.mock.calls[0];
    expect(options?.timeout).toBe(RERANK_TIMEOUT_MS);
    expect(options?.retry.maxRetries).toBe(0);
  });

  it('keeps candidates at or above the threshold, in score order, capped at three (AC-4)', async () => {
    const candidates = [
      candidate('a.md', 0.8),
      candidate('b.md', 0.79),
      candidate('c.md', 0.78),
      candidate('d.md', 0.77),
    ];
    // Deliberately not in cosine order: the reranker reorders.
    const { caller } = fakeCaller([0.6, 0.95, 0.51, 0.99]);
    const result = await rerankCandidates({
      candidates,
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });

    expect(result.fellBack).toBe(false);
    expect(result.kept.map((c) => c.sourcePath)).toEqual(['d.md', 'b.md', 'a.md']);
  });

  it('returns exactly what cleared, with no padding, when fewer than three do (AC-4)', async () => {
    const candidates = [candidate('a.md', 0.8), candidate('b.md', 0.7), candidate('c.md', 0.6)];
    const { caller } = fakeCaller([0.9, 0.2, 0.8]);
    const result = await rerankCandidates({
      candidates,
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });

    expect(result.kept.map((c) => c.sourcePath)).toEqual(['a.md', 'c.md']);
    expect(result.fellBack).toBe(false);
  });

  it('treats the threshold as inclusive', async () => {
    const { caller } = fakeCaller([RERANK_KEEP_THRESHOLD]);
    const result = await rerankCandidates({
      candidates: [candidate('a.md', 0.8)],
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });
    expect(result.kept).toHaveLength(1);
  });

  it('keeps nothing when nothing clears, and that is a decision rather than a fall back (AC-4)', async () => {
    const { caller } = fakeCaller([0.1, 0.2]);
    const result = await rerankCandidates({
      candidates: [candidate('a.md', 0.8), candidate('b.md', 0.7)],
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });
    expect(result.kept).toEqual([]);
    expect(result.fellBack).toBe(false);
  });

  it('breaks ties by the index own ranking rather than arbitrarily', async () => {
    const candidates = [candidate('a.md', 0.9), candidate('b.md', 0.8), candidate('c.md', 0.7)];
    const { caller } = fakeCaller([0.7, 0.7, 0.7]);
    const result = await rerankCandidates({
      candidates,
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });
    expect(result.kept.map((c) => c.sourcePath)).toEqual(['a.md', 'b.md', 'c.md']);
  });

  it('records the reranker token usage it was told about (AC-8)', async () => {
    const { caller } = fakeCaller([0.9], { input_tokens: 812, output_tokens: 0 });
    const result = await rerankCandidates({
      candidates: [candidate('a.md', 0.8)],
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });
    expect(result.inputTokens).toBe(812);
    expect(result.outputTokens).toBe(0);
  });

  it('never calls the provider with an empty candidate set', async () => {
    const { caller, systemOne } = fakeCaller([]);
    const result = await rerankCandidates({
      candidates: [],
      interviewerQuestion: 'q',
      searchQuery: 's',
      caller,
    });
    expect(systemOne).not.toHaveBeenCalled();
    expect(result.kept).toEqual([]);
    expect(result.fellBack).toBe(false);
  });

  describe('fails open, never throws (AC-6)', () => {
    it('on a timeout', async () => {
      const { caller } = failingCaller(new APITimeoutError(RERANK_TIMEOUT_MS));
      const result = await rerankCandidates({
        candidates: [candidate('a.md', 0.8)],
        interviewerQuestion: 'q',
        searchQuery: 's',
        caller,
      });
      expect(result.fellBack).toBe(true);
      expect(result.kept).toEqual([]);
      expect(result.cause).toContain('APITimeoutError');
    });

    it('on a provider error, carrying name and status but no message text', async () => {
      const error = Object.assign(new Error('upstream said something verbose'), {
        name: 'RateLimitError',
        status: 429,
      });
      const { caller } = failingCaller(error);
      const result = await rerankCandidates({
        candidates: [candidate('a.md', 0.8)],
        interviewerQuestion: 'q',
        searchQuery: 's',
        caller,
      });
      expect(result.fellBack).toBe(true);
      expect(result.cause).toBe('RateLimitError:429');
      expect(result.cause).not.toContain('verbose');
    });

    it('on a malformed response that answers only some candidates', async () => {
      const systemOne = vi.fn(() =>
        Promise.resolve({
          model: RERANK_MODEL_ID,
          answers: { c0: { type: 'noul', noul: 0.9 } },
          usage: { input_tokens: 10, output_tokens: 0 },
        }),
      );
      const result = await rerankCandidates({
        candidates: [candidate('a.md', 0.8), candidate('b.md', 0.7)],
        interviewerQuestion: 'q',
        searchQuery: 's',
        caller: { systemOne } as unknown as SystemOneCaller,
      });
      // A selection built from half the judgements is not the selection this
      // was asked for, so a partial answer set is a fall back, not a result.
      expect(result.fellBack).toBe(true);
      expect(result.kept).toEqual([]);
    });

    it('on a response whose probability is not a number', async () => {
      const systemOne = vi.fn(() =>
        Promise.resolve({
          model: RERANK_MODEL_ID,
          answers: { c0: { type: 'noul', noul: 'very relevant' } },
          usage: { input_tokens: 10, output_tokens: 0 },
        }),
      );
      const result = await rerankCandidates({
        candidates: [candidate('a.md', 0.8)],
        interviewerQuestion: 'q',
        searchQuery: 's',
        caller: { systemOne } as unknown as SystemOneCaller,
      });
      expect(result.fellBack).toBe(true);
    });

    it('when the provider key is missing', async () => {
      const saved = process.env.TYPESAFE_API_KEY;
      delete process.env.TYPESAFE_API_KEY;
      try {
        const result = await rerankCandidates({
          candidates: [candidate('a.md', 0.8)],
          interviewerQuestion: 'q',
          searchQuery: 's',
        });
        expect(result.fellBack).toBe(true);
        expect(result.cause).toBe('reranker not configured');
      } finally {
        if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
      }
    });
  });
});

/**
 * Confirmed failing inputs from the pre deploy gate's break it pass
 * (2026-09-23). Each one was reproduced against the real code before the fix.
 */
describe('rerankCandidates, gate regressions', () => {
  /** A caller whose answer for every candidate is whatever `answer` returns. */
  function callerAnswering(answer: (i: number) => unknown, usage: unknown = { input_tokens: 10, output_tokens: 0 }) {
    const systemOne = vi.fn((request: { questions: Record<string, unknown> }) =>
      Promise.resolve({
        model: RERANK_MODEL_ID,
        answers: Object.fromEntries(Object.keys(request.questions).map((key, i) => [key, answer(i)])),
        usage,
      }),
    );
    return { systemOne } as unknown as SystemOneCaller;
  }
  const one = [candidate('a.md', 0.8), candidate('b.md', 0.7)];
  const ask = (caller: SystemOneCaller, interviewerQuestion = 'q') =>
    rerankCandidates({ candidates: one, interviewerQuestion, searchQuery: 's', caller });

  it.each([
    ['above one', { type: 'noul', noul: 1.7 }],
    ['below zero', { type: 'noul', noul: -0.2 }],
    ['huge', { type: 'noul', noul: 1e308 }],
    ['a choice carrying a noul field', { type: 'choice', noul: 0.9 }],
    ['a score carrying a noul field', { type: 'score', noul: 0.9 }],
  ])('treats an answer that is %s as malformed and falls back (AC-6)', async (_label, answer) => {
    const result = await ask(callerAnswering(() => answer));
    // Accepting these either promoted a junk chunk above real judgements or,
    // with every answer at -0.2, returned nothing while reporting a decision:
    // fewer results than cosine, which AC-6 forbids.
    expect(result.fellBack).toBe(true);
    expect(result.kept).toEqual([]);
  });

  it('records usage that is not a non negative number as zero, never as provider text', async () => {
    const result = await ask(
      callerAnswering(() => ({ type: 'noul', noul: 0.9 }), {
        input_tokens: 'echo: a query naming the visitor topic',
        output_tokens: { echoed: 'a distinctive sentence from a committed document' },
      }),
    );
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it('falls back rather than judging when there is no interviewer question', async () => {
    const caller = callerAnswering(() => ({ type: 'noul', noul: 0.9 }));
    const result = await ask(caller, '   ');
    // Judging the paraphrase alone is the failure AC-3 exists to prevent, so a
    // missing question is today's behaviour, logged, not a silent degradation.
    expect(result.fellBack).toBe(true);
    expect(result.cause).toBe('no interviewer question');
    expect((caller as unknown as { systemOne: ReturnType<typeof vi.fn> }).systemOne).not.toHaveBeenCalled();
  });

  describe('a provider that stalls mid body', () => {
    // Loopback only: a local server standing in for the provider, because the
    // failure lives in how the SDK abandons a half read body, which a fake
    // caller cannot reach. Nothing here leaves the machine.
    let server: Server;
    const saved = { key: process.env.TYPESAFE_API_KEY, url: process.env.TYPESAFE_BASE_URL };

    beforeEach(async () => {
      server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"model":"jev-1.13.0","answers":{');
        // ...and never finishes.
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const { port } = server.address() as { port: number };
      process.env.TYPESAFE_API_KEY = 'test-key';
      process.env.TYPESAFE_BASE_URL = `http://127.0.0.1:${port}`;
      setRerankClient(null);
    });

    afterEach(async () => {
      setRerankClient(null);
      if (saved.key === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = saved.key;
      if (saved.url === undefined) delete process.env.TYPESAFE_BASE_URL;
      else process.env.TYPESAFE_BASE_URL = saved.url;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('falls back on the timeout without leaving an unhandled rejection behind', async () => {
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => rejections.push(reason);
      process.on('unhandledRejection', onRejection);
      try {
        const result = await rerankCandidates({
          candidates: [candidate('a.md', 0.8)],
          interviewerQuestion: 'q',
          searchQuery: 's',
        });
        expect(result.fellBack).toBe(true);
        expect(result.cause).toContain('APITimeoutError');
        // The SDK cancels a cloned body reader when its timer fires, and the
        // rejection that produces surfaced after the fallback had returned.
        // In production nothing handles it, so Node exited: one slow provider
        // response took the whole API down in shadow or enforce.
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(rejections).toEqual([]);
      } finally {
        process.off('unhandledRejection', onRejection);
      }
    }, 10_000);
  });
});
