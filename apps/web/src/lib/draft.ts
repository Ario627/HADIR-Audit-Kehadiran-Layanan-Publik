import type { ReportCategory } from '@hadir/contracts';
import { REPORT_MAX_TEXT } from './report';

export interface ReportDraft {
  stopCode: string | null;
  category: ReportCategory | null;
  text: string;
  photoUploadId: string | null;
  photoSavedAt: number | null;
  savedAt: number;
}

export type DraftInput = Omit<ReportDraft, 'savedAt'>;

export const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;
export const PHOTO_TTL_MS = 12 * 60 * 1000;
export const MAX_SERIALIZED = 4_096;
export const MIN_SAVE_LENGTH = 1;

const STOP_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,11}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set<string>([
  'service_wait',
  'service_no_show',
  'service_full',
  'stop_facility',
  'stop_cleanliness',
  'stop_safety',
  'route_info',
  'accessibility',
  'other',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTimestamp(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

function readStopCode(raw: unknown): string | null | undefined {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().toUpperCase();
  return STOP_PATTERN.test(normalized) ? normalized : undefined;
}

function readCategory(raw: unknown): ReportCategory | null | undefined {
  if (raw === null) {
    return null;
  }
  return typeof raw === 'string' && CATEGORIES.has(raw) ? (raw as ReportCategory) : undefined;
}

function readPhotoId(raw: unknown): string | null | undefined {
  if (raw === null) {
    return null;
  }
  return typeof raw === 'string' && UUID_PATTERN.test(raw) ? raw : undefined;
}

export function hasContent(input: DraftInput): boolean {
  return (
    input.text.trim().length >= MIN_SAVE_LENGTH ||
    input.stopCode !== null ||
    input.category !== null
  );
}

export function photoStillValid(draft: ReportDraft, now: number): boolean {
  if (draft.photoUploadId === null || draft.photoSavedAt === null) {
    return false;
  }
  return now - draft.photoSavedAt <= PHOTO_TTL_MS && draft.photoSavedAt <= now + 60_000;
}

export function withoutStalePhoto(draft: ReportDraft, now: number): ReportDraft {
  if (photoStillValid(draft, now)) {
    return draft;
  }
  return { ...draft, photoUploadId: null, photoSavedAt: null };
}

export function encodeDraft(input: DraftInput, now: number): string | null {
  const text = input.text.slice(0, REPORT_MAX_TEXT);
  const photoUploadId = input.photoUploadId === null ? null : input.photoUploadId;
  const payload: ReportDraft = {
    stopCode: input.stopCode,
    category: input.category,
    text,
    photoUploadId,
    photoSavedAt: photoUploadId === null ? null : (input.photoSavedAt ?? now),
    savedAt: now,
  };
  const serialized = JSON.stringify(payload);
  return serialized.length > MAX_SERIALIZED ? null : serialized;
}

export function decodeDraft(raw: string | null, now: number): ReportDraft | null {
  if (raw === null || raw.length === 0 || raw.length > MAX_SERIALIZED) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const stopCode = readStopCode(parsed.stopCode);
  const category = readCategory(parsed.category);
  if (stopCode === undefined || category === undefined) {
    return null;
  }
  if (typeof parsed.text !== 'string') {
    return null;
  }
  const text = parsed.text.slice(0, REPORT_MAX_TEXT);

  const photoUploadId = readPhotoId(parsed.photoUploadId);
  if (photoUploadId === undefined) {
    return null;
  }
  const photoSavedAt = parsed.photoSavedAt === null ? null : readTimestamp(parsed.photoSavedAt);
  if (parsed.photoSavedAt !== null && photoSavedAt === null) {
    return null;
  }
  if ((photoUploadId === null) !== (photoSavedAt === null)) {
    return null;
  }

  const savedAt = readTimestamp(parsed.savedAt);
  if (savedAt === null) {
    return null;
  }
  if (now - savedAt > DRAFT_TTL_MS) {
    return null;
  }
  if (savedAt > now + 60_000) {
    return null;
  }

  const draft: ReportDraft = {
    stopCode,
    category,
    text,
    photoUploadId,
    photoSavedAt,
    savedAt,
  };
  if (!hasContent(draft)) {
    return null;
  }
  return withoutStalePhoto(draft, now);
}

export function draftSummary(draft: ReportDraft, now: number): string {
  const parts: string[] = [];
  if (draft.text.trim().length > 0) {
    const chars = draft.text.trim().length;
    parts.push(`${chars} karakter`);
  }
  if (draft.category !== null) {
    parts.push('kategori sudah dipilih');
  }
  if (photoStillValid(draft, now)) {
    parts.push('foto sudah diunggah');
  }
  return parts.length === 0 ? 'draf kosong' : parts.join(' · ');
}

export function draftAgeText(savedAt: number, now: number): string {
  const minutes = Math.floor((now - savedAt) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return 'waktu simpan tidak diketahui';
  }
  if (minutes < 1) {
    return 'disimpan beberapa detik lalu';
  }
  if (minutes < 60) {
    return `disimpan ${minutes} menit lalu`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `disimpan ${hours} jam lalu`;
  }
  return `disimpan ${Math.floor(hours / 24)} hari lalu`;
}

export const DEBOUNCE_MS = 2_000;