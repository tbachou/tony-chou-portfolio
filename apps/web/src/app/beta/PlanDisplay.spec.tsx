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
 * beta-output-guard.ts). Duplicated as a fixture because the web app is a
 * separate workspace and does not depend on the api; if that renderer's
 * OUTPUT SHAPE changes, this fixture must change with it. The point being
 * asserted is that the guard's substituted plan renders through exactly the
 * same component, so the framing reaches an enforce-mode visitor too.
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
  /** Everything the parser produces, flattened to comparable text. */
  function renderedText(text: string): string {
    const { intro, sections, outro } = parsePlan(text);
    const blockText = (blocks: { kind: string; text?: string; items?: string[] }[]) =>
      blocks.map((b) => (b.kind === 'p' ? b.text : (b.items ?? []).join(' '))).join(' ');
    return [
      blockText(intro),
      ...sections.map((s) => `${s.title} ${blockText(s.blocks)}`),
      blockText(outro),
    ].join(' ');
  }

  it('never drops content at any streaming prefix', () => {
    // The plan renders on every chunk, so every prefix is a state a visitor
    // can see. Losing a dose or a caution mid-stream is the failure that
    // matters; a prefix rendering imperfectly is not.
    const dropped: number[] = [];
    for (let i = 1; i <= COACH_PLAN.length; i += 1) {
      const prefix = COACH_PLAN.slice(0, i);
      const out = renderedText(prefix);
      // Every non-marker word in the prefix must survive into the output.
      const words = prefix
        .replace(/[*#-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3);
      if (!words.every((w) => out.includes(w))) dropped.push(i);
    }
    expect(dropped).toEqual([]);
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
