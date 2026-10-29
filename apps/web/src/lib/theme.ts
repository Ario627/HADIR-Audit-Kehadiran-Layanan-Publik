export const THEME_KEY = 'hadir.theme.v1';
export const THEMES = ['system', 'light', 'dark'] as const;

export type ThemeChoice = (typeof THEMES)[number];
export type ResolvedTheme = 'light' | 'dark';

export interface ThemeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SURFACE_BY_THEME: Record<ResolvedTheme, string> = {
  light: '#f2eee3',
  dark: '#12130f',
};

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'Ikut sistem',
  light: 'Terang',
  dark: 'Malam',
};

export const THEME_HINTS: Record<ThemeChoice, string> = {
  system: 'Mengikuti pengaturan perangkat.',
  light: 'Kertas tiket terang sepanjang waktu.',
  dark: 'Papan keberangkatan gelap sepanjang waktu.',
};

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function decodeThemeChoice(raw: string | null): ThemeChoice {
  return isThemeChoice(raw) ? raw : 'system';
}

export function resolveTheme(choice: ThemeChoice, dark: boolean): ResolvedTheme {
  if (choice === 'system') {
    return dark ? 'dark' : 'light';
  }
  return choice;
}

export function themeColor(theme: ResolvedTheme): string {
  return SURFACE_BY_THEME[theme];
}

export function browserThemeStore(): ThemeStore | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readThemeChoice(store: ThemeStore | null): ThemeChoice {
  if (store === null) {
    return 'system';
  }
  try {
    return decodeThemeChoice(store.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
}

export function writeThemeChoice(store: ThemeStore | null, choice: ThemeChoice): void {
  if (store === null) {
    return;
  }
  try {
    store.setItem(THEME_KEY, choice);
  } catch {
    return;
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(doc: Document, theme: ResolvedTheme): void {
  doc.documentElement.dataset['theme'] = theme;
  const color = themeColor(theme);
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    if (meta instanceof HTMLMetaElement) {
      meta.removeAttribute('media');
      meta.content = color;
    }
  }
}

export function applyStoredTheme(): ThemeChoice {
  if (typeof document === 'undefined') {
    return 'system';
  }
  const choice = readThemeChoice(browserThemeStore());
  applyTheme(document, resolveTheme(choice, systemPrefersDark()));
  return choice;
}