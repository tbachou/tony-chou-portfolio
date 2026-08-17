'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const SiteIntroScene = dynamic(() => import('./SiteIntroScene'), { ssr: false });

type Phase = 'intro' | 'site';

const SiteIntroContext = createContext<{ reenter: () => void } | null>(null);

export function useSiteIntro() {
  const ctx = useContext(SiteIntroContext);
  if (!ctx) {
    throw new Error('useSiteIntro must be used within SiteIntroProvider');
  }
  return ctx;
}

// The 3D scene used to gate every first visit behind a click-to-boot
// interaction before any real content was reachable - real friction for a
// portfolio whose job is to get a busy visitor to actual content fast.
// It's demoted to opt-in now: the site loads straight to `children`, and the
// scene is only ever reached by explicitly asking for it via `reenter()`.
export function SiteIntroProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('site');
  const [introInitialPhase, setIntroInitialPhase] = useState<'idle' | 'exiting'>('idle');

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

  function handleZoomInComplete() {
    setPhase('site');
  }

  function reenter() {
    setIntroInitialPhase('exiting');
    setPhase('intro');
  }

  return (
    <SiteIntroContext.Provider value={{ reenter }}>
      {phase === 'intro' ? (
        <SiteIntroScene initialPhase={introInitialPhase} onZoomInComplete={handleZoomInComplete} />
      ) : (
        children
      )}
    </SiteIntroContext.Provider>
  );
}
