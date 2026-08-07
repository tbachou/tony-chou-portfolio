'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const INTERACTIVE_SELECTOR = 'a, button, [role="button"], summary';
const NATIVE_CURSOR_SELECTOR = 'input, textarea, select';

export function RetroCursor() {
  const cursorRef = useRef<HTMLDivElement>(null);
  // A native <dialog> renders in the browser's top layer, which always
  // paints above regular DOM regardless of z-index — so while one is open,
  // the cursor has to be portaled inside it to stay visible at all.
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  useEffect(() => {
    const supportsFinePointer = window.matchMedia('(pointer: fine) and (hover: hover)').matches;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!supportsFinePointer || prefersReducedMotion) return;

    setPortalTarget(document.body);

    function syncPortalTarget() {
      setPortalTarget(document.querySelector('dialog[open]') ?? document.body);
    }

    const observer = new MutationObserver(syncPortalTarget);
    observer.observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });

    document.body.classList.add('retro-cursor-active');

    return () => {
      observer.disconnect();
      document.body.classList.remove('retro-cursor-active');
    };
  }, []);

  useEffect(() => {
    const cursor = cursorRef.current;
    if (!cursor) return;

    const mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const pos = { ...mouse };
    let frameId: number;

    function handleMove(event: MouseEvent) {
      mouse.x = event.clientX;
      mouse.y = event.clientY;
    }

    function handleOver(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(NATIVE_CURSOR_SELECTOR)) {
        cursor!.dataset.hidden = 'true';
      } else if (target.closest(INTERACTIVE_SELECTOR)) {
        cursor!.dataset.hover = 'true';
      }
    }

    function handleOut(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(NATIVE_CURSOR_SELECTOR)) {
        cursor!.dataset.hidden = 'false';
      } else if (target.closest(INTERACTIVE_SELECTOR)) {
        cursor!.dataset.hover = 'false';
      }
    }

    function loop() {
      // Lags slightly behind the real pointer — a CRT-terminal trail, not a 1:1 follow.
      pos.x += (mouse.x - pos.x) / 6;
      pos.y += (mouse.y - pos.y) / 6;
      cursor!.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0) translate(-50%, -50%)`;
      frameId = requestAnimationFrame(loop);
    }

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseover', handleOver);
    document.addEventListener('mouseout', handleOut);
    frameId = requestAnimationFrame(loop);

    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseover', handleOver);
      document.removeEventListener('mouseout', handleOut);
      cancelAnimationFrame(frameId);
    };
    // Re-attached whenever the DOM node moves to a new portal target.
  }, [portalTarget]);

  if (!portalTarget) return null;
  return createPortal(<div ref={cursorRef} className="retro-cursor" aria-hidden="true" />, portalTarget);
}
