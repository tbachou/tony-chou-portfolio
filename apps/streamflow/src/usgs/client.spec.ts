import { fetchInstantaneousValues, toSiteLocalTimestamp } from './client';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function withReading(dateTime: string, value = '1060') {
  return {
    value: {
      timeSeries: [
        {
          variable: { variableCode: [{ value: '00060' }] },
          values: [{ value: [{ value, qualifiers: ['P'], dateTime }] }],
        },
      ],
    },
  };
}

const EMPTY = { value: { timeSeries: [] } };

/**
 * A fetch stand in that keeps the urls it was asked for, so a test can check
 * which spans were actually requested. Never reaches the network.
 */
function recordingFetch(...bodies: unknown[]) {
  const urls: string[] = [];
  let call = 0;

  const impl = async (url: string | URL | Request): Promise<Response> => {
    urls.push(String(url));
    const body = bodies[Math.min(call++, bodies.length - 1)] ?? EMPTY;
    return jsonResponse(body);
  };

  return { impl: impl as unknown as typeof fetch, urls };
}

function spansOf(urls: string[]): [string | null, string | null][] {
  return urls.map((url) => {
    const parsed = new URL(url);
    return [
      parsed.searchParams.get('startDT'),
      parsed.searchParams.get('endDT'),
    ];
  });
}

describe('fetchInstantaneousValues', () => {
  it('requests json discharge for the site and window', async () => {
    const { impl, urls } = recordingFetch();

    await fetchInstantaneousValues(
      '03230500',
      {
        start: new Date('2026-08-23T12:00:00Z'),
        end: new Date('2026-08-23T18:00:00Z'),
      },
      impl,
    );

    const url = new URL(urls[0]);
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('sites')).toBe('03230500');
    expect(url.searchParams.get('parameterCd')).toBe('00060');
    // Site local wall clock, no timezone marker: 12:00Z is 08:00 in EDT.
    expect(url.searchParams.get('startDT')).toBe('2026-08-23T08:00:00');
    expect(url.searchParams.get('endDT')).toBe('2026-08-23T14:00:00');
  });

  it('sends no timezone designator, which is what USGS mishandles', async () => {
    const { impl, urls } = recordingFetch();

    await fetchInstantaneousValues(
      '03230500',
      {
        start: new Date('2025-11-26T14:15:00Z'),
        end: new Date('2025-11-26T14:45:00Z'),
      },
      impl,
    );

    const url = new URL(urls[0]);
    for (const key of ['startDT', 'endDT']) {
      const value = url.searchParams.get(key) as string;
      expect(value).not.toMatch(/Z$/);
      expect(value).not.toMatch(/[+-]\d{2}:\d{2}$/);
    }
  });

  it('returns the parsed readings', async () => {
    const { impl } = recordingFetch(withReading('2026-08-23T13:30:00.000-04:00'));

    const readings = await fetchInstantaneousValues(
      '03230500',
      {
        start: new Date('2026-08-23T12:00:00Z'),
        end: new Date('2026-08-23T18:00:00Z'),
      },
      impl,
    );

    expect(readings).toHaveLength(1);
    expect(readings[0].valueCfs).toBe(1060);
  });

  it('splits a backfill into chunks that cover the window exactly once', async () => {
    const { impl, urls } = recordingFetch();

    await fetchInstantaneousValues(
      '03230500',
      {
        start: new Date('2024-01-01T00:00:00Z'),
        end: new Date('2024-04-10T00:00:00Z'),
      },
      impl,
    );

    const spans = spansOf(urls);

    expect(spans).toHaveLength(4);
    // January is EST, so 00:00Z on the 1st is 19:00 on the previous evening.
    expect(spans[0][0]).toBe('2023-12-31T19:00:00');
    // Each chunk begins where the previous ended: no gap, no overlap.
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index][0]).toBe(spans[index - 1][1]);
    }
    // April is EDT, a different offset from the January chunk above. Using the
    // date's own offset rather than today's is the whole point of the fix.
    expect(spans[spans.length - 1][1]).toBe('2024-04-09T20:00:00');
  });

  it('concatenates the readings from every chunk', async () => {
    const { impl } = recordingFetch(
      withReading('2024-01-15T00:00:00.000Z', '900'),
      withReading('2024-02-15T00:00:00.000Z', '950'),
    );

    const readings = await fetchInstantaneousValues(
      '03230500',
      {
        start: new Date('2024-01-01T00:00:00Z'),
        end: new Date('2024-03-01T00:00:00Z'),
      },
      impl,
    );

    expect(readings.map((entry) => entry.valueCfs)).toEqual([900, 950]);
  });

  it('makes no request for an empty window', async () => {
    const { impl, urls } = recordingFetch();
    const at = new Date('2026-08-23T18:00:00Z');

    const readings = await fetchInstantaneousValues(
      '03230500',
      { start: at, end: at },
      impl,
    );

    expect(urls).toEqual([]);
    expect(readings).toEqual([]);
  });

  it('throws rather than returning a short list when a chunk fails', async () => {
    let call = 0;
    const impl = (async () => {
      call += 1;
      return call === 1
        ? jsonResponse(withReading('2024-01-15T00:00:00.000Z'))
        : jsonResponse(null, false, 503);
    }) as unknown as typeof fetch;

    await expect(
      fetchInstantaneousValues(
        '03230500',
        {
          start: new Date('2024-01-01T00:00:00Z'),
          end: new Date('2024-03-01T00:00:00Z'),
        },
        impl,
      ),
    ).rejects.toThrow(/503/);
  });

  it('uses the offset in force on the date, not the one in force today', () => {
    // The bug this guards: USGS applies the site's current daylight saving
    // offset to any timestamp carrying a zone, so a winter window requested
    // from a summer machine came back an hour late. Verified against the live
    // service on 2026-08-24.
    const zone = 'America/New_York';

    // EST, UTC-5
    expect(toSiteLocalTimestamp(new Date('2025-11-26T14:15:00Z'), zone)).toBe(
      '2025-11-26T09:15:00',
    );
    // EDT, UTC-4
    expect(toSiteLocalTimestamp(new Date('2026-07-01T14:15:00Z'), zone)).toBe(
      '2026-07-01T10:15:00',
    );
  });

  it('renders midnight as 00, never 24', () => {
    expect(
      toSiteLocalTimestamp(new Date('2026-01-01T05:00:00Z'), 'America/New_York'),
    ).toBe('2026-01-01T00:00:00');
  });
});

