import { useRouter } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { isHelpKey, stepLeader, type KeyContext, type LeaderStep } from './shortcuts';

function readContext(event: KeyboardEvent): KeyContext {
  const element = event.target instanceof HTMLElement ? event.target : null;
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    tagName: element?.tagName ?? '',
    isEditable: element?.isContentEditable ?? false,
  };
}

export interface ShortcutOptions {
  onHelp: () => void;
}

export function useShortcuts({ onHelp }: ShortcutOptions): void {
  const router = useRouter();
  const state = useRef<LeaderStep>({ kind: 'idle' });

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const ctx = readContext(event);
      if (isHelpKey(ctx)) {
        event.preventDefault();
        state.current = { kind: 'idle' };
        onHelp();
        return;
      }
      const next = stepLeader(state.current, ctx, Date.now());
      if (next.kind === 'navigate') {
        event.preventDefault();
        state.current = { kind: 'idle' };
        router.history.push(next.path);
        return;
      }
      if (next.kind === 'pending') {
        event.preventDefault();
      }
      state.current = next;
    };

    const reset = (): void => {
      state.current = { kind: 'idle' };
    };

    window.addEventListener('keydown', handler);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('blur', reset);
      reset();
    };
  }, [onHelp, router]);
}