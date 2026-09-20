import type { BetaStage } from '@/lib/beta-api';
import { PIPELINE_STAGES } from './options';

export type ChipState = 'idle' | 'active' | 'done';

/**
 * Screening / drafting / coaching progress.
 *
 * The sr-only heading and the list's aria-label are what make this a named
 * region rather than three decorative pills, and each chip states its status
 * in text as well as in `data-state` — colour alone would not say "done".
 * The characterization spec pins both.
 */
export function PipelineChips({
  chipState,
}: {
  chipState: (chip: BetaStage) => ChipState;
}) {
  return (
    <div className="mt-8">
      <h3 className="sr-only">Plan generation progress</h3>
      <ol className="flex flex-wrap items-center gap-2 p-0" aria-label="Pipeline stages">
        {PIPELINE_STAGES.map((s, i) => {
          const state = chipState(s.id);
          return (
            <li key={s.id} className="flex items-center gap-2">
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className="h-px w-4 bg-[color:var(--beta-border-strong)]"
                />
              )}
              <span className="beta-stage-chip" data-state={state}>
                <span className="beta-stage-dot" aria-hidden="true" />
                {s.label}
                {state === 'done' && <span aria-hidden="true">✓</span>}
                <span className="sr-only">
                  {state === 'done' ? ' complete' : state === 'active' ? ' in progress' : ' waiting'}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
