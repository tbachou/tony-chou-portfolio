/**
 * Theme preference for the portfolio (terminal) surface.
 *
 * Three states, not two: 'light' and 'dark' are explicit user choices,
 * 'system' means "follow prefers-color-scheme" and is also what a visitor
 * who has never chosen gets. 'system' is stored explicitly so that
 * choosing it again after picking dark is a real, persisted decision
 * rather than an absence of one.
 *
 * Beta (`/beta`) is deliberately excluded — it has its own fixed
 * daylight identity, scoped under `.beta-theme` in `src/app/beta/beta.css`.
 */

export const THEME_STORAGE_KEY = 'tc-portfolio-theme';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/**
 * Applies a preference to <html>.
 *
 * Only explicit choices stamp `data-theme`; 'system' removes the
 * attribute so the `prefers-color-scheme` media query in terminal.css
 * takes over. That media query is written as
 * `:root:not([data-theme='dark'])`, so the absence of the attribute is a
 * meaningful state and not just a fallback.
 */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
}

/**
 * Inlined into <head> and run synchronously before first paint, so the
 * stored theme is on <html> before any pixels are drawn. Anything that
 * waits for React (hydration, useEffect, a client provider) is too late
 * and produces a flash of the wrong theme.
 *
 * Kept dependency-free and wrapped in try/catch: localStorage throws in
 * Safari private mode and under some cookie-blocking settings, and an
 * uncaught throw here would abort the rest of the document's parsing.
 * Falls through to the system preference on any failure.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(p==='light'||p==='dark'){document.documentElement.setAttribute('data-theme',p);}else{document.documentElement.removeAttribute('data-theme');}}catch(e){}})();`;
