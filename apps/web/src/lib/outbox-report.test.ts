import { beforeEach, describe, expect, it } from 'vitest';
import {
  decodeEntry,
  encodeEntry,
  findForDraft,
  findForEpisode,
  type OutboxReportEntry,
} from './outbox';
import { queueEpisodeEnd, queueReport } from './outbox-queue';
import { readOutbox, writeOutbox } from './outbox-store';

const NOW = 1_760_000_000_000;
const DRAFT_ID = '0192f0d0-0000-7000-8000-000000000011';
const EPISODE_ID = '0192f0d0-0000-7000-8000-000000000012';
const EVENT_ID = '0192f0d0-0000-7000-8000-000000000013';
const KEY_ID = '0192f0d0-0000-7000-8000-000000000014';
const TRIAGE_ID = '0192f0d0-0000-7000-8000-000000000015';

const TEXT = 'Bus tidak berhenti selama tiga kali lewat meski halte kosong.';

function reportRaw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: EVENT_ID,
    kind: 'report.create',
    targetId: DRAFT_ID,
    idempotencyKey: KEY_ID,
    createdAt: NOW - 1_000,
    attempts: 0,
    nextAttemptAt: NOW,
    lastErrorCode: null,
    body: {
      category: 'service_wait',
      stopCode: 'H-001',
      text: TEXT,
      triageSessionId: TRIAGE_ID,
      clientEventId: EVENT_ID,
    },
    ...overrides,
  });
}

beforeEach(async () => {
  await writeOutbox([]);
});

describe('queueReport', () => {
  it('menyimpan satu entri laporan di antrean perangkat', async () => {
    const stored = await queueReport(
      {
        draftId: DRAFT_ID,
        stopCode: 'H-001',
        category: 'service_wait',
        text: TEXT,
        triageSessionId: TRIAGE_ID,
        clientEventId: EVENT_ID,
        idempotencyKey: KEY_ID,
      },
      NOW,
    );
    expect(stored).toBe(true);
    const entries = await readOutbox(NOW);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('report.create');
  });

  it('menolak draf yang sudah ada di antrean', async () => {
    const input = {
      draftId: DRAFT_ID,
      stopCode: 'H-001',
      category: 'service_wait' as const,
      text: TEXT,
      triageSessionId: null,
      clientEventId: EVENT_ID,
      idempotencyKey: KEY_ID,
    };
    expect(await queueReport(input, NOW)).toBe(true);
    expect(await queueReport(input, NOW)).toBe(false);
    expect(await readOutbox(NOW)).toHaveLength(1);
  });

  it('hidup bersama penutupan episode di antrean yang sama', async () => {
    await queueReport(
      {
        draftId: DRAFT_ID,
        stopCode: 'H-001',
        category: 'service_wait',
        text: TEXT,
        triageSessionId: null,
        clientEventId: EVENT_ID,
        idempotencyKey: KEY_ID,
      },
      NOW,
    );
    await queueEpisodeEnd(
      {
        episodeId: EPISODE_ID,
        outcome: 'boarded',
        clientEndedAt: new Date(NOW - 5_000).toISOString(),
        clientEventId: '0192f0d0-0000-7000-8000-000000000016',
        idempotencyKey: '0192f0d0-0000-7000-8000-000000000017',
      },
      NOW,
    );
    const entries = await readOutbox(NOW);
    expect(entries.map((item) => item.kind).sort()).toEqual(['episode.end', 'report.create']);
  });
});

describe('findForDraft', () => {
  it('menemukan entri laporan untuk draf tertentu', async () => {
    const entry = decodeEntry(reportRaw(), NOW);
    expect(entry).not.toBeNull();
    const found = findForDraft([entry as OutboxReportEntry], DRAFT_ID);
    expect(found?.targetId).toBe(DRAFT_ID);
  });

  it('tidak mencampur draf dengan episode', async () => {
    const entry = decodeEntry(reportRaw(), NOW);
    expect(entry).not.toBeNull();
    expect(findForDraft([entry as OutboxReportEntry], EPISODE_ID)).toBeNull();
    expect(findForEpisode([entry as OutboxReportEntry], DRAFT_ID)).toBeNull();
  });
});

