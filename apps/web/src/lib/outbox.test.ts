import { describe, expect, it } from 'vitest';
import {
  BASE_DELAY_MS,
  MAX_AGE_MS,
  MAX_ATTEMPTS,
  MAX_DELAY_MS,
  MAX_ENTRIES,
  backoffDelayMs,
  decodeEntry,
  encodeEntry,
  enqueueEntry,
  findForEpisode,
  isDue,
  isExhausted,
  isExpired,
  shouldAbandon,
  summarize,
  trimEntries,
  withFailure,
  type OutboxEntry,
  type OutboxEnqueueInput,
} from './outbox';

const NOW = 1_760_000_000_000;
const EPISODE_ID = '0192f0d0-0000-7000-8000-000000000001';
const EVENT_ID = '0192f0d0-0000-7000-8000-000000000002';
const KEY_ID = '0192f0d0-0000-7000-8000-000000000003';

function input(overrides: Partial<OutboxEnqueueInput> = {}): OutboxEnqueueInput {
  return {
    id: EVENT_ID,
    kind: 'episode.end',
    targetId: EPISODE_ID,
    body: {
      outcome: 'boarded',
      clientEndedAt: new Date(NOW - 60_000).toISOString(),
      clientEventId: EVENT_ID,
    },
    idempotencyKey: KEY_ID,
    ...overrides,
  };
}

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return { ...enqueueEntry(input(), NOW), ...overrides };
}

describe('backoffDelayMs', () => {
  it('starts at the base delay', () => {
    expect(backoffDelayMs(0, 0)).toBe(BASE_DELAY_MS);
  });

  it('grows geometrically', () => {
    expect(backoffDelayMs(1, 0)).toBe(BASE_DELAY_MS * 3);
    expect(backoffDelayMs(2, 0)).toBe(BASE_DELAY_MS * 9);
  });

  it('never exceeds the ceiling', () => {
    expect(backoffDelayMs(20, 0)).toBe(MAX_DELAY_MS);
  });

  it('adds at most a quarter of jitter', () => {
    expect(backoffDelayMs(1, 1)).toBe(Math.round(BASE_DELAY_MS * 3 * 1.25));
    expect(backoffDelayMs(1, 5)).toBe(Math.round(BASE_DELAY_MS * 3 * 1.25));
    expect(backoffDelayMs(1, -5)).toBe(BASE_DELAY_MS * 3);
  });

  it('treats junk attempts as zero', () => {
    expect(backoffDelayMs(Number.NaN, 0)).toBe(BASE_DELAY_MS);
    expect(backoffDelayMs(-3, 0)).toBe(BASE_DELAY_MS);
  });
});

describe('entry lifecycle', () => {
  it('becomes due immediately when created', () => {
    expect(isDue(entry(), NOW)).toBe(true);
  });

  it('is not due before its scheduled time', () => {
    expect(isDue(entry({ nextAttemptAt: NOW + 1 }), NOW)).toBe(false);
  });

  it('counts a failure and pushes the next attempt forward', () => {
    const failed = withFailure(entry(), 'NETWORK_ERROR', NOW, 0);
    expect(failed.attempts).toBe(1);
    expect(failed.lastErrorCode).toBe('NETWORK_ERROR');
    expect(failed.nextAttemptAt).toBe(NOW + BASE_DELAY_MS * 3);
    expect(isDue(failed, NOW)).toBe(false);
  });

  it('stops retrying after the attempt ceiling', () => {
    expect(isExhausted(entry({ attempts: MAX_ATTEMPTS - 1 }))).toBe(false);
    expect(isExhausted(entry({ attempts: MAX_ATTEMPTS }))).toBe(true);
  });

  it('expires entries older than the retention window', () => {
    expect(isExpired(entry({ createdAt: NOW - MAX_AGE_MS + 1 }), NOW)).toBe(false);
    expect(isExpired(entry({ createdAt: NOW - MAX_AGE_MS - 1 }), NOW)).toBe(true);
  });

  it('expires entries stamped in the future', () => {
    expect(isExpired(entry({ createdAt: NOW + 120_000 }), NOW)).toBe(true);
  });

  it('abandons exhausted or expired entries', () => {
    expect(shouldAbandon(entry(), NOW)).toBe(false);
    expect(shouldAbandon(entry({ attempts: MAX_ATTEMPTS }), NOW)).toBe(true);
    expect(shouldAbandon(entry({ createdAt: NOW - MAX_AGE_MS - 1 }), NOW)).toBe(true);
  });
});

