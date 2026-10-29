import { useEffect, useRef, useState } from 'react';

function toSeconds(milliseconds: number | null): number {
  if (milliseconds === null) {
    return 0;
  }
  return Math.max(0, Math.floor(milliseconds / 1_000));
}

export function useElapsedSeconds(seedMs: number | null, running: boolean): number {
  const anchorRef = useRef<{ baseSeconds: number; startedAt: number } | null>(null);
  const [seconds, setSeconds] = useState(() => toSeconds(seedMs));

  useEffect(() => {
    if (seedMs === null) {
      return;
    }
    anchorRef.current = { baseSeconds: toSeconds(seedMs), startedAt: performance.now() };
    setSeconds(toSeconds(seedMs));
  }, [seedMs]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => {
      const anchor = anchorRef.current;
      if (anchor === null) {
        return;
      }
      setSeconds(anchor.baseSeconds + Math.floor((performance.now() - anchor.startedAt) / 1_000));
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [running, seedMs]);

  return seconds;
}