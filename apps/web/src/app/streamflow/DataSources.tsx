/**
 * Where the numbers on this page come from, and under what terms.
 *
 * The two sources are credited for different reasons, which is why they sit
 * in one block rather than being scattered. USGS data is public domain and
 * the credit is a courtesy. Open-Meteo's is CC BY 4.0, so naming the source
 * and the licence is a condition of using it at all, not a nicety. Removing
 * that second sentence would put the site out of licence silently, which is
 * what `DataSources.spec.tsx` exists to stop.
 *
 * Set at `term-sm` rather than the `term-xs` the page's optional footnotes
 * use: `design.md` puts the floor for anything carrying information at 13px,
 * and a licence condition is the last thing that should sit under it.
 */
export function DataSources({ timeZone }: { timeZone: string }) {
  return (
    <div className="mt-6 border-t border-term-border pt-5 text-term-sm text-term-muted">
      <p className="max-w-2xl">
        Discharge data courtesy of the U.S. Geological Survey, National Water
        Information System. Forecast rainfall by{' '}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="terminal-select text-term-ink"
        >
          Open-Meteo ↗
        </a>
        , used under{' '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          className="terminal-select text-term-ink"
        >
          CC BY 4.0 ↗
        </a>
        . The pipeline stores what each weather run predicted at a fixed lead,
        never what actually fell.
      </p>
      <p className="mt-3 max-w-2xl">
        Readings are shown in {timeZone}; everything is stored in UTC.
      </p>
    </div>
  );
}
