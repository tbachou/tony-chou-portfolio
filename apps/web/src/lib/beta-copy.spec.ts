import { describe, expect, it } from 'vitest';
import {
  PLAN_EDUCATIONAL_FRAMING,
  PLAN_PACING_RULE,
  PLAN_STOP_CONDITIONS,
  PLAN_STOP_CONDITIONS_HEADING,
  buildPlanClipboardText,
} from './beta-copy';

/**
 * The framing is pinned as a LITERAL, mirroring how apps/api snapshots its
 * clinical copy byte for byte.
 *
 * Every other assertion in this file compares the rendering against the
 * constant, so both sides move together: setting the constant to "Have fun
 * out there!" left the page with no disclaimer and the clipboard opening with
 * that above a rehab protocol, and the whole suite stayed green. The
 * guarantee was "the page renders whatever the constant says", not "the page
 * renders a disclaimer". This is the line that makes it the latter.
 */
describe('the framing string itself', () => {
  it('is the audited wording, byte for byte', () => {
    expect(PLAN_EDUCATIONAL_FRAMING).toBe(
      'This is an educational starting point, not medical advice, a diagnosis, or physical therapy.',
    );
  });

  it('names all three things Beta is not', () => {
    // Rewording is a clinical decision, but silently dropping one of the
    // three denials is the failure mode worth its own assertion.
    for (const denial of ['not medical advice', 'a diagnosis', 'physical therapy']) {
      expect(PLAN_EDUCATIONAL_FRAMING).toContain(denial);
    }
  });
});

/**
 * What "Copy plan" puts on the clipboard.
 *
 * These exist because the first version of that button copied `planText`
 * alone. The framing is rendered by the page and `coach.md` forbids the model
 * from writing a disclaimer, so it cannot be inside `planText`: the copy was a
 * bare rehab protocol with no "not medical advice" and no stop conditions,
 * which is exactly the artifact AC-G14 exists to prevent. It was caught by a
 * predeploy review rather than by anything automated, because nothing tested
 * this layer at all.
 */

describe('buildPlanClipboardText', () => {
  const plan = [
    'Rebuilding your finger pulley is doable. Here is your way back.',
    '',
    '## Stage 1: Confirm you are ready',
    '',
    '**When:** Days 1-5',
    '',
    '**Do this:**',
    '- Tendon glides — 3 sets of 15, 7 times a week',
  ].join('\n');

  it('opens with the educational framing', () => {
    // First, not merely present: a reader who stops after one line still gets
    // the disclaimer rather than a dose.
    expect(buildPlanClipboardText(plan).startsWith(PLAN_EDUCATIONAL_FRAMING)).toBe(true);
  });

  it('carries the plan body unchanged', () => {
    expect(buildPlanClipboardText(plan)).toContain('## Stage 1: Confirm you are ready');
    expect(buildPlanClipboardText(plan)).toContain('Tendon glides — 3 sets of 15');
  });

  it('carries every stop condition, which otherwise exist only on screen', () => {
    const text = buildPlanClipboardText(plan);
    expect(text).toContain(PLAN_STOP_CONDITIONS_HEADING);
    for (const condition of PLAN_STOP_CONDITIONS) {
      expect(text).toContain(condition);
    }
    // The count is asserted too: a condition quietly dropped from the constant
    // would still pass the loop above.
    expect(PLAN_STOP_CONDITIONS).toHaveLength(5);
  });

  it('carries the pacing rule, which governs every dose in the body', () => {
    expect(buildPlanClipboardText(plan)).toContain(PLAN_PACING_RULE);
  });

  it('never returns the raw plan text on its own', () => {
    // The regression in one line: if someone reverts to writeText(planText),
    // this is what fails.
    expect(buildPlanClipboardText(plan)).not.toBe(plan);
    expect(buildPlanClipboardText(plan).length).toBeGreaterThan(plan.length);
  });
});
