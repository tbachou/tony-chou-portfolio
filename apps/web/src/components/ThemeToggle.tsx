'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyThemePreference,
  isThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference
} from '@/lib/theme';

const NEXT_PREFERENCE: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system'
};

const LABEL: Record<ThemePreference, string> = {
  system: 'auto',
  light: 'light',
  dark: 'dark'
};

/**
 * Glyphs for the three states, as inline SVG rather than emoji or an icon
 * font: emoji would drop a colour picture into a monochrome monospace nav,
 * and these are stroked/filled with `currentColor` so they inherit the
 * button's `text-term-muted` → `text-term-ink` hover exactly the way the
 * bracket text next to them does. No colour is named here; the palette
 * still owns every value.
 *
 * `system` gets its own glyph on purpose. The preference is three-state —
 * auto is a real, persisted choice distinct from an explicit light or dark
 * that happens to match the OS — so a sun/moon pair alone would not be able
 * to express it, and collapsing to two would stop the site following the OS
 * for anyone who never chose. The half-filled disc is the conventional
 * "automatic / follows the environment" mark and is the one shape that
 * survives at 1em in a monospace row.
 */
function ThemeGlyph({ preference }: { preference: ThemePreference }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      aria-hidden="true"
      focusable="false"
      className="inline-block align-[-0.125em]"
    >
      {preference === 'light' && (
        <>
          <circle cx="8" cy="8" r="3.1" />
          <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.45 1.45M11.5 11.5l1.45 1.45M12.95 3.05L11.5 4.5M4.5 11.5l-1.45 1.45" />
        </>
      )}
      {preference === 'dark' && <path d="M14 8.53A6 6 0 1 1 7.47 2 4.67 4.67 0 0 0 14 8.53z" />}
      {preference === 'system' && (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
  } catch {
    // localStorage unavailable (private mode, blocked cookies) — follow the OS.
  }
  return 'system';
}

/**
 * Cycles theme: auto → light → dark → auto.
 *
 * A single cycling button rather than a three-way segmented control. It is
 * a real <button>, so Enter and Space work and the global
 * `.terminal-theme :focus-visible` outline gives it a visible focus ring.
 *
 * The current state shows as a glyph inside the nav's bracket idiom
 * (`[ ☾ ]`) rather than spelled out. The spelled-out version
 * (`[ theme: light ]`) was 117px wide and pushed the nav's single row to
 * 930px against a 896px `max-w-4xl` container, so it wrapped to two rows
 * at every viewport width; the glyph is ~45px and puts the row back under
 * the cap with room to spare. The words are not lost, only moved: the
 * `aria-label` still reads the full "Color theme preference: auto
 * (currently dark). Activate to switch to light.", and the `title` gives
 * sighted mouse users the same thing on hover. That trade is the one thing
 * to revisit if this ever reads as ambiguous — an icon alone cannot say
 * whether it means "is light" or "go to light", and only the tooltip
 * disambiguates it.
 *
 * Renders a disabled placeholder until mounted. The server cannot know
 * the stored preference, so rendering the real glyph during SSR would
 * either mismatch on hydration or briefly show the wrong value; the
 * pre-paint script in the root layout has already applied the theme
 * itself, so only this glyph is deferred, never the colors. The
 * placeholder is a bare ring — same 1em box as the three real glyphs, so
 * nothing in the row shifts when it resolves, and not a lie about which
 * state is active.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [mounted, setMounted] = useState(false);
  const [systemIsDark, setSystemIsDark] = useState(true);

  useEffect(() => {
    setPreference(readStoredPreference());
    setMounted(true);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemIsDark(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const cycle = useCallback(() => {
    setPreference((current) => {
      const next = NEXT_PREFERENCE[current];
      applyThemePreference(next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Non-persistent is still better than non-functional.
      }
      return next;
    });
  }, []);

  const resolved = preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference;
  const nextLabel = LABEL[NEXT_PREFERENCE[preference]];

  return (
    <button
      type="button"
      onClick={cycle}
      disabled={!mounted}
      aria-label={
        mounted
          ? // "preference", not "theme": in auto the button announces the
            // resolved appearance too, and picking explicit light while auto
            // already resolves to light is a real change of preference even
            // though nothing on screen moves.
            `Color theme preference: ${LABEL[preference]}${
              preference === 'system' ? ` (currently ${resolved})` : ''
            }. Activate to switch to ${nextLabel}.`
          : 'Color theme preference'
      }
      title={`Theme: ${LABEL[preference]} — click for ${nextLabel}`}
      className="text-term-muted transition-colors duration-term-instant hover:text-term-ink"
    >
      <span aria-hidden="true">[ </span>
      {mounted ? (
        <ThemeGlyph preference={preference} />
      ) : (
        <svg
          viewBox="0 0 16 16"
          width="1em"
          height="1em"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.4}
          aria-hidden="true"
          focusable="false"
          className="inline-block align-[-0.125em]"
        >
          <circle cx="8" cy="8" r="6" />
        </svg>
      )}
      <span aria-hidden="true"> ]</span>
    </button>
  );
}
