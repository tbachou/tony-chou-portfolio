'use client';

import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react';
import dynamic from 'next/dynamic';

const DeskScene = dynamic(() => import('./DeskScene'), { ssr: false });

type Phase = 'desk' | 'site';

const DeskSceneContext = createContext<{
  /** Enter the 3D scene. */
  reenter: () => void;
  /**
   * Attach to the control that opens the scene. Leaving hands focus back to
   * whatever this points at, so a keyboard or screen-reader visitor resumes
   * where they left off instead of at the top of the document.
   *
   * It has to be a ref rather than an element captured at click time: the
   * scene unmounts `children`, so the node that was clicked is destroyed and
   * focusing it would silently do nothing. React re-attaches this ref to the
   * freshly mounted node during the commit that brings the site back, which
   * lands before the effect below reads it.
   */
  triggerRef: RefObject<HTMLButtonElement | null>;
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
  // Both are replayed on the way out.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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
    // 'instant', not 'auto': globals.css sets `html { scroll-behavior:
    // smooth }`, and 'auto' defers to that, so it would animate a
    // multi-thousand-pixel scroll and race the focus() below. This is
    // restoring a position the visitor never asked to leave, not a
    // navigation, so it should not animate at all.
    window.scrollTo({ top: scrollYRef.current, behavior: 'instant' });
    // No preventScroll — if the offset above landed correctly the element is
    // already in view and focusing is a no-op; if layout shifted, the browser
    // corrects rather than leaving focus off screen.
    triggerRef.current?.focus();
  }, [phase]);

  function handleZoomInComplete() {
    setPhase('site');
  }

  function reenter() {
    scrollYRef.current = window.scrollY;
    shouldRestoreRef.current = true;
    setDeskInitialPhase('exiting');
    setPhase('desk');
  }

  return (
    <DeskSceneContext.Provider value={{ reenter, triggerRef }}>
      {phase === 'desk' ? (
        <DeskScene initialPhase={deskInitialPhase} onZoomInComplete={handleZoomInComplete} />
      ) : (
        children
      )}
    </DeskSceneContext.Provider>
  );
}
