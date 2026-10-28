import type { EndOutcome } from './episode';
import {
  announceOutbox,
  enqueueEntry,
  findForEpisode,
  withFailure,
  type OutboxEntry,
} from './outbox';
import { readOutbox, writeOutbox } from './outbox-store';

const RETRYABLE = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVICE_UNAVAILABLE',
  'RATE_LIMITED',
  'INVALID_RESPONSE',
  'UNAUTHENTICATED',
  'CSRF_MISSING',
  'CSRF_INVALID',
]);

const PERMANENT = new Set([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN',
  'INVALID_TRANSITION',
  'IDEMPOTENCY_CONFLICT',
  'CONTRACT_MISMATCH',
]);

export interface QueuedEndInput {
  episodeId: string;
  outcome: EndOutcome;
  clientEndedAt: string;
  clientEventId: string;
  idempotencyKey: string;
}

export function isRetryableCode(code: string): boolean {
  return RETRYABLE.has(code) && !PERMANENT.has(code);
}

export function isPermanentCode(code: string): boolean {
  return PERMANENT.has(code);
}

export function penalizeEntry(entry: OutboxEntry, code: string, now: number, jitter: number) {
  return withFailure(entry, code, now, jitter);
}

export async function queueEpisodeEnd(
  input: QueuedEndInput,
  now: number = Date.now(),
): Promise<boolean> {
  const entries = await readOutbox(now);
  if (findForEpisode(entries, input.episodeId) !== null) {
    return false;
  }
  const entry = enqueueEntry(
    {
      id: input.clientEventId,
      kind: 'episode.end',
      targetId: input.episodeId,
      body: {
        outcome: input.outcome,
        clientEndedAt: input.clientEndedAt,
        clientEventId: input.clientEventId,
      },
      idempotencyKey: input.idempotencyKey,
    },
    now,
  );
  await writeOutbox([...entries, entry]);
  announceOutbox();
  return true;
}