describe('trimEntries', () => {
  it('keeps only the newest entries in creation order', () => {
    const many = Array.from({ length: MAX_ENTRIES + 5 }, (_, index) =>
      entry({ id: `id-${index}`, createdAt: NOW + index }),
    );
    const trimmed = trimEntries(many);
    expect(trimmed).toHaveLength(MAX_ENTRIES);
    expect(trimmed[0]?.createdAt).toBe(NOW + 5);
    expect(trimmed[trimmed.length - 1]?.createdAt).toBe(NOW + MAX_ENTRIES + 4);
  });

  it('leaves a short list untouched', () => {
    const short = [entry()];
    expect(trimEntries(short)).toEqual(short);
  });
});

describe('summarize', () => {
  it('counts due and stalled entries', () => {
    const summary = summarize(
      [
        entry({ id: 'a' }),
        entry({ id: 'b', nextAttemptAt: NOW + 60_000 }),
        entry({ id: 'c', attempts: MAX_ATTEMPTS }),
      ],
      NOW,
    );
    expect(summary).toEqual({ total: 3, due: 1, stalled: 1 });
  });

  it('returns zeros for an empty queue', () => {
    expect(summarize([], NOW)).toEqual({ total: 0, due: 0, stalled: 0 });
  });
});

describe('findForEpisode', () => {
  it('finds the queued end for one episode', () => {
    const found = findForEpisode([entry()], EPISODE_ID);
    expect(found?.id).toBe(EVENT_ID);
  });

  it('ignores other episodes', () => {
    expect(findForEpisode([entry()], '0192f0d0-0000-7000-8000-00000000ffff')).toBeNull();
  });

  it('returns null for an empty queue', () => {
    expect(findForEpisode([], EPISODE_ID)).toBeNull();
  });
});

describe('encodeEntry and decodeEntry', () => {
  it('round-trips a queued end', () => {
    const original = entry();
    expect(decodeEntry(encodeEntry(original), NOW)).toEqual(original);
  });

  it('rejects missing or broken payloads', () => {
    expect(decodeEntry(null, NOW)).toBeNull();
    expect(decodeEntry('{', NOW)).toBeNull();
    expect(decodeEntry('[]', NOW)).toBeNull();
    expect(decodeEntry('{"kind":"episode.end"}', NOW)).toBeNull();
  });

  it('rejects unknown kinds', () => {
    const raw = JSON.stringify({ ...entry(), kind: 'report.create' });
    expect(decodeEntry(raw, NOW)).toBeNull();
  });

  it('rejects ids that are not uuids', () => {
    expect(decodeEntry(JSON.stringify({ ...entry(), targetId: 'abc' }), NOW)).toBeNull();
  });

  it('rejects attempts outside the allowed range', () => {
    expect(decodeEntry(JSON.stringify({ ...entry(), attempts: -1 }), NOW)).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry(), attempts: MAX_ATTEMPTS + 1 }), NOW)).toBeNull();
    expect(decodeEntry(JSON.stringify({ ...entry(), attempts: 1.5 }), NOW)).toBeNull();
  });

  it('rejects outcomes outside the citizen end contract', () => {
    expect(
      decodeEntry(JSON.stringify({ ...entry(), body: { ...entry().body, outcome: 'timeout' } }), NOW),
    ).toBeNull();
    expect(
      decodeEntry(
        JSON.stringify({ ...entry(), body: { ...entry().body, outcome: 'import' } }),
        NOW,
      ),
    ).toBeNull();
  });

  it('rejects a body without a parseable timestamp', () => {
    expect(
      decodeEntry(
        JSON.stringify({ ...entry(), body: { ...entry().body, clientEndedAt: 'kemarin' } }),
        NOW,
      ),
    ).toBeNull();
  });

  it('rejects entries older than the retention window', () => {
    const stale = { ...entry(), createdAt: NOW - MAX_AGE_MS - 1 };
    expect(decodeEntry(JSON.stringify(stale), NOW)).toBeNull();
  });

  it('rejects a malformed error code field', () => {
    expect(decodeEntry(JSON.stringify({ ...entry(), lastErrorCode: 7 }), NOW)).toBeNull();
  });

  it('keeps a null error code', () => {
    expect(decodeEntry(JSON.stringify({ ...entry(), lastErrorCode: null }), NOW)?.lastErrorCode).toBeNull();
  });
});
