import { useState, useEffect } from 'react';

type ViewMode = 'table' | 'cards';

const MOBILE_BREAKPOINT = 640;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;
}

/**
 * Persists the user's preferred view mode (table/cards) in localStorage.
 * Falls back to 'cards' on narrow viewports when no explicit preference is stored.
 */
export function useViewMode(storageKey: string): [ViewMode, (mode: ViewMode) => void] {
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'table' || stored === 'cards') return stored;
    } catch { /* storage unavailable */ }
    return isMobileViewport() ? 'cards' : 'table';
  });

  const setViewMode = (mode: ViewMode) => {
    try { localStorage.setItem(storageKey, mode); } catch { /* ignore */ }
    setViewModeState(mode);
  };

  // If no explicit preference, reactively switch to cards when window is resized to mobile
  useEffect(() => {
    const stored = (() => {
      try { return localStorage.getItem(storageKey); } catch { return null; }
    })();
    if (stored) return; // user has explicit preference — don't override

    const handler = () => {
      setViewModeState(isMobileViewport() ? 'cards' : 'table');
    };
    window.addEventListener('resize', handler, { passive: true });
    return () => window.removeEventListener('resize', handler);
  }, [storageKey]);

  return [viewMode, setViewMode];
}
