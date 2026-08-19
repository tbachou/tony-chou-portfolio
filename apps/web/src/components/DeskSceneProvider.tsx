'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';

const DeskScene = dynamic(() => import('./DeskScene'), { ssr: false });

type Phase = 'desk' | 'site';

const DeskSceneContext = createContext<{
  /**
   * Enter the 3D scene. Pass the control that triggered it — leaving the
   * scene hands focus back to it, so a keyboard or screen-reader visitor
   * resumes where they left off instead of at the top of the document.
   */
  reenter: (trigger?: HTMLElement | null) => void;
} | null>(null);

export function useDeskScene() {
  const ctx = useContext(DeskSceneContext);
  if (!ctx) {
    throw new Error('useDeskScene must be used within DeskSceneProvider');
  }
  return ctx;
}

// The 3D scene used to gate every first visit behind a click-to-boot
// interaction before any real content was reachable - real friction for a
// portfolio whose job is to get a busy visitor to actual content fast.
// It's demoted to opt-in now: the site loads straight to `children`, and the
// scene is only ever reached by explicitly asking for it via `reenter()`.
export function DeskSceneProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('site');
  const [deskInitialPhase, setDeskInitialPhase] = useState<'idle' | 'exiting'>('idle');
  // Entering the scene unmounts `children`, which destroys both focus
  // (activeElement falls back to <body>) and scroll offset (the document
  // collapses to viewport height, so the browser clamps scrollY to 0).
  // Both are captured on the way in and replayed on the way out.
  const triggerRef = useRef<HTMLElement | null>(null);
  const scrollYRef = useRef(0);
  const shouldRestoreRef = useRef(false);

  // Direct navigation to a hash link (e.g. /#projects) needs its target to
  // already be in the DOM before the browser's own hash-scroll-on-navigation
  // runs, or it silently lands at the top instead. Content mounts
  // immediately now, but keep this as a defensive scroll-on-mount in case
  // that ever changes again.
  useEffect(() => {
    if (phase !== 'site') return;
    if (!window.location.hash) return;
    document.querySelector(window.location.hash)?.scrollIntoView();
  }, [phase]);

  // Runs after `children` have remounted and laid out, so the document is
  // tall enough for the scroll offset to be valid again. Declared after the
  // hash effect above so it wins if both fire on the same commit.
  useEffect(() => {
    if (phase !== 'site' || !shouldRestoreRef.current) return;
    shouldRestoreRef.current = false;
    const trigger = triggerRef.current;
    triggerRef.current = null;
    // Instant, never smooth: this is restoring a position the visitor never
    // asked to leave, not a navigation, and prefers-reduced-motion visitors
    // skip the camera lerp for the same reason.
    window.scrollTo({ top: scrollYRef.current, behavior: 'auto' });
    // No preventScroll — if the offset above landed correctly the element is
    // already in view and focusing is a no-op; if layout shifted, the browser
    // corrects rather than leaving focus off screen.
    trigger?.focus();
  }, [phase]);

  function handleZoomInComplete() {
    setPhase('site');
  }

  function reenter(trigger?: HTMLElement | null) {
    triggerRef.current = trigger ?? null;
    scrollYRef.current = window.scrollY;
    shouldRestoreRef.current = true;
    setDeskInitialPhase('exiting');
    setPhase('desk');
  }

  return (
    <DeskSceneContext.Provider value={{ reenter }}>
      {phase === 'desk' ? (
        <DeskScene initialPhase={deskInitialPhase} onZoomInComplete={handleZoomInComplete} />
      ) : (
        children
      )}
    </DeskSceneContext.Provider>
  );
}
