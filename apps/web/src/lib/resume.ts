export const RESUME_MARK_KEY = 'hadir.resume.v1';
export const CROSS_TAB_CHANNEL = 'hadir:episode';

const RESUMABLE_PREFIX = '/wait/';
const MAX_MESSAGE_CHARS = 512;
const MAX_EPISODE_ID_CHARS = 64;

export interface ResumeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ResumeInput {
  activeEpisodeId: string | null;
  alreadyResumed: boolean;
  currentPath: string;
}

export type ResumeDecision = 'resume' | 'stay';

export interface CrossTabMessage {
  kind: 'episode-changed';
  episodeId: string | null;
}

export function waitPath(episodeId: string): string {
  return `${RESUMABLE_PREFIX}${episodeId}`;
}

export function shouldResume(input: ResumeInput): ResumeDecision {
  const id = input.activeEpisodeId;
  if (id === null || id.length === 0) {
    return 'stay';
  }
  if (input.alreadyResumed) {
    return 'stay';
  }
  if (input.currentPath.startsWith(RESUMABLE_PREFIX)) {
    return 'stay';
  }
  return 'resume';
}

export function readResumeMark(store: ResumeStore | null, episodeId: string): boolean {
  if (store === null) {
    return false;
  }
  try {
    return store.getItem(RESUME_MARK_KEY) === episodeId;
  } catch {
    return false;
  }
}

export function writeResumeMark(store: ResumeStore | null, episodeId: string): void {
  if (store === null) {
    return;
  }
  try {
    store.setItem(RESUME_MARK_KEY, episodeId);
  } catch {
    return;
  }
}

export function clearResumeMark(store: ResumeStore | null): void {
  if (store === null) {
    return;
  }
  try {
    store.removeItem(RESUME_MARK_KEY);
  } catch {
    return;
  }
}

export function sessionStore(): ResumeStore | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function encodeCrossTab(message: CrossTabMessage): string {
  return JSON.stringify({ kind: message.kind, episodeId: message.episodeId });
}

function readEpisodeId(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length > MAX_EPISODE_ID_CHARS) {
    return undefined;
  }
  return value;
}

function parseCrossTab(value: unknown): CrossTabMessage | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] !== 'episode-changed') {
    return null;
  }
  const episodeId = readEpisodeId(record['episodeId']);
  if (episodeId === undefined) {
    return null;
  }
  return { kind: 'episode-changed', episodeId };
}

export function decodeCrossTab(raw: unknown): CrossTabMessage | null {
  if (typeof raw !== 'string') {
    return parseCrossTab(raw);
  }
  if (raw.length === 0 || raw.length > MAX_MESSAGE_CHARS) {
    return null;
  }
  try {
    return parseCrossTab(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function affectsEpisode(message: CrossTabMessage, watchedId: string): boolean {
  if (message.episodeId === null) {
    return true;
  }
  return message.episodeId === watchedId;
}

export function broadcastEpisodeChange(episodeId: string | null): void {
  if (typeof globalThis.BroadcastChannel !== 'function') {
    return;
  }
  try {
    const channel = new BroadcastChannel(CROSS_TAB_CHANNEL);
    channel.postMessage(encodeCrossTab({ kind: 'episode-changed', episodeId }));
    channel.close();
  } catch {
    return;
  }
}