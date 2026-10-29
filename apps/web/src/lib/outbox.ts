import type { ReportCategory } from '@hadir/contracts';
import { END_OUTCOMES, type EndOutcome } from './episode';
import { isUuid } from './id';
import { isReportCategory } from './report';

export type OutboxKind = 'episode.end' | 'report.create';

export interface OutboxEndBody {
  outcome: EndOutcome;
  clientEndedAt: string;
  clientEventId: string;
}

export interface OutboxReportBody {
  category: ReportCategory;
  stopCode: string;
  text: string;
  triageSessionId: string | null;
  clientEventId: string;
}

interface OutboxBase {
  id: string;
  targetId: string;
  idempotencyKey: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastErrorCode: string | null;
}

export interface OutboxEndEntry extends OutboxBase {
  kind: 'episode.end';
  body: OutboxEndBody;
}

export interface OutboxReportEntry extends OutboxBase {
  kind: 'report.create';
  body: OutboxReportBody;
}

export type OutboxEntry = OutboxEndEntry | OutboxReportEntry;

export type OutboxEndInput = Omit<
  OutboxEndEntry,
  'createdAt' | 'attempts' | 'nextAttemptAt' | 'lastErrorCode'
>;

export type OutboxReportInput = Omit<
  OutboxReportEntry,
  'createdAt' | 'attempts' | 'nextAttemptAt' | 'lastErrorCode'
>;

export type OutboxEnqueueInput = OutboxEndInput | OutboxReportInput;

export interface OutboxSummary {
  total: number;
  due: number;
  stalled: number;
}

export const MAX_ATTEMPTS = 8;
export const MAX_ENTRIES = 16;
export const MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const BASE_DELAY_MS = 4_000;
export const MAX_DELAY_MS = 5 * 60 * 1000;
export const OUTBOX_EVENT = 'hadir:outbox';
const JITTER_RATIO = 0.25;
const MAX_TEXT = 200;
const MAX_STOP_CODE = 32;
const MAX_REPORT_TEXT = 2000;

export function announceOutbox(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent(OUTBOX_EVENT));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
}

function readOutcome(raw: unknown): EndOutcome | null {
  return typeof raw === 'string' && (END_OUTCOMES as readonly string[]).includes(raw)
    ? (raw as EndOutcome)
    : null;
}

function readCount(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= MAX_ATTEMPTS
    ? raw
    : null;
}

function readTimestamp(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

function readBody(raw: unknown): OutboxEndBody | null {
  if (!isRecord(raw)) {
    return null;
  }
  const outcome = readOutcome(raw.outcome);
  const clientEndedAt = readText(raw.clientEndedAt, 40);
  const clientEventId = readText(raw.clientEventId, 36);
  if (outcome === null || clientEndedAt === null || clientEventId === null) {
    return null;
  }
  if (!isUuid(clientEventId) || Number.isNaN(Date.parse(clientEndedAt))) {
    return null;
  }
  return { outcome, clientEndedAt, clientEventId };
}

function readOptionalUuid(raw: unknown): string | null | undefined {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'string' || !isUuid(raw)) {
    return undefined;
  }
  return raw;
}

function readReportBody(raw: unknown): OutboxReportBody | null {
  if (!isRecord(raw)) {
    return null;
  }
  const stopCode = readText(raw.stopCode, MAX_STOP_CODE);
  const text = readText(raw.text, MAX_REPORT_TEXT);
  const clientEventId = readText(raw.clientEventId, 36);
  const category = isReportCategory(raw.category) ? raw.category : null;
  const triageSessionId = readOptionalUuid(raw.triageSessionId);
  if (stopCode === null || text === null || clientEventId === null) {
    return null;
  }
  if (category === null || triageSessionId === undefined) {
    return null;
  }
  if (!isUuid(clientEventId)) {
    return null;
  }
  return { category, stopCode, text, triageSessionId, clientEventId };
}

export function backoffDelayMs(attempts: number, jitter: number): number {
  const safeAttempts = Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 0;
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 3 ** safeAttempts);
  const spread = Math.min(1, Math.max(0, jitter)) * JITTER_RATIO;
  return Math.round(base * (1 + spread));
}

export function isDue(entry: OutboxEntry, now: number): boolean {
  return entry.nextAttemptAt <= now;
}

