// Beta's canonical educational framing (spec 0005 guardrails child, AC-G14).
//
// The plan is the artifact a visitor keeps, scrolls back to, screenshots and
// sends to a climbing partner. It is the only part of Beta that travels, and
// it used to be the only surface whose framing depended on a model choosing
// to write a sentence: coach.md asked for it in the opening, so its wording
// varied and it could be dropped — and a guard-fallback plan, which discards
// the coach's prose entirely, would have carried no framing at all.
//
// So the page renders it instead of the model producing it. Present on the
// coach path and the guard fallback path alike, unrewordable, and it appears
// the moment the plan area does. The paired removal shipped with it: coach.md
// no longer asks for the sentence, so the number of educational statements a
// visitor meets did not increase.
//
// This is also the canonical wording the hero, footer, and case-study lines
// align to. It deliberately does NOT go near the specific safety copy — the
// red-flag card, the stop-conditions list, the cut-off warning, the four
// disclaimer-gate bullets. Those are precise and clinically meaningful in a
// way generic framing is not; where the two would sit together, the specific
// copy wins and this line is omitted.
/**
 * The stop conditions shown beside a finished plan.
 *
 * Hoisted out of BetaPlanner's JSX so the plan a visitor COPIES can carry
 * them too. They were inline, which meant they existed only on screen: a
 * plan pasted into notes had the doses and none of the reasons to stop.
 */
export const PLAN_STOP_CONDITIONS = [
  'new numbness or tingling',
  'pain that starts waking you at night',
  'a new pop or snap',
  'swelling that increases',
  'pain above 3 out of 10 that isn’t settling by the next morning, two sessions in a row',
] as const;

export const PLAN_STOP_CONDITIONS_HEADING =
  'Stop the plan and see a professional if any of these show up:';

/**
 * What "Copy plan" puts on the clipboard.
 *
 * NOT the raw plan text. The educational framing is rendered by the page and
 * `coach.md` forbids the model from writing a disclaimer itself, so the
 * framing cannot be inside `planText` — copying that alone produced an
 * unlabelled rehab protocol, which is precisely the artifact AC-G14 exists to
 * prevent. beta-copy's own note calls the plan "the only part of Beta that
 * travels"; the clipboard is a second way it travels, so it carries the same
 * context a screenshot does.
 */
export function buildPlanClipboardText(planText: string): string {
  return [
    PLAN_EDUCATIONAL_FRAMING,
    '',
    planText.trim(),
    '',
    PLAN_STOP_CONDITIONS_HEADING,
    ...PLAN_STOP_CONDITIONS.map((c) => `- ${c}`),
  ].join('\n');
}

export const PLAN_EDUCATIONAL_FRAMING =
  'This is an educational starting point, not medical advice, a diagnosis, or physical therapy.';
