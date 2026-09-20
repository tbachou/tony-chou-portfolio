/**
 * The educational disclaimer a visitor must acknowledge before the form
 * becomes reachable (spec 0004 AC-3).
 *
 * Pure copy plus one callback. The acknowledgement is persisted by the
 * caller, so nothing here touches storage and nothing here holds state.
 */
export function DisclaimerGate({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div className="beta-card p-6 sm:p-8">
      {/* Two columns from md up: the statement on the left, the specific
          cautions on the right. Stacked, the card spanned the planner
          column while every line inside stopped at its own measure, so
          the right ~40% of a solid white card sat empty. The split uses
          that width instead of capping the card, which the page
          deliberately does not do to any of its cards. */}
      <div className="grid gap-6 md:grid-cols-2 md:gap-10">
        <div>
          <h3 className="text-[length:var(--beta-text-xl)]">Before you start</h3>
          <p className="mt-4 beta-measure">
            Beta drafts <strong className="font-semibold text-[color:var(--beta-ink)]">educational</strong>{' '}
            return-to-climbing plans. It is not medical advice, a diagnosis, or physical
            therapy, and it has never met your finger.
          </p>
        </div>
        <ul className="space-y-2 beta-measure">
          {[
            'It draws on common rehab patterns for three well-studied climbing injuries — nothing here is tailored by an examination.',
            'Warning-sign symptoms are hard-blocked: if you report one, Beta stops and points you to a professional instead of drafting a plan.',
            'It assumes a healthy adult. If you are under 18 (finger pain in young climbers can involve the growth plate), pregnant, diabetic, have an inflammatory condition, recently took fluoroquinolone antibiotics, or had surgery on this limb — see a professional instead of using a generic plan.',
            'If anything is getting worse week over week, skip this tool and see a physical therapist or sports-medicine doctor.',
          ].map((item) => (
            <li key={item} className="flex gap-2.5">
              <span
                aria-hidden="true"
                className="mt-[0.6em] h-1.5 w-1.5 flex-none rounded-full bg-[color:var(--beta-accent)]"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Same button-plus-hint row as the hero's CTA. */}
      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
        <button type="button" onClick={onAcknowledge} className="beta-btn beta-btn-primary">
          I understand — draft me a plan
        </button>
        <p className="beta-hint">
          Nothing you type into the planner is stored — the form clears when you leave.
        </p>
      </div>
    </div>
  );
}
