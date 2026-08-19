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
 * A single cycling button rather than a three-way segmented control:
 * design.md's control vocabulary is text-first bracket buttons, and the
 * current value is always spelled out in the label, so the state is
 * readable without opening anything. It is a real <button>, so Enter and
 * Space work and the global `.terminal-theme :focus-visible` outline
 * gives it a visible focus ring.
 *
 * Renders a disabled placeholder until mounted. The server cannot know
 * the stored preference, so rendering the real label during SSR would
 * either mismatch on hydration or briefly show the wrong value; the
 * pre-paint script in the root layout has already applied the theme
 * itself, so only this label is deferred, never the colors.
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
      [ theme: {mounted ? LABEL[preference] : '…'} ]
    </button>
  );
}
