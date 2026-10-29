import type { PartnerSession } from '../../common/auth/partner-session';
import type { ReportRow, ReportsRepository } from '../../db/repositories/reports.repository';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { OutboxRepository } from '../../db/repositories/outbox.repository';
import { auditStub } from '../../test-support/audit.stub';
import type { Transaction } from '../../db/client';
import type { TransactionRunner } from '../../db/transaction-runner';
import { PartnerReportsService } from './partner-reports.service';

const passthroughRunner: TransactionRunner = async (work) => work({} as Transaction);

const SESSION: PartnerSession = {
  sessionId: '0192f0c4-0000-7000-8000-0000000000f1',
  userId: '0192f0c4-0000-7000-8000-0000000000f2',
  displayName: 'Budi',
  institutionId: '0192f0c4-0000-7000-8000-0000000000f3',
  institutionName: 'Dishub',
  role: 'responder',
  createdAt: new Date('2026-10-27T11:00:00.000Z'),
  lastSeenAt: new Date('2026-10-27T11:59:00.000Z'),
  expiresAt: new Date('2026-11-03T11:00:00.000Z'),
  revokedAt: null,
};

function row(publicId: string): ReportRow {
  return {
    id: `0192f0c4-0000-7000-8000-0000000000${publicId.slice(-2)}`,
    publicId,
    category: 'service_wait',
    status: 'submitted',
    moderation: 'pending',
    stopId: '0192f0c4-0000-7000-8000-0000000000b1',
    stopCode: 'BMS-A12',
    stopName: 'Halte UMP',
    routeId: null,
    deviceHash: 'a'.repeat(64),
    deviceDayHash: 'b'.repeat(64),
    text: 'Halte ini sudah lama tidak ada bus yang datang.',
    institutionId: SESSION.institutionId,
    authorityName: 'Dishub',
    evidenceScore: 0.4,
    evidenceLevel: 'medium',
    contactEmailEnc: null,
    contactEmailHash: null,
    corroborationCount: 0,
    resolvedAt: null,
    createdAt: new Date('2026-10-27T10:00:00.000Z'),
    updatedAt: new Date('2026-10-27T10:00:00.000Z'),
  } as unknown as ReportRow;
}

interface InboxCapture {
  institutionQueries: string[];
  detailQueries: { publicId: string; institutionId: string }[];
}

function buildService(capture: InboxCapture, items: ReportRow[] = [row('LPR-2026-000001')]) {
  const repository = {
    listForInstitution: async (_tx: unknown, institutionId: string) => {
      capture.institutionQueries.push(institutionId);
      return { items, hasMore: false };
    },
    findInInstitution: async (_tx: unknown, publicId: string, institutionId: string) => {
      capture.detailQueries.push({ publicId, institutionId });
      return items.find((item) => item.publicId === publicId) ?? null;
    },
    listEventsFor: async () => [],
    listMediaFor: async () => [],
  } as unknown as ReportsRepository;
  return new PartnerReportsService(
    repository,
    { enqueue: async () => undefined } as unknown as OutboxRepository,
    {} as IdempotencyService,
    auditStub(),
    passthroughRunner,
  );
}

function newCapture(): InboxCapture {
  return { institutionQueries: [], detailQueries: [] };
}

describe('partner inbox', () => {
  it('always scopes the query to the session institution', async () => {
    const capture = newCapture();
    await buildService(capture).listInbox({ limit: 20 }, SESSION);

    expect(capture.institutionQueries).toEqual([SESSION.institutionId]);
  });

  it('never accepts an institution from the caller', async () => {
    const capture = newCapture();
    await buildService(capture).listInbox(
      { limit: 20, institutionId: '0192f0c4-0000-7000-8000-0000000000ff' } as never,
      SESSION,
    );

    expect(capture.institutionQueries).toEqual([SESSION.institutionId]);
  });

  it('maps rows to public list items', async () => {
    const capture = newCapture();
    const result = await buildService(capture).listInbox({ limit: 20 }, SESSION);

    expect(result.items[0]?.publicId).toBe('LPR-2026-000001');
    expect(result.items[0]?.evidenceLevel).toBe('medium');
    expect(result.hasMore).toBe(false);
  });

  it('returns 404 for a report owned by another institution', async () => {
    const capture = newCapture();
    const service = buildService(capture, []);

    await expect(service.inboxDetail('LPR-2026-000999', SESSION)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(capture.detailQueries[0]).toEqual({
      publicId: 'LPR-2026-000999',
      institutionId: SESSION.institutionId,
    });
  });

  it('opens a report that belongs to the institution', async () => {
    const capture = newCapture();
    const detail = await buildService(capture).inboxDetail('LPR-2026-000001', SESSION);

    expect(detail.publicId).toBe('LPR-2026-000001');
  });
});
