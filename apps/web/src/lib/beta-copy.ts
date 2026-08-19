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
export const PLAN_EDUCATIONAL_FRAMING =
  'This is an educational starting point, not medical advice, a diagnosis, or physical therapy.';
