/**
 * Which harness modes may make a live model call for an uncached method.
 *
 * Lives in `src/` rather than beside the script that uses it because jest's
 * `rootDir` is `src`, so nothing under `scripts/` is collected. A condition
 * left in the script is a condition no test can hold: reverting the fix this
 * encodes left the whole suite green, which is how it was found.
 */

export type HarnessMode = 'live' | 'record' | 'replay';

/**
 * The reason a tool loop call must be refused in this mode, or null to allow.
 *
 * Only `replay` is refused, and the distinction matters. A `record` run IS a
 * live run that happens to save what it spends, so there is no misreporting to
 * prevent and refusing it would abort a run with nothing wrong. An earlier
 * version refused everything that was not `live`, with a message describing
 * replay, so a `record` run would have failed while being told it was
 * pretending to be a replay.
 */
export function toolLoopRefusalReason(mode: HarnessMode): string | null {
  if (mode !== 'replay') return null;
  return (
    'a tool loop call arrived in replay mode. Nothing here caches or replays ' +
    'one, so running it would spend on a live model call inside a run that ' +
    'reports itself as a replay. Add caching for it before this path is used.'
  );
}