describe('decodeEntry untuk laporan', () => {
  it('menerima entri laporan yang sah', () => {
    const entry = decodeEntry(reportRaw(), NOW);
    expect(entry?.kind).toBe('report.create');
    if (entry?.kind === 'report.create') {
      expect(entry.body.category).toBe('service_wait');
      expect(entry.body.text).toBe(TEXT);
      expect(entry.body.triageSessionId).toBe(TRIAGE_ID);
    }
  });

  it('menolak kategori yang tidak dikenal', () => {
    const raw = JSON.parse(reportRaw()) as Record<string, unknown>;
    const body = { ...(raw['body'] as Record<string, unknown>), category: 'bebas' };
    expect(decodeEntry(JSON.stringify({ ...raw, body }), NOW)).toBeNull();
  });

  it('menolak kategori yang bukan teks', () => {
    const raw = JSON.parse(reportRaw()) as Record<string, unknown>;
    const body = { ...(raw['body'] as Record<string, unknown>), category: 7 };
    expect(decodeEntry(JSON.stringify({ ...raw, body }), NOW)).toBeNull();
  });

  it('menolak teks kosong', () => {
    const raw = JSON.parse(reportRaw()) as Record<string, unknown>;
    const body = { ...(raw['body'] as Record<string, unknown>), text: '   ' };
    expect(decodeEntry(JSON.stringify({ ...raw, body }), NOW)).toBeNull();
  });

  it('menolak teks melebihi batas', () => {
    const raw = JSON.parse(reportRaw()) as Record<string, unknown>;
    const body = { ...(raw['body'] as Record<string, unknown>), text: 'a'.repeat(2001) };
    expect(decodeEntry(JSON.stringify({ ...raw, body }), NOW)).toBeNull();
  });

  it('menolak triageSessionId yang bukan uuid', () => {
    const raw = JSON.parse(reportRaw()) as Record<string, unknown>;
    const body = { ...(raw['body'] as Record<string, unknown>), triageSessionId: 'xyz' };
    expect(decodeEntry(JSON.stringify({ ...raw, body }), NOW)).toBeNull();
  });

  it('mengizinkan triageSessionId null', () => {
    const raw = JSON.parse(reportRaw()) as Record<string, unknown>;
    const body = { ...(raw['body'] as Record<string, unknown>), triageSessionId: null };
    const entry = decodeEntry(JSON.stringify({ ...raw, body }), NOW);
    expect(entry?.kind).toBe('report.create');
  });

  it('menolak stopCode yang terlalu panjang', () => {
    const raw = JSON.parse(reportRaw()) as Record<string, unknown>;
    const body = { ...(raw['body'] as Record<string, unknown>), stopCode: 'H'.repeat(40) };
    expect(decodeEntry(JSON.stringify({ ...raw, body }), NOW)).toBeNull();
  });

  it('menolak kind asing', () => {
    expect(decodeEntry(reportRaw({ kind: 'report.delete' }), NOW)).toBeNull();
  });

  it('menolak id yang bukan uuid', () => {
    expect(decodeEntry(reportRaw({ id: 'bukan-uuid' }), NOW)).toBeNull();
  });

  it('menolak entri kedaluwarsa', () => {
    const stale = reportRaw({ createdAt: NOW - 49 * 60 * 60 * 1000 });
    expect(decodeEntry(stale, NOW)).toBeNull();
  });

  it('bolak balik lewat encodeEntry', () => {
    const entry = decodeEntry(reportRaw(), NOW);
    expect(entry).not.toBeNull();
    expect(decodeEntry(encodeEntry(entry as OutboxReportEntry), NOW)).toEqual(entry);
  });

  it('tidak menerima badan episode pada entri laporan', () => {
    const raw = JSON.parse(reportRaw()) as Record<string, unknown>;
    const body = {
      outcome: 'boarded',
      clientEndedAt: new Date(NOW).toISOString(),
      clientEventId: EVENT_ID,
    };
    expect(decodeEntry(JSON.stringify({ ...raw, body }), NOW)).toBeNull();
  });
});
