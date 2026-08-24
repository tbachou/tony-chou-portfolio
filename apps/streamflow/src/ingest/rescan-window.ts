import {
  EXPECTED_INTERVAL_MINUTES,
  RESCAN_MERGE_GAP_HOURS,
  RESCAN_ROLLING_DAYS,
} from '../config';
import type { IngestWindow } from './window';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Merges spans that overlap or sit closer together than the gap allows.
 *
 * Expects nothing about the input order. Returns spans sorted by start, none
 * of them touching, so a caller can request each one without asking for the
 * same stretch of river twice.
 */
export function mergeSpans(
  spans: readonly IngestWindow[],
  gapMs: number,
): IngestWindow[] {
  if (spans.length === 0) return [];

  const sorted = [...spans].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const merged: IngestWindow[] = [
    { start: new Date(sorted[0].start), end: new Date(sorted[0].end) },
  ];

  for (const span of sorted.slice(1)) {
    const last = merged[merged.length - 1];

    if (span.start.getTime() - last.end.getTime() <= gapMs) {
      if (span.end.getTime() > last.end.getTime()) {
        last.end = new Date(span.end);
      }
      continue;
    }

    merged.push({ start: new Date(span.start), end: new Date(span.end) });
  }

  return merged;
}

/**
 * Works out what a trailing rescan should re-poll (AC-19).
 *
 * Two things get asked for. A rolling window back from now, because that is
 * where USGS revises most often. And every reading still marked provisional,
 * however old, because an approval can land on a reading from months back and
 * the ordinary ingest window would never reach it.
 *
 * The provisional readings are grouped into contiguous stretches rather than
 * requested one by one. Normally they form a single run, so this is one span.
 * The grouping matters for the case that would otherwise be pathological: one
 * reading stranded in provisional two years ago would, without it, either be
 * skipped or drag every rescan back across the whole history.
 */
export function spansForRescan(
  provisionalValidTimes: readonly Date[],
  now: Date,
  rollingDays: number = RESCAN_ROLLING_DAYS,
  mergeGapHours: number = RESCAN_MERGE_GAP_HOURS,
): IngestWindow[] {
  const rolling: IngestWindow = {
    start: new Date(now.getTime() - rollingDays * DAY_MS),
    end: new Date(now),
  };

  // Padded by one reading interval either side rather than collapsed onto the
  // instant itself. A zero width span is not a small request, it is no request
  // at all: the client's chunker loops `while (start < end)` and produces
  // nothing, so an isolated provisional reading would be skipped in silence,
  // which is the exact case AC-19 calls out with "however old it is". The
  // padding also keeps the reading strictly inside the span rather than on its
  // boundary. rescan-reach.spec.ts holds this to the client's real behaviour.
  const padMs = EXPECTED_INTERVAL_MINUTES * 60 * 1000;
  const provisionalSpans: IngestWindow[] = provisionalValidTimes
    .map((at) => ({
      start: new Date(at.getTime() - padMs),
      end: new Date(at.getTime() + padMs),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return mergeSpans(
    [...provisionalSpans, rolling],
    mergeGapHours * HOUR_MS,
  );
}

/**
 * How a rescan judges whether the source answered fully.
 *
 * Deliberately not the rule the forward ingest uses. A rescan covers historical
 * stretches whose gaps are real, permanent and already known, so measuring
 * against what the window implies would report PARTIAL on every healthy run and
 * mean nothing. What matters is whether the source still has at least what the
 * store already holds: fewer readings coming back than we hold for that span
 * means data went missing upstream, which is worth seeing.
 */
export function judgeRescanCompleteness(
  receivedCount: number,
  alreadyStoredCount: number,
): 'OK' | 'PARTIAL' {
  return receivedCount < alreadyStoredCount ? 'PARTIAL' : 'OK';
}
