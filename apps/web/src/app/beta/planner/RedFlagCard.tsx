import type { RefObject } from 'react';

/**
 * The terminal state where screening found a warning sign and no plan was
 * drafted (spec 0004 AC-2).
 *
 * Two delivery paths on purpose, and the characterization spec pins both.
 * `role="status"` is the backstop; the ref is the mechanism, because a live
 * region inserted into the DOM already populated is announced inconsistently.
 * The caller owns the focus move so it can order it against the render that
 * disables the form.
 */
export function RedFlagCard({
  message,
  cardRef,
  onReset,
}: {
  message: string;
  cardRef: RefObject<HTMLDivElement | null>;
  onReset: () => void;
}) {
  return (
    <div
      ref={cardRef}
      role="status"
      className="beta-card beta-card--error-edge beta-focus-target mt-6 p-6 sm:p-8"
    >
      <h3 className="text-[length:var(--beta-text-xl)]">Let’s pause here</h3>
      <p className="mt-3 beta-measure">{message}</p>
      <div className="mt-5 beta-measure rounded-lg bg-[color:var(--beta-surface-2)] p-4">
        <p className="font-medium text-[color:var(--beta-ink)]">
          This tool stops here on purpose.
        </p>
        <p className="mt-1.5 text-[0.9375rem]">
          What you reported is one of the warning signs Beta always hands off to a
          professional — not because it is necessarily serious, but because it deserves real
          eyes before anyone loads it. One good assessment now beats six careful weeks of
          the wrong plan.
        </p>
      </div>
      <button type="button" onClick={onReset} className="beta-btn beta-btn-secondary mt-6">
        Start over
      </button>
    </div>
  );
}
