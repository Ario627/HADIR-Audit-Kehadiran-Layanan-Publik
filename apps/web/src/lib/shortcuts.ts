export const LEADER_KEY = 'g';
export const LEADER_TIMEOUT_MS = 1500;
export const HELP_KEY = '?';

export interface ShortcutTarget {
  path: string;
  label: string;
}

export const LEADER_TARGETS: Record<string, ShortcutTarget> = {
  b: { path: '/', label: 'Papan bukti' },
  p: { path: '/peta', label: 'Peta sebaran' },
  s: { path: '/sekitar', label: 'Halte di sekitar' },
  l: { path: '/lapor', label: 'Laporkan kendala' },
  m: { path: '/metodologi', label: 'Metodologi' },
  r: { path: '/transparansi', label: 'Transparansi' },
};

export interface KeyContext {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  tagName: string;
  isEditable: boolean;
}

export type LeaderStep =
  | { kind: 'idle' }
  | { kind: 'pending'; at: number }
  | { kind: 'navigate'; path: string };

export function isTextEntry(tagName: string, isEditable: boolean): boolean {
  if (isEditable) {
    return true;
  }
  const tag = tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function hasCommandModifier(ctx: KeyContext): boolean {
  return ctx.ctrlKey || ctx.metaKey || ctx.altKey;
}

export function isTypingContext(ctx: KeyContext): boolean {
  return isTextEntry(ctx.tagName, ctx.isEditable) || hasCommandModifier(ctx);
}

export function isHelpKey(ctx: KeyContext): boolean {
  return ctx.key === HELP_KEY && !isTypingContext(ctx);
}

export function targetForLeader(key: string): ShortcutTarget | null {
  return Object.hasOwn(LEADER_TARGETS, key) ? (LEADER_TARGETS[key] ?? null) : null;
}

export function stepLeader(state: LeaderStep, ctx: KeyContext, now: number): LeaderStep {
  if (isTypingContext(ctx)) {
    return { kind: 'idle' };
  }
  const key = ctx.key.toLowerCase();
  if (key.length !== 1) {
    return { kind: 'idle' };
  }
  if (state.kind === 'pending' && now - state.at <= LEADER_TIMEOUT_MS) {
    const target = targetForLeader(key);
    return target === null ? { kind: 'idle' } : { kind: 'navigate', path: target.path };
  }
  if (key === LEADER_KEY) {
    return { kind: 'pending', at: now };
  }
  return { kind: 'idle' };
}

export function comboLabel(key: string): string {
  return `${LEADER_KEY.toUpperCase()} lalu ${key.toUpperCase()}`;
}