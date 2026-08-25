// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The HTTP boundary's actual contract, which nothing else can see.
 *
 * The page never takes these branches: it always asks with a window it built
 * itself, and a store with no active gauge would have sent the visitor to a
 * 404 long before this route was reached. So the 422 and the 404 exist for
 * everyone else, and the only way to know they still answer as specced is to
 * call the route.
 */
const findFirst = vi.fn();
const observationsAsOf = vi.fn();

vi.mock('@/lib/streamflow-db', () => ({
  streamflowDb: () => ({ gauge: { findFirst } }),
}));

vi.mock('@portfolio/streamflow', () => ({
  observationsAsOf: (...args: unknown[]) => observationsAsOf(...args),
}));

const { GET } = await import('./route');

const GAUGE = {
  id: 'gauge-darby',
  usgsSiteId: '03230500',
  name: 'Big Darby Creek at Darbyville OH',
  lat: 39.7006,
  lon: -83.1102,
  timezone: 'America/New_York',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function ask(query: Record<string, string>) {
  const params = new URLSearchParams(query);
  return GET(new Request(`https://example.test/api/observations?${params}`));
}

describe('GET /api/observations', () => {
  beforeEach(() => {
    findFirst.mockResolvedValue(GAUGE);
    observationsAsOf.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns the readings known at the instant asked for', async () => {
    observationsAsOf.mockResolvedValue([
      {
        gaugeId: GAUGE.id,
        validTime: new Date('2026-08-24T12:00:00Z'),
        recordedAt: new Date('2026-08-24T12:05:00Z'),
        valueCfs: 712,
        qualifier: 'PROVISIONAL',
      },
    ]);

    const response = await ask({
      from: '2026-07-25T00:00:00Z',
      to: '2026-08-24T00:00:00Z',
      asOf: '2026-08-24T18:00:00Z',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      gauge: {
        usgsSiteId: GAUGE.usgsSiteId,
        name: GAUGE.name,
        lat: GAUGE.lat,
        lon: GAUGE.lon,
        timezone: GAUGE.timezone,
      },
      asOf: '2026-08-24T18:00:00.000Z',
      from: '2026-07-25T00:00:00.000Z',
      to: '2026-08-24T00:00:00.000Z',
      points: [
        {
          validTime: '2026-08-24T12:00:00.000Z',
          recordedAt: '2026-08-24T12:05:00.000Z',
          valueCfs: 712,
          qualifier: 'PROVISIONAL',
        },
      ],
    });
  });

  it('reads the store as it stands now when no instant is given', async () => {
    const before = Date.now();

    const response = await ask({
      from: '2026-07-25T00:00:00Z',
      to: '2026-08-24T00:00:00Z',
    });
    const body = (await response.json()) as { asOf: string };

    expect(response.status).toBe(200);
    // The echoed instant is the one the read actually used, not a null.
    const used = observationsAsOf.mock.calls[0][4] as Date;
    expect(used.toISOString()).toBe(body.asOf);
    expect(Date.parse(body.asOf)).toBeGreaterThanOrEqual(before);
  });

  it('refuses a window longer than the year the spec allows', async () => {
    const response = await ask({
      from: '2025-01-01T00:00:00Z',
      to: '2026-08-24T00:00:00Z',
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: string;
      issues: { path: string; message: string }[];
    };
    expect(body.error).toBe('invalid query');
    expect(body.issues).toContainEqual({
      path: 'to',
      message: 'window must be 365 days or fewer',
    });
    // Refused before the store is touched, which is the point of the limit.
    expect(observationsAsOf).not.toHaveBeenCalled();
  });

  it('refuses a window that runs backwards', async () => {
    const response = await ask({
      from: '2026-08-24T00:00:00Z',
      to: '2026-07-25T00:00:00Z',
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { issues: { path: string }[] };
    expect(body.issues.map((issue) => issue.path)).toContain('from');
  });

  it.each([
    ['a date it cannot read', { from: 'yesterday', to: '2026-08-24T00:00:00Z' }],
    ['a missing bound', { from: '2026-08-24T00:00:00Z' }],
    [
      'a parameter it does not know',
      {
        from: '2026-07-25T00:00:00Z',
        to: '2026-08-24T00:00:00Z',
        gauge: '03230500',
      },
    ],
  ])('refuses %s', async (_label, query) => {
    // The unknown parameter matters as much as the malformed date: every
    // contract object is strict, and that is what stops a typo silently
    // widening a query the caller thinks it narrowed.
    const response = await ask(query as Record<string, string>);

    expect(response.status).toBe(422);
    expect(observationsAsOf).not.toHaveBeenCalled();
  });

  it('serves a window exactly at the limit', async () => {
    const to = Date.parse('2026-08-24T00:00:00Z');
    const response = await ask({
      from: new Date(to - 365 * DAY_MS).toISOString(),
      to: new Date(to).toISOString(),
    });

    expect(response.status).toBe(200);
  });

  it('answers 404 rather than an empty chart when no gauge is active', async () => {
    findFirst.mockResolvedValue(null);

    const response = await ask({
      from: '2026-07-25T00:00:00Z',
      to: '2026-08-24T00:00:00Z',
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'no active gauge' });
    expect(observationsAsOf).not.toHaveBeenCalled();
  });

  it('reads only the active gauge, and only over the window asked for', async () => {
    await ask({
      from: '2026-07-25T00:00:00Z',
      to: '2026-08-24T00:00:00Z',
      asOf: '2026-08-24T18:00:00Z',
    });

    expect(findFirst).toHaveBeenCalledWith({ where: { active: true } });
    const [, gaugeId, from, to, asOf, axis] = observationsAsOf.mock.calls[0];
    expect(gaugeId).toBe(GAUGE.id);
    expect((from as Date).toISOString()).toBe('2026-07-25T00:00:00.000Z');
    expect((to as Date).toISOString()).toBe('2026-08-24T00:00:00.000Z');
    expect((asOf as Date).toISOString()).toBe('2026-08-24T18:00:00.000Z');
    // The public read never asks for the loose knowability axis. That one
    // belongs to the seeding hindcast alone (spec 0010, AC-H2).
    expect(axis).toBeUndefined();
  });
});
