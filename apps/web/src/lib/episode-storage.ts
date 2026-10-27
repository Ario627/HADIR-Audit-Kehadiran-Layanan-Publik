import type { Presence, StartMode } from '@hadir/contracts';
import type { TicketView } from './episode';
import { startModeLabel } from './episode';

export interface StoredEpisode {
  episodeId: string;
  stopCode: string;
  stopName: string;
  routeCode: string | null;
  startedAt: string;
  startMode: StartMode;
  presence: Presence;
  savedAt: number;
}

export type StoredEpisodeInput = Omit<StoredEpisode, 'savedAt'>;

const STORAGE_KEY = 'hadir.episode.v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 160;

const START_MODES: readonly StartMode[] = ['qr', 'gps_nearby', 'manual', 'resume', 'import'];
const PRESENCES: readonly Presence[] = [
  'unverified',
  'qr_only',
  'qr_geo',
  'gps_verified',
  'field_verified',
];

function pick<T extends string>(values: readonly T[], raw: unknown): T | null {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

function readText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 || trimmed.length > maxLength ? null : trimmed;
}

export function decodeStoredEpisode(raw: string | null, now: number): StoredEpisode | null {
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const episodeId = readText(record.episodeId, 64);
  const stopCode = readText(record.stopCode, 12);
  const stopName = readText(record.stopName, MAX_TEXT);
  const startedAt = readText(record.startedAt, 40);
  const startMode = pick(START_MODES, record.startMode);
  const presence = pick(PRESENCES, record.presence);
  const savedAt = record.savedAt;
  const routeCodeRaw = record.routeCode;
  const routeCode = routeCodeRaw === null ? null : readText(routeCodeRaw, 12);

  if (episodeId === null || stopCode === null || stopName === null || startedAt === null) {
    return null;
  }
  if (startMode === null || presence === null) {
    return null;
  }
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) {
    return null;
  }
  if (routeCodeRaw !== null && routeCode === null) {
    return null;
  }
  if (Number.isNaN(Date.parse(startedAt))) {
    return null;
  }
  if (now - savedAt > MAX_AGE_MS || savedAt > now + 60_000) {
    return null;
  }
  return { episodeId, stopCode, stopName, routeCode, startedAt, startMode, presence, savedAt };
}

export function encodeStoredEpisode(input: StoredEpisodeInput, now: number): string {
  return JSON.stringify({ ...input, savedAt: now });
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredEpisode(now: number = Date.now()): StoredEpisode | null {
  const store = storage();
  if (store === null) {
    return null;
  }
  try {
    return decodeStoredEpisode(store.getItem(STORAGE_KEY), now);
  } catch {
    return null;
  }
}

export function writeStoredEpisode(input: StoredEpisodeInput, now: number = Date.now()): void {
  const store = storage();
  if (store === null) {
    return;
  }
  try {
    store.setItem(STORAGE_KEY, encodeStoredEpisode(input, now));
  } catch {
    return;
  }
}

export function clearStoredEpisode(): void {
  const store = storage();
  if (store === null) {
    return;
  }
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export function ticketFromStorage(stored: StoredEpisode): TicketView {
  return {
    code: stored.stopCode,
    name: stored.stopName,
    routeCode: stored.routeCode,
    modeLabel: startModeLabel(stored.startMode),
    startedAt: stored.startedAt,
    presenceNote: null,
    source: 'device',
  };
}