/**
 * Retrying a flapping upstream.
 *
 * USGS does not go down so much as flap. Measured on 2026-09-05, twelve
 * identical requests two seconds apart returned eleven 200s and one 503, and a
 * run makes at least four requests where any one failing fails the whole call.
 * That is how an eight percent per request rate became two lost cycles in a
 * row. These pin the rule that fixes it, and the exception that keeps it
 * honest.
 */
describe('a flapping upstream is retried, a bad request is not', () => {
  const WINDOW = {
    start: new Date('2026-09-05T00:00:00Z'),
    end: new Date('2026-09-05T06:00:00Z'),
  };
  const noSleep = async () => {};

  /** Replays the given responses in order, counting attempts. */
  function flakyFetch(...responses: (Response | Error)[]) {
    let call = 0;
    const impl = async (): Promise<Response> => {
      const next = responses[Math.min(call++, responses.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    };
    return { impl: impl as unknown as typeof fetch, attempts: () => call };
  }

  it('succeeds when a 503 is followed by a 200', async () => {
    const fetcher = flakyFetch(
      jsonResponse(EMPTY, false, 503),
      jsonResponse(withReading('2026-09-05T01:00:00.000-05:00')),
    );

    const readings = await fetchInstantaneousValues(
      '03230500',
      WINDOW,
      fetcher.impl,
      'America/New_York',
      noSleep,
    );

    expect(fetcher.attempts()).toBe(2);
    expect(readings).toHaveLength(1);
  });

  it('gives up after three attempts when every one is a 503', async () => {
    const fetcher = flakyFetch(jsonResponse(EMPTY, false, 503));

    await expect(
      fetchInstantaneousValues('03230500', WINDOW, fetcher.impl, 'America/New_York', noSleep),
    ).rejects.toThrow(/503/);

    expect(fetcher.attempts()).toBe(3);
  });

  it('does NOT retry a 4xx, because that is our bug and not theirs', async () => {
    // The load bearing exception. A 400 means the window or the site id is
    // wrong, so three attempts spend triple the budget to learn what the first
    // already said, and turn a loud fixable fault into a slow one.
    const fetcher = flakyFetch(jsonResponse(EMPTY, false, 400));

    await expect(
      fetchInstantaneousValues('03230500', WINDOW, fetcher.impl, 'America/New_York', noSleep),
    ).rejects.toThrow(/400/);

    expect(fetcher.attempts()).toBe(1);
  });

  it('retries a thrown network error on the same terms as a 5xx', async () => {
    const fetcher = flakyFetch(
      new Error('ECONNRESET'),
      jsonResponse(withReading('2026-09-05T01:00:00.000-05:00')),
    );

    const readings = await fetchInstantaneousValues(
      '03230500',
      WINDOW,
      fetcher.impl,
      'America/New_York',
      noSleep,
    );

    expect(fetcher.attempts()).toBe(2);
    expect(readings).toHaveLength(1);
  });

  it('backs off between attempts, and not before the first', async () => {
    const waited: number[] = [];
    const fetcher = flakyFetch(jsonResponse(EMPTY, false, 503));

    await expect(
      fetchInstantaneousValues(
        '03230500',
        WINDOW,
        fetcher.impl,
        'America/New_York',
        async (ms) => {
          waited.push(ms);
        },
      ),
    ).rejects.toThrow();

    // Two waits for three attempts, and the first attempt is immediate.
    expect(waited).toEqual([1_000, 3_000]);
  });
});
