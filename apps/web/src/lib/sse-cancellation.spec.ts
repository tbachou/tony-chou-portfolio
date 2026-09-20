import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamNextTurn } from './api';
import { streamBetaPlan } from './beta-api';

/**
 * Both SSE readers must release the response body when the consumer stops
 * early, and must forward an AbortSignal so an unmount can stop the request.
 *
 * This is a cost test, not a tidiness test. Before these existed, navigating
 * away mid-stream left the connection open: the API kept calling Anthropic
 * and, on `/beta/plan`, kept the global daily slot it had already reserved.
 * A pre-deploy sweep found the same defect from the server side (no
 * `req.on('close')` handler), so the fix is deliberately two-sided and this
 * file covers the browser half.
 *
 * The reader is a hand-rolled stub rather than a real `ReadableStream`
 * because the assertions are about which methods the generator calls and in
 * what order, which a real stream would hide.
 */

type ReaderStub = {
  read: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  cancelled: () => boolean;
};

/** A reader that yields `blocks` one at a time and then never resolves. */
function makeReader(blocks: string[]): ReaderStub {
  const encoder = new TextEncoder();
  let index = 0;
  let cancelled = false;
  return {
    cancelled: () => cancelled,
    cancel: vi.fn(async () => {
      cancelled = true;
    }),
    // After the scripted blocks run out the stream HANGS, exactly as a real
    // one does while the model is still generating. A test that ended the
    // stream instead would pass without the `finally` ever being needed.
    read: vi.fn(async () => {
      if (index < blocks.length) {
        return { done: false, value: encoder.encode(blocks[index++]) };
      }
      return new Promise<never>(() => {});
    })
  };
}

function mockFetch(reader: ReaderStub) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    body: { getReader: () => reader }
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The RequestInit the generator handed fetch, asserted to exist. */
function initOf(fetchMock: ReturnType<typeof mockFetch>): RequestInit {
  const init = fetchMock.mock.calls[0]?.[1];
  expect(init).toBeDefined();
  return init as RequestInit;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('streamNextTurn cancellation', () => {
  const turnStart = 'event: turn_start\ndata: {"role":"interviewer"}\n\n';

  it('cancels the reader when the consumer breaks out of the loop', async () => {
    const reader = makeReader([turnStart]);
    mockFetch(reader);

    for await (const event of streamNextTurn({ topicId: 'x' })) {
      expect(event.type).toBe('turn_start');
      break;
    }

    // `for await` calls the generator's .return() on `break`, which resumes
    // the finally. Without it the body stays open and the API keeps going.
    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.cancelled()).toBe(true);
  });

  it('cancels the reader when the consumer throws', async () => {
    const reader = makeReader([turnStart]);
    mockFetch(reader);

    await expect(
      (async () => {
        for await (const _event of streamNextTurn({ topicId: 'x' })) {
          throw new Error('consumer blew up');
        }
      })()
    ).rejects.toThrow('consumer blew up');

    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it('forwards the AbortSignal to fetch and keeps it out of the body', async () => {
    const reader = makeReader([turnStart]);
    const fetchMock = mockFetch(reader);
    const controller = new AbortController();

    const iterator = streamNextTurn({ topicId: 'x' }, controller.signal);
    await iterator.next();
    await iterator.return?.(undefined as never);

    const init = initOf(fetchMock);
    expect(init.signal).toBe(controller.signal);
    // The request contract is `.strict()`, so a stray `signal` property in
    // the JSON body would be a 400 rather than a harmless extra field.
    expect(JSON.parse(init.body as string)).toEqual({ topicId: 'x' });
  });
});

describe('streamBetaPlan cancellation', () => {
  const status = 'event: status\ndata: {"stage":"screening"}\n\n';
  const payload = { injuryArea: 'finger_pulley' } as never;

  it('cancels the reader when the consumer breaks out of the loop', async () => {
    const reader = makeReader([status]);
    mockFetch(reader);

    for await (const event of streamBetaPlan(payload)) {
      expect(event.type).toBe('status');
      break;
    }

    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.cancelled()).toBe(true);
  });

  it('forwards the AbortSignal to fetch and keeps it out of the body', async () => {
    const reader = makeReader([status]);
    const fetchMock = mockFetch(reader);
    const controller = new AbortController();

    const iterator = streamBetaPlan(payload, controller.signal);
    await iterator.next();
    await iterator.return?.(undefined as never);

    const init = initOf(fetchMock);
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it('survives a reader whose cancel() rejects', async () => {
    const reader = makeReader([status]);
    reader.cancel.mockRejectedValue(new Error('already released'));
    mockFetch(reader);

    // A cancel that throws must not become the consumer's error: the visitor
    // has already navigated away, and the plan they did see was fine.
    await expect(
      (async () => {
        for await (const _event of streamBetaPlan(payload)) break;
      })()
    ).resolves.toBeUndefined();
  });
});
