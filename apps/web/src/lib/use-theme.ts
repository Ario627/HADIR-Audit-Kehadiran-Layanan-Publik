import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  applyTheme,
  browserThemeStore,
  decodeThemeChoice,
  readThemeChoice,
  resolveTheme,
  systemPrefersDark,
  THEME_KEY,
  writeThemeChoice,
  type ResolvedTheme,
  type ThemeChoice,
} from './theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function noopDark(): boolean {
  return false;
}

function subscribeDark(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {
      return;
    };
  }
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => {
    media.removeEventListener('change', onChange);
  };
}

export interface ThemeState {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
}

export function useTheme(): ThemeState {
  const dark = useSyncExternalStore(subscribeDark, systemPrefersDark, noopDark);
  const [choice, setChoiceState] = useState<ThemeChoice>(() =>
    decodeThemeChoice(readThemeChoice(browserThemeStore())),
  );
  const resolved = resolveTheme(choice, dark);

  useEffect(() => {
    applyTheme(document, resolved);
  }, [resolved]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === THEME_KEY) {
        setChoiceState(readThemeChoice(browserThemeStore()));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    writeThemeChoice(browserThemeStore(), next);
    setChoiceState(next);
  }, []);

  return { choice, resolved, setChoice };
}