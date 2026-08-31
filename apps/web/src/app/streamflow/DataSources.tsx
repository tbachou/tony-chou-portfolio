/**
 * What this page is, where its numbers come from, and under what terms.
 *
 * The disclaimer leads rather than trails, and it is the reason this block
 * is not called something narrower. `/streamflow` is the one page in this
 * project that shows live forecasts of a real river, and it was the only one
 * of the three streamflow pages carrying no "not a flood forecast" line at
 * all: both `/projects/streamflow` and the walkthrough have had one since
 * they shipped. The pre deploy audit on 2026-08-31 found the gap. The wording
 * is copied from those two deliberately, so the three pages say one thing
 * rather than three similar things.
 *
 * The two data sources are credited for different reasons, which is why they
 * sit together. USGS data is public domain and the credit is a courtesy.
 * Open-Meteo's is CC BY 4.0, so naming the source and linking the licence is
 * a condition of using it at all, not a nicety. Removing that sentence would
 * put the site out of licence silently, which is what `DataSources.spec.tsx`
 * exists to stop.
 *
 * Set at `term-sm` rather than the `term-xs` the page's optional footnotes
 * use: `design.md` puts the floor for anything carrying information at 13px,
 * and neither a safety disclaimer nor a licence condition should sit under
 * it.
 */
export function DataSources({ timeZone }: { timeZone: string }) {
  return (
    <div className="mt-6 border-t border-term-border pt-5 text-term-sm text-term-muted">
      <p className="max-w-2xl">
        This is an engineering demonstration, not a flood forecast, and nothing
        here should be used to make decisions about water. Provisional readings
        are subject to revision.
      </p>
      <p className="mt-3 max-w-2xl">
        Discharge data courtesy of the U.S. Geological Survey, National Water
        Information System. Forecast rainfall by{' '}
        <a
          href="https://open-meteo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="terminal-select text-term-ink"
        >
          Open-Meteo <span aria-hidden="true">↗</span>
        </a>
        , used under{' '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          className="terminal-select text-term-ink"
        >
          CC BY 4.0 <span aria-hidden="true">↗</span>
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
