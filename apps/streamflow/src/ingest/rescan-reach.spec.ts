import { spansForRescan } from './rescan-window';
import { fetchInstantaneousValues, toSiteLocalTimestamp } from '../usgs/client';
import { GAUGE } from '../config';

/**
 * Guards the seam between deciding what to re-poll and actually re-polling it.
 *
 * Both sides looked right on their own. `spansForRescan` returned a span for
 * every provisional reading, and the client correctly declined to request an
 * empty window. Put together they silently dropped exactly the readings AC-19
 * says must be re-polled "however old it is", and every unit test stayed green
 * because neither module was wrong by itself.
 *
 * So this tests the pair: whatever spansForRescan decides to ask for, the
 * client must actually ask for.
 */
function countingFetch() {
  const urls: string[] = [];
  const impl = async (url: string | URL | Request): Promise<Response> => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ value: { timeSeries: [] } }),
    } as Response;
  };
  return { impl: impl as unknown as typeof fetch, urls };
}

const NOW = new Date('2026-08-23T18:00:00Z');

describe('every span the rescan asks for is actually requested', () => {
  const cases: [string, Date[]][] = [
    ['nothing provisional', []],
    ['one reading stranded two years back', [new Date('2024-02-01T00:00:00Z')]],
    [
      'a stranded reading plus a recent one',
      [new Date('2024-02-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z')],
    ],
    [
      'two stranded readings far apart',
      [new Date('2024-02-01T00:00:00Z'), new Date('2025-06-01T00:00:00Z')],
    ],
    [
      'a pair a quarter hour apart, alone in the past',
      [new Date('2024-02-01T00:00:00Z'), new Date('2024-02-01T00:15:00Z')],
    ],
    [
      'a contiguous run reaching the present',
      [
        new Date('2025-11-26T00:00:00Z'),
        new Date('2026-03-01T00:00:00Z'),
        new Date('2026-08-23T00:00:00Z'),
      ],
    ],
  ];

  it.each(cases)('%s', async (_name, provisional) => {
    const spans = spansForRescan(provisional, NOW);

    for (const span of spans) {
      const { impl, urls } = countingFetch();
      await fetchInstantaneousValues('03230500', span, impl);

      expect(urls.length).toBeGreaterThan(0);
    }
  });

  it('reaches the stranded reading itself, not merely near it', async () => {
    const stranded = new Date('2024-02-01T00:00:00Z');
    const [span] = spansForRescan([stranded], NOW);

    const { impl, urls } = countingFetch();
    await fetchInstantaneousValues('03230500', span, impl);

    const requested = new URL(urls[0]);
    const from = requested.searchParams.get('startDT') as string;
    const to = requested.searchParams.get('endDT') as string;
    const target = toSiteLocalTimestamp(stranded, GAUGE.timezone);

    // Compared as text, not by parsing back into instants. These timestamps
    // carry no timezone, so `new Date` would read them in whatever zone the
    // runtime happens to be in: correct on a machine set to the gauge's zone,
    // five hours out on a UTC CI runner. The format is fixed width and
    // ordered, so string comparison says exactly what is meant here.
    expect(from <= target).toBe(true);
    expect(to >= target).toBe(true);
  });
});
