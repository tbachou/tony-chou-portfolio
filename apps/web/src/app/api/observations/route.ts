import {
  observationsQuerySchema,
  type ObservationsResponse,
} from '@portfolio/shared';
import { observationsAsOf } from '@portfolio/streamflow';
import { NextResponse } from 'next/server';

import { streamflowDb } from '@/lib/streamflow-db';

/**
 * The hydrograph read (spec 0010).
 *
 * Public and read only. The pipeline writes to this database from GitHub
 * Actions and nothing else does, so there is no write path here to protect;
 * the data is public domain river readings.
 *
 * `from` and `to` bound `validTime`, the river's own history. `asOf` bounds
 * `recordedAt`, ours. Asking with an `asOf` in the past returns the store as
 * it stood then, revisions learned later excluded, which is what AC-3 means
 * and what the page's control drives.
 */

// Every request reads the live store, so nothing here may be cached.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = observationsQuerySchema.safeParse(params);

  if (!parsed.success) {
    // 422 rather than 400: the shape is understood, the values are not
    // acceptable. Spec 0010 names this for a window that is too large.
    return NextResponse.json(
      {
        error: 'invalid query',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  const { from, to, asOf } = parsed.data;
  const client = streamflowDb();

  const gauge = await client.gauge.findFirst({ where: { active: true } });
  if (!gauge) {
    return NextResponse.json({ error: 'no active gauge' }, { status: 404 });
  }

  const asOfInstant = asOf ? new Date(asOf) : new Date();

  const rows = await observationsAsOf(
    client,
    gauge.id,
    new Date(from),
    new Date(to),
    asOfInstant,
  );

  const body: ObservationsResponse = {
    gauge: {
      usgsSiteId: gauge.usgsSiteId,
      name: gauge.name,
      lat: gauge.lat,
      lon: gauge.lon,
      timezone: gauge.timezone,
    },
    asOf: asOfInstant.toISOString(),
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    points: rows.map((row) => ({
      validTime: row.validTime.toISOString(),
      recordedAt: row.recordedAt.toISOString(),
      valueCfs: row.valueCfs,
      qualifier: row.qualifier,
    })),
  };

  return NextResponse.json(body);
}
