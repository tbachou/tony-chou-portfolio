import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BetaSseEvent } from '@/lib/beta-api';

/**
 * The guarantees that live in the planner shell rather than in the renderer.
 *
 * These exist because a predeploy review pointed out that the fix for one of
 * two MUST-FIX findings — "Copy plan" must not be offered on a plan the page
 * is telling you not to follow — was covered by nothing at all, so a revert
 * of that one condition would have shipped green.
 *
 * The api seam is mocked rather than the network: `streamBetaPlan` is an
 * async generator, so a test can hand the component an exact event sequence,
 * including the mid-stream failure that is otherwise hard to produce.
 */
const events: BetaSseEvent[] = [];
let streamThrowsAfter: number | null = null;
/** Resolve to let a held-open stream finish; leave pending to keep it running. */
let releaseStream: (() => void) | null = null;
let holdStreamOpen = false;

vi.mock('@/lib/beta-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/beta-api')>();
  return {
    ...actual,
    fetchBetaStatus: vi.fn(async () => ({ available: true, reason: 'ok' as const })),
    streamBetaPlan: async function* () {
      for (const [i, event] of events.entries()) {
        if (streamThrowsAfter !== null && i === streamThrowsAfter) {
          throw new Error('stream died mid-plan');
        }
        yield event;
      }
      if (holdStreamOpen) {
        // Mirrors the enforce-mode coach window: the plan is already painted
        // and the request is still open for several seconds.
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
        });
      }
    },
  };
});

const { BetaPlanner } = await import('./BetaPlanner');

const PLAN = [
  '## Stage 1: Calm and confirm',
  '',
  '**When:** Weeks 1-2',
  '',
  '**Do this:**',
  '- Tendon glides — 3 sets of 15',
].join('\n');

/** Walks the disclaimer gate and the form the way a visitor would. */
async function submitPlan() {
  render(<BetaPlanner />);
  // The gate is skipped when a previous acknowledgement is in localStorage,
  // which beforeEach clears — but tolerate either shape so the helper does
  // not depend on that ordering.
  const gate = screen.queryByRole('button', { name: /I understand/i });
  gate?.click();

  const form = await screen.findByRole('button', { name: /Draft my plan/i });
  for (const name of ['injuryArea', 'painBehavior', 'discipline']) {
    const radio = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    radio?.click();
  }
  const setNative = (el: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document
    .querySelectorAll<HTMLInputElement>('input[type="number"]')
    .forEach((el) => setNative(el, '9'));
  document
    .querySelectorAll<HTMLInputElement>('input[type="text"]')
    .forEach((el) => setNative(el, 'V5'));
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();

  form.click();
}

beforeEach(() => {
  events.length = 0;
  streamThrowsAfter = null;
  holdStreamOpen = false;
  releaseStream = null;
  // The planner remembers the disclaimer acknowledgement, so without this a
  // later test inherits the gate state of an earlier one.
  localStorage.clear();
});
afterEach(cleanup);

describe('Copy plan', () => {
  it('is offered on a finished plan', async () => {
    events.push(
      { type: 'status', stage: 'coaching' },
      { type: 'plan_delta', text: PLAN },
      { type: 'done' },
    );
    await submitPlan();

    const copy = await screen.findByRole('button', { name: /Copy plan/i });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
  });

  it('is NOT offered on a cut-off plan', async () => {
    // The page tells this visitor "don't follow a partial plan". Copying it
    // would carry the plan without the warning, which lives in a sibling
    // card and is not part of the copied text.
    events.push(
      { type: 'status', stage: 'coaching' },
      { type: 'plan_delta', text: PLAN },
      { type: 'done' },
    );
    streamThrowsAfter = 2; // dies after the plan text, before 'done'
    await submitPlan();

    await screen.findByText(/cut off before it finished/i);
    const copy = screen.getByRole('button', { name: /Copy plan/i });
    expect((copy as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the pipeline chips', () => {
  it('stay while generation is still running, even once plan text exists', async () => {
    // Under `enforce` the api paints the whole validated plan BEFORE the
    // coach runs, then buffers the coach for a measured p50 of 8.5s. Hiding
    // the chips as soon as any text arrived left that entire window with no
    // sign anything was still happening.
    //
    // The assertion order matters: wait for the PLAN first, then check the
    // chips synchronously. Asserting the chips with a retrying query passes
    // either way, because it catches the moment before the plan arrives.
    holdStreamOpen = true;
    events.push({ type: 'status', stage: 'coaching' }, { type: 'plan_delta', text: PLAN });
    await submitPlan();

    await waitFor(() => expect(screen.getAllByRole('term').length).toBeGreaterThan(0));
    expect(screen.getByRole('list', { name: /Pipeline stages/i })).toBeTruthy();

    releaseStream?.();
  });

  it('go once the plan is finished', async () => {
    events.push(
      { type: 'status', stage: 'coaching' },
      { type: 'plan_delta', text: PLAN },
      { type: 'done' },
    );
    await submitPlan();

    await screen.findByRole('button', { name: /Copy plan/i });
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: /Pipeline stages/i })).toBeNull(),
    );
  });
});
