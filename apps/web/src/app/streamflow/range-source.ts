/**
 * Where a forecast's range came from, which is three states rather than two.
 *
 * `intervalSeeded` answers one narrow question: was this range conditioned on
 * what the river was doing when the forecast was made (spec 0010, AC-I7). It
 * is false both for a range drawn from a large sample pooled across every
 * river condition and for the fixed placeholder band, and those two deserve
 * very different words on the page. The first is measured and simply not
 * tuned to today; the second is not earned yet, and only it is the "unseeded
 * interval" AC-20 asks to be marked.
 *
 * `bucketSize` is what tells them apart, stored on the row for exactly this
 * kind of after the fact question (AC-I11). Reading `intervalSeeded` alone,
 * as the page once did, calls a range built from hundreds of real errors a
 * placeholder, which is the opposite of what it is.
 *
 * Its own module rather than a helper inside the page, because a page file
 * cannot export anything a test could reach.
 */
export type RangeSource = 'conditioned' | 'pooled' | 'placeholder';

export function rangeSource(forecast: {
  intervalSeeded: boolean;
  bucketSize: number;
}): RangeSource {
  if (forecast.intervalSeeded) return 'conditioned';
  return forecast.bucketSize > 0 ? 'pooled' : 'placeholder';
}
