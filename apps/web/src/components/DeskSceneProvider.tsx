'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const DeskScene = dynamic(() => import('./DeskScene'), { ssr: false });

type Phase = 'desk' | 'site';

const DeskSceneContext = createContext<{ reenter: () => void } | null>(null);

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
