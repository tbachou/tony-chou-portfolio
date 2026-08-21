import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_EDUCATIONAL_FRAMING } from '@/lib/beta-copy';
import { PlanDisplay, parsePlan } from './PlanDisplay';

afterEach(cleanup);

/**
 * A well formed coach plan, in the shape `coach.md` specifies.
 */
const COACH_PLAN = [
  'Rebuilding after nine weeks of stiffness is doable. Here is your way back.',
  '',
  '## Stage 1: Confirm you are ready',
  '',
  '**When:** Days 1-5',
  '',
  '**Climbing:** No climbing yet.',
  '',
  '**Do this:**',
  '- Tendon glides — 3 sets of 15, 7 times a week',
  '',
  '**Move on when:**',
  '- Morning stiffness resolves within 10 minutes of waking',
  '',
  'Pain that stays constant even at rest, and has not clearly improved by',
  'about three weeks from when it started, deserves a professional assessment.',
].join('\n');

/**
 * The shape `renderPlanFallback` emits (apps/api/src/modules/beta/
 * beta-output-guard.ts): all four contract labels, and a closing paragraph
 * carrying the drafter's plan-wide `overallCaution`.
 *
 * Duplicated as a fixture because the web app is a separate workspace and
 * does not depend on the api. It had drifted on day one — missing both
 * `Move on when:` and the closing caution — while claiming to track the
 * renderer, so it proved only that the framing rendered above SOME markdown.
 * The assertions below are now shape dependent, so a fixture that stops
 * matching the renderer fails here rather than passing quietly.
 */
const FALLBACK_SHAPED_PLAN = [
  'Here is your staged plan.',
  '',
  '## Stage 1: Calm and confirm',
  '',
  '**When:** Weeks 1-2',
  '',
  '**Climbing:** No climbing yet.',
  '',
  '**Do this:**',
  '- Isometric wrist flexion hold — 3 sets of 1, holding 20 seconds',
  '',
  '**Move on when:**',
  '- Pain settles within 24 hours of a session',
  '',
  'Pain that stays constant even at rest, and has not clearly improved by about',
  'three weeks from when it started, deserves a professional assessment. This plan',
  'is educational and is not a substitute for an assessment.',
].join('\n');

describe('the educational framing (AC-G14)', () => {
  // The framing is the one string the page must render itself, because the
  // model is forbidden from writing it. Both paths a visitor can land on are
  // asserted, since enforce mode can substitute the guard's plan silently.
  it.each([
    ['a coach plan', COACH_PLAN],
    ['the guard fallback shape', FALLBACK_SHAPED_PLAN],
  ])('renders above %s', (_label, text) => {
    render(<PlanDisplay text={text} streaming={false} />);
    expect(screen.getByText(PLAN_EDUCATIONAL_FRAMING)).toBeTruthy();
  });

  it('renders the guard fallback with all four contract labels and its caution', () => {
    // Shape dependent on purpose: the framing <p> renders unconditionally, so
    // a fixture-only assertion would pass with text={''} and prove nothing
    // about the fallback path.
    render(<PlanDisplay text={FALLBACK_SHAPED_PLAN} streaming={false} />);
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual([
      'When:',
      'Climbing:',
      'Do this:',
      'Move on when:',
    ]);
    // The drafter's plan-wide caution must sit OUTSIDE the stage grid.
    const lists = screen.getAllByRole('list');
    for (const list of lists) {
      expect(within(list).queryByText(/deserves a professional assessment/)).toBeNull();
    }
    expect(screen.getByText(/deserves a professional assessment/)).toBeTruthy();
  });

  it('renders even while the plan is still streaming and nearly empty', () => {
    render(<PlanDisplay text={'Rebuilding after nine'} streaming />);
    expect(screen.getByText(PLAN_EDUCATIONAL_FRAMING)).toBeTruthy();
  });
});

