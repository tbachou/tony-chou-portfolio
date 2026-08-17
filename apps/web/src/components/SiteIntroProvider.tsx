'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const SiteIntroScene = dynamic(() => import('./SiteIntroScene'), { ssr: false });

const STORAGE_KEY = 'portfolio:intro-seen';

type Phase = 'checking' | 'intro' | 'site';

const SiteIntroContext = createContext<{ reenter: () => void } | null>(null);

export function useSiteIntro() {
  const ctx = useContext(SiteIntroContext);
  if (!ctx) {
    throw new Error('useSiteIntro must be used within SiteIntroProvider');
  }
  return ctx;
}

export function SiteIntroProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [introInitialPhase, setIntroInitialPhase] = useState<'idle' | 'exiting'>('idle');

  useEffect(() => {
    const seen = window.localStorage.getItem(STORAGE_KEY);
    setPhase(seen ? 'site' : 'intro');
  }, []);

  // `children` (and any #hash target inside it, e.g. #projects) only exists
  // in the DOM once phase flips to 'site' - the browser's own hash-scroll-
  // on-navigation already ran by then and doesn't retry, so a link like
  // /#projects silently lands at the top instead. Scroll manually once the
  // real content is actually mounted.
  useEffect(() => {
    if (phase !== 'site') return;
    if (!window.location.hash) return;
    document.querySelector(window.location.hash)?.scrollIntoView();
  }, [phase]);

  function handleZoomInComplete() {
    window.localStorage.setItem(STORAGE_KEY, '1');
    setPhase('site');
  }

  function reenter() {
    setIntroInitialPhase('exiting');
    setPhase('intro');
  }

  return (
    <SiteIntroContext.Provider value={{ reenter }}>
      {phase === 'checking' ? (
        <div className="fixed inset-0 bg-term-canvas" aria-hidden="true" />
      ) : phase === 'intro' ? (
        <SiteIntroScene initialPhase={introInitialPhase} onZoomInComplete={handleZoomInComplete} />
      ) : (
        children
      )}
    </SiteIntroContext.Provider>
  );
}
