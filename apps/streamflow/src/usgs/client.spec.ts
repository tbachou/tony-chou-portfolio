import { fetchInstantaneousValues } from './client';

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
    expect(url.searchParams.get('startDT')).toBe('2026-08-23T12:00:00.000Z');
    expect(url.searchParams.get('endDT')).toBe('2026-08-23T18:00:00.000Z');
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
    expect(spans[0][0]).toBe('2024-01-01T00:00:00.000Z');
    // Each chunk begins where the previous ended: no gap, no overlap.
    for (let index = 1; index < spans.length; index += 1) {
      expect(spans[index][0]).toBe(spans[index - 1][1]);
    }
    expect(spans[spans.length - 1][1]).toBe('2024-04-10T00:00:00.000Z');
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
});