export function isExpired(entry: OutboxEntry, now: number): boolean {
  return now - entry.createdAt > MAX_AGE_MS || entry.createdAt > now + 60_000;
}

export function isExhausted(entry: OutboxEntry): boolean {
  return entry.attempts >= MAX_ATTEMPTS;
}

export function shouldAbandon(entry: OutboxEntry, now: number): boolean {
  return isExpired(entry, now) || isExhausted(entry);
}

export function enqueueEntry(input: OutboxEndInput, now: number): OutboxEndEntry;
export function enqueueEntry(input: OutboxReportInput, now: number): OutboxReportEntry;
export function enqueueEntry(input: OutboxEnqueueInput, now: number): OutboxEntry {
  const runtime = { createdAt: now, attempts: 0, nextAttemptAt: now, lastErrorCode: null };
  if (input.kind === 'episode.end') {
    return { ...input, ...runtime };
  }
  return { ...input, ...runtime };
}

export function withFailure(
  entry: OutboxEntry,
  code: string,
  now: number,
  jitter: number,
): OutboxEntry {
  const attempts = entry.attempts + 1;
  return {
    ...entry,
    attempts,
    nextAttemptAt: now + backoffDelayMs(attempts, jitter),
    lastErrorCode: code.slice(0, MAX_TEXT),
  };
}

export function trimEntries(entries: readonly OutboxEntry[]): OutboxEntry[] {
  return [...entries]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_ENTRIES)
    .sort((left, right) => left.createdAt - right.createdAt);
}

export function summarize(entries: readonly OutboxEntry[], now: number): OutboxSummary {
  let due = 0;
  let stalled = 0;
  for (const entry of entries) {
    if (shouldAbandon(entry, now)) {
      stalled += 1;
      continue;
    }
    if (isDue(entry, now)) {
      due += 1;
    }
  }
  return { total: entries.length, due, stalled };
}

export function findForEpisode(
  entries: readonly OutboxEntry[],
  episodeId: string,
): OutboxEndEntry | null {
  return (
    entries.find(
      (entry): entry is OutboxEndEntry =>
        entry.kind === 'episode.end' && entry.targetId === episodeId,
    ) ?? null
  );
}

export function findForDraft(
  entries: readonly OutboxEntry[],
  draftId: string,
): OutboxReportEntry | null {
  return (
    entries.find(
      (entry): entry is OutboxReportEntry =>
        entry.kind === 'report.create' && entry.targetId === draftId,
    ) ?? null
  );
}

export function encodeEntry(entry: OutboxEntry): string {
  return JSON.stringify(entry);
}

function readKind(raw: unknown): OutboxKind | null {
  return raw === 'episode.end' || raw === 'report.create' ? raw : null;
}

export function decodeEntry(raw: string | null, now: number): OutboxEntry | null {
  if (raw === null) {
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
  const kind = readKind(parsed.kind);
  if (kind === null) {
    return null;
  }
  const id = readText(parsed.id, 36);
  const targetId = readText(parsed.targetId, 36);
  const idempotencyKey = readText(parsed.idempotencyKey, 36);
  const createdAt = readTimestamp(parsed.createdAt);
  const nextAttemptAt = readTimestamp(parsed.nextAttemptAt);
  const attempts = readCount(parsed.attempts);
  const lastErrorCode =
    parsed.lastErrorCode === null ? null : readText(parsed.lastErrorCode, MAX_TEXT);
  if (id === null || targetId === null || idempotencyKey === null) {
    return null;
  }
  if (!isUuid(id) || !isUuid(targetId) || !isUuid(idempotencyKey)) {
    return null;
  }
  if (createdAt === null || nextAttemptAt === null || attempts === null) {
    return null;
  }
  if (lastErrorCode === null && parsed.lastErrorCode !== null) {
    return null;
  }
  if (now - createdAt > MAX_AGE_MS) {
    return null;
  }
  const base = { id, targetId, idempotencyKey, createdAt, attempts, nextAttemptAt, lastErrorCode };
  if (kind === 'episode.end') {
    const body = readBody(parsed.body);
    return body === null ? null : { ...base, kind, body };
  }
  const body = readReportBody(parsed.body);
  return body === null ? null : { ...base, kind, body };
}