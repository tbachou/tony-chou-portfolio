import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BetaPlanPayload, BetaSseEvent } from '@/lib/beta-api';

/**
 * CHARACTERIZATION tests for the planner's focus and ARIA wiring, written
 * before the render tree is split into components.
 *
 * The split moves JSX across module boundaries that `aria-describedby` chains
 * and focus refs currently cross. Those break silently — nothing throws,
 * nothing looks wrong, a screen reader simply stops announcing something — and
 * a repo sweep found this behaviour almost entirely uncovered while calling
 * accessibility the codebase's strongest area. Strong is not the same as
 * covered.
 *
 * These assert what the component DOES today. A failure after the extraction
 * means the extraction changed behaviour; that is the only thing they report.
 * Where today's behaviour looks odd it is recorded rather than corrected.
 */

const events: BetaSseEvent[] = [];
let holdStreamOpen = false;
let releaseStream: (() => void) | null = null;

vi.mock('@/lib/beta-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/beta-api')>();
  return {
    ...actual,
    fetchBetaStatus: vi.fn(async () => ({ available: true, reason: 'ok' as const })),
    streamBetaPlan: async function* (_payload: BetaPlanPayload) {
      for (const event of events) yield event;
      if (holdStreamOpen) {
        await new Promise<void>((resolve) => {
          releaseStream = resolve;
        });
      }
    },
  };
});

const { BetaPlanner } = await import('./BetaPlanner');

/** Renders past the disclaimer gate without filling anything in. */
async function renderForm() {
  render(<BetaPlanner />);
  screen.queryByRole('button', { name: /I understand/i })?.click();
  return screen.findByRole('button', { name: /Draft my plan/i });
}

/** Fills every required control, so a submit reaches the api. */
function fillValidly() {
  for (const name of ['injuryArea', 'painBehavior', 'discipline']) {
    document.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.click();
  }
  const setNative = (el: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
      el,
      value,
    );
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document
    .querySelectorAll<HTMLInputElement>('input[type="number"]')
    .forEach((el) => setNative(el, '9'));
  document
    .querySelectorAll<HTMLInputElement>('input[type="text"]')
    .forEach((el) => setNative(el, 'V5'));
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
}

beforeEach(() => {
  events.length = 0;
  holdStreamOpen = false;
  releaseStream = null;
  localStorage.clear();
});
afterEach(cleanup);

describe('the disclaimer gate', () => {
  it('keeps the form out of the accessibility tree until acknowledged', () => {
    render(<BetaPlanner />);
    // jest-dom is not configured in this project, so assertions stay plain.
    expect(screen.queryByRole('button', { name: /Draft my plan/i })).toBeNull();
  });

  it('reveals the form once acknowledged', async () => {
    await renderForm();
    expect(screen.getByRole('button', { name: /Draft my plan/i })).toBeTruthy();
  });
});

describe('a failed submit', () => {
  it('moves focus to the error summary', async () => {
    const submit = await renderForm();
    submit.click();

    await waitFor(() => {
      const summary = document.querySelector('.beta-error-summary');
      expect(summary).not.toBeNull();
      // Focus is the delivery mechanism here, not the roles: a live region
      // inserted already-populated is announced inconsistently.
      expect(document.activeElement).toBe(summary);
    });
  });

  it('gives the focused summary a tabindex it did not have in the markup', async () => {
    const submit = await renderForm();
    submit.click();

    await waitFor(() => {
      const summary = document.querySelector('.beta-error-summary');
      // focusContainer applies tabindex for the duration of the focus. A
      // permanent one would make the summary the nearest focusable ancestor
      // of everything inside it.
      expect(summary?.getAttribute('tabindex')).toBe('-1');
    });
  });

  it('lists an anchor link per errored field', async () => {
    const submit = await renderForm();
    submit.click();

    await waitFor(() => {
      const links = document.querySelectorAll('.beta-error-summary a[href^="#"]');
      expect(links.length).toBeGreaterThan(0);
    });
  });

  it('points each anchor at an element that exists', async () => {
    const submit = await renderForm();
    submit.click();

    await waitFor(() => {
      const links = Array.from(
        document.querySelectorAll<HTMLAnchorElement>(
          '.beta-error-summary a[href^="#"]',
        ),
      );
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const id = link.getAttribute('href')!.slice(1);
        expect(document.getElementById(id), `anchor #${id} has no target`).not.toBeNull();
      }
    });
  });

  it('marks every errored control aria-invalid', async () => {
    const submit = await renderForm();
    submit.click();

    await waitFor(() => {
      expect(
        document.querySelectorAll('[aria-invalid="true"]').length,
      ).toBeGreaterThan(0);
    });
  });

  it('points each errored control at its own error text through aria-describedby', async () => {
    const submit = await renderForm();
    submit.click();

    await waitFor(() => {
      const invalid = Array.from(
        document.querySelectorAll<HTMLElement>('[aria-invalid="true"]'),
      );
      expect(invalid.length).toBeGreaterThan(0);
      for (const control of invalid) {
        const described = control.getAttribute('aria-describedby');
        expect(described, 'an invalid control described nothing').toBeTruthy();
        // Every id in the chain must resolve. A split that moves the error
        // text into another component without moving the id breaks exactly
        // here, and nowhere visible.
        for (const id of described!.split(/\s+/)) {
          expect(document.getElementById(id), `describedby #${id} missing`).not.toBeNull();
        }
      }
    });
  });
});

describe('the result region', () => {
  it('labels the pipeline chips and names the progress heading for screen readers', async () => {
    events.push({ type: 'status', stage: 'screening' } as BetaSseEvent);
    holdStreamOpen = true;

    const submit = await renderForm();
    fillValidly();
    submit.click();

    await waitFor(() => {
      const list = document.querySelector('ol[aria-label="Pipeline stages"]');
      expect(list).not.toBeNull();
      // The heading is sr-only, so it exists for the tree and not the eye.
      const heading = Array.from(document.querySelectorAll('h3')).find(
        (h) => h.textContent === 'Plan generation progress',
      );
      expect(heading?.className).toContain('sr-only');
    });
    releaseStream?.();
  });

  it('announces a red flag through a focused container, not a live region alone', async () => {
    events.push({
      type: 'red_flag',
      category: 'sudden_pop_with_swelling',
      message: 'Please see a hand therapist.',
    } as BetaSseEvent);

    const submit = await renderForm();
    fillValidly();
    submit.click();

    await waitFor(() => {
      // The red-flag card carries role="status" AND takes focus: the roles
      // are the backstop, focus is the delivery path.
      const card = document.querySelector('.beta-card--error-edge[role="status"]');
      expect(card).not.toBeNull();
      expect(document.activeElement).toBe(card);
    });
  });
});

describe('the live region carrying stage announcements', () => {
  it('exists and is polite, and never carries the streamed plan text', async () => {
    const submit = await renderForm();
    submit.click();

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live).not.toBeNull();
      // Streamed tokens are deliberately kept out: a live region wrapping
      // them would re-read the whole plan on every token.
      expect(live?.textContent ?? '').not.toContain('Stage 1');
    });
  });
});
