import { vi } from 'vitest';

/**
 * jsdom implements neither of these, and the planner uses both: it checks
 * `prefers-reduced-motion` before scrolling to the result, and scrolls the
 * result into view. Stubbed rather than worked around in the component,
 * because the behaviour is correct and it is the test environment that is
 * incomplete.
 *
 * Skipped entirely outside a browser environment. A route handler's tests run
 * on `node`, where there is no `window` to patch and reaching for one is a
 * crash before the first test.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}
