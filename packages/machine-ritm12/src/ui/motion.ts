import { useEffect, useState } from 'react';

const REDUCED = '(prefers-reduced-motion: reduce)';

/** Whether whoever is looking has asked for less movement on the screen. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED).matches);
  useEffect(() => {
    const query = window.matchMedia(REDUCED);
    const follow = () => setReduced(query.matches);
    query.addEventListener('change', follow);
    return () => query.removeEventListener('change', follow);
  }, []);
  return reduced;
}