describe('stage labels', () => {
  it('pairs each label with its own content', () => {
    render(<PlanDisplay text={COACH_PLAN} streaming={false} />);
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['When:', 'Climbing:', 'Do this:', 'Move on when:']);
  });

  it('splits labels the coach ran together without a blank line', () => {
    // Joined into one paragraph, only the FIRST used to be seen as a label,
    // so the climbing allowance was filed under the timing term and the <dl>
    // then asserted that pairing to a screen reader.
    const runTogether = [
      '## Stage 2: Load it',
      '**When:** Weeks 3-5',
      '**Climbing:** Easy jugs only, nothing overhanging.',
    ].join('\n');
    render(<PlanDisplay text={runTogether} streaming={false} />);
    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['When:', 'Climbing:']);

    const climbing = screen.getAllByRole('definition')[1];
    expect(climbing.textContent).toContain('Easy jugs only');
  });

  it('does NOT make a stray sentence the description of the label above it', () => {
    // The failure this guards: "Stop immediately if you feel a sharp pop."
    // rendering as the meaning of the term "When".
    const withStray = [
      '## Stage 2: Load it',
      '',
      '**When:** Weeks 3-5',
      '',
      'Stop immediately if you feel a sharp pop.',
      '',
      '**Climbing:** Easy jugs only.',
    ].join('\n');
    render(<PlanDisplay text={withStray} streaming={false} />);

    const when = screen.getAllByRole('definition')[0];
    expect(when.textContent).toContain('Weeks 3-5');
    expect(when.textContent).not.toContain('sharp pop');
    // Still on screen, just as its own paragraph rather than a definition.
    expect(screen.getByText(/Stop immediately if you feel a sharp pop/)).toBeTruthy();
  });

  it('keeps a same-line sentence out of the label it follows', () => {
    // The half of the stray-sentence fix that was missed first time: when the
    // coach omits the blank line, the sentence used to be concatenated INTO
    // the label's value, so the <dl> claimed it was the meaning of "When".
    const sameLine = [
      '## Stage 2: Load it',
      '**When:** Weeks 3-5',
      'Stop immediately if you feel a sharp pop.',
    ].join('\n');
    render(<PlanDisplay text={sameLine} streaming={false} />);

    const when = screen.getAllByRole('definition')[0];
    expect(when.textContent).toContain('Weeks 3-5');
    expect(when.textContent).not.toContain('sharp pop');
    expect(screen.getByText(/Stop immediately if you feel a sharp pop/)).toBeTruthy();
  });

  it('does not promote a non-contract bolded lead-in into the grid', () => {
    // A plan-wide caution written with a bolded lead-in used to become a term
    // inside the FINAL stage, reading as an attribute of weeks 8-12.
    const closing = [
      '## Stage 3: Back to the wall',
      '',
      '**When:** Weeks 8-12',
      '',
      '**One last thing:** if pain returns at any point, drop back a stage and see a professional.',
    ].join('\n');
    render(<PlanDisplay text={closing} streaming={false} />);

    const terms = screen.getAllByRole('term').map((t) => t.textContent);
    expect(terms).toEqual(['When:']);
    // Still rendered, just as prose rather than a stage attribute.
    expect(screen.getByText(/if pain returns at any point/)).toBeTruthy();
  });

  it('leaves a bold-crossing line as prose rather than a mangled term', () => {
    // `.+?` used to cross the bold markers and produce the term
    // "Do this** every day, and **stop when", printing raw asterisks.
    const crossing = [
      '## Stage 1: Start',
      '',
      '**Do this** every day, and **stop when:** it hurts',
    ].join('\n');
    render(<PlanDisplay text={crossing} streaming={false} />);
    expect(screen.queryAllByRole('term')).toHaveLength(0);
    expect(screen.getByText(/every day, and/)).toBeTruthy();
  });
});

describe('streaming safety', () => {
  /**
   * Everything the visitor can actually SEE, read off the rendered DOM.
   *
   * This used to call `parsePlan` and flatten its block tree, which never
   * rendered the component — so `toSegments` and `StageBody`, the whole
   * reason this file exists, were outside its reach. Three mutations to those
   * functions survived the suite green: dropping orphan lists, never
   * attaching a list to its label, and making the row lookup search backwards
   * (which reinstates the misfiling the rewrite was written to kill).
   */
  function renderedText(text: string): string {
    const { container, unmount } = render(<PlanDisplay text={text} streaming={false} />);
    const out = container.textContent ?? '';
    unmount();
    return out;
  }

  // Whole lines, not words. The old check filtered to tokens longer than
  // three characters, which skips every number: a dropped "3 sets of 15" was
  // verified only for the word "sets".
  const LINES_THAT_MUST_SURVIVE = [
    'Tendon glides — 3 sets of 15, 7 times a week',
    'Morning stiffness resolves within 10 minutes of waking',
    'deserves a professional assessment',
  ];

  it('renders every dose and criterion line of a complete plan', () => {
    const out = renderedText(COACH_PLAN);
    for (const line of LINES_THAT_MUST_SURVIVE) expect(out).toContain(line);
  });

  it('never drops content at any streaming prefix', () => {
    // The plan paints on every chunk, so each prefix is a state a visitor can
    // see. Each line is asserted from the prefix at which it is FULLY present
    // onward, so a partially-arrived line is not counted against the parser.
    const missing: string[] = [];
    for (let i = 1; i <= COACH_PLAN.length; i += 1) {
      const prefix = COACH_PLAN.slice(0, i);
      const out = renderedText(prefix);
      for (const line of LINES_THAT_MUST_SURVIVE) {
        if (prefix.includes(line) && !out.includes(line)) missing.push(`${i}: ${line}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('attaches a bullet list to the label above it', () => {
    // Guards the pairing the <dl> exists for. Without it "Do this:" renders an
    // empty description and its exercises fall outside the list entirely.
    render(<PlanDisplay text={COACH_PLAN} streaming={false} />);
    const defs = screen.getAllByRole('definition');
    const doThis = defs[2];
    expect(doThis.textContent).toContain('Tendon glides');
  });

  it('keeps an orphan list on screen and out of the labels above it', () => {
    // A list with no label before it must render as itself, not vanish and
    // not be adopted by an earlier term.
    const orphan = [
      '## Stage 1: Start',
      '',
      '**When:** Days 1-5',
      '',
      'Watch for these while you work:',
      '',
      '- Ice after any provocation',
    ].join('\n');
    render(<PlanDisplay text={orphan} streaming={false} />);
    expect(screen.getByText(/Ice after any provocation/)).toBeTruthy();
    const when = screen.getAllByRole('definition')[0];
    expect(when.textContent).not.toContain('Ice after any provocation');
  });

  it('keeps the closing caution out of the stage grid', () => {
    // The plan-wide caution applies from today, not from the final stage. If
    // it were pulled into a stage's label grid it would read as an attribute
    // of weeks 8-12.
    render(<PlanDisplay text={COACH_PLAN} streaming={false} />);
    const lists = screen.getAllByRole('list');
    for (const list of lists) {
      expect(within(list).queryByText(/deserves a professional assessment/)).toBeNull();
    }
    expect(screen.getByText(/deserves a professional assessment/)).toBeTruthy();
  });
});
