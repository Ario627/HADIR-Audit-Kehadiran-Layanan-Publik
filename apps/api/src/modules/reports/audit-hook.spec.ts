import type { PartnerSession } from '../../common/auth/partner-session';
import type { DeviceIdentity } from '../../common/http/request-context';
import type {
  IdempotencyContext,
  IdempotencyService,
} from '../../common/idempotency/idempotency.service';
import type { DevicesRepository } from '../../db/repositories/devices.repository';
import type { OutboxRepository } from '../../db/repositories/outbox.repository';
import type {
  ReportsRepository,
  StoredReportStatus,
} from '../../db/repositories/reports.repository';
import { recordingAudit } from '../../test-support/audit.stub';
import type { Transaction } from '../../db/client';
import type { TransactionRunner } from '../../db/transaction-runner';
import { AppError } from '../../common/errors/app-error';
import { ReportsService } from './reports.service';
import { PartnerReportsService } from '../partner/partner-reports.service';

const passthroughRunner: TransactionRunner = async (work) => work({} as Transaction);

const PUBLIC_ID = 'LPR-2026-004242';
const REPORT_ID = '0192f0c4-0000-7000-8000-0000000000ab';

const DEVICE: DeviceIdentity = {
  hash: 'a'.repeat(64),
  dayHash: 'b'.repeat(64),
  isNew: false,
};

const CONTEXT: IdempotencyContext = { requestId: 'req-1', deviceHash: DEVICE.hash };
const KEY = '0192f0c4-0000-7000-8000-000000000002';

const PARTNER: PartnerSession = {
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

function repositoryDouble(owner: string, status: StoredReportStatus = 'submitted'): ReportsRepository {
  return {
    findReportIdByPublicId: async () => REPORT_ID,
    lockReport: async () => ({ status, deviceHash: owner }),
    findReportIdInInstitution: async () => REPORT_ID,
    lockReportInInstitution: async () => ({ status, deviceHash: owner }),
    updateStatus: async () => undefined,
    appendEvent: async () => 1,
    setFollowUp: async () => undefined,
    contactCiphertext: async () => null,
  } as unknown as ReportsRepository;
}

function buildPartner(
  owner: string,
  status: StoredReportStatus = 'submitted',
): { service: PartnerReportsService; audit: ReturnType<typeof recordingAudit> } {
  const audit = recordingAudit();
  const idempotency = {
    execute: async (
      _input: unknown,
      work: (tx: unknown) => Promise<{ status: number; body: unknown }>,
    ) => {
      const result = await work({});
      return { status: result.status, body: result.body, replayed: false };
    },
  } as unknown as IdempotencyService;
  return {
    service: new PartnerReportsService(
      repositoryDouble(owner, status),
      { enqueue: async () => undefined } as unknown as OutboxRepository,
      idempotency,
      audit.service,
      passthroughRunner,
    ),
    audit,
  };
}

function buildCitizen(
  owner: string,
  status: StoredReportStatus = 'submitted',
): { service: ReportsService; audit: ReturnType<typeof recordingAudit> } {
  const audit = recordingAudit();
  const idempotency = {
    execute: async (
      _input: unknown,
      work: (tx: unknown) => Promise<{ status: number; body: unknown }>,
    ) => {
      const result = await work({});
      return { status: result.status, body: result.body, replayed: false };
    },
  } as unknown as IdempotencyService;
  const devices = {
    findByHash: async () => ({ id: 'd1', trustScore: 0.5, revokedAt: null }),
  } as unknown as DevicesRepository;
  return {
    service: new ReportsService(
      repositoryDouble(owner, status),
      devices,
      idempotency,
      audit.service,
      passthroughRunner,
      { claimForReport: async () => undefined } as never,
    ),
    audit,
  };
}

describe('audit hooks on partner actions', () => {
  it('records the linked partner as the actor, not a placeholder', async () => {
    const { service, audit } = buildPartner('c'.repeat(64));

    await service.act(PUBLIC_ID, { action: 'acknowledge' }, KEY, PARTNER, CONTEXT);

    expect(audit.denials).toHaveLength(0);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({
      action: 'report.partner_action',
      objectId: PUBLIC_ID,
      actor: {
        kind: 'partner',
        userId: PARTNER.userId,
        institutionId: PARTNER.institutionId,
        role: 'responder',
      },
      payload: {
        partnerAction: 'acknowledge',
        from: 'submitted',
        to: 'acknowledged',
      },
    });
  });

  it('writes no audit row when the report is outside the institution', async () => {
    const { service, audit } = buildPartner('c'.repeat(64));
    const repository = (service as unknown as { repository: ReportsRepository }).repository;
    (repository as unknown as { findReportIdInInstitution: unknown }).findReportIdInInstitution =
      async () => null;

    await expect(
      service.act(PUBLIC_ID, { action: 'acknowledge' }, KEY, PARTNER, CONTEXT),
    ).rejects.toBeInstanceOf(AppError);

    expect(audit.records).toHaveLength(0);
    expect(audit.denials).toHaveLength(0);
  });

  it('records a self-corroboration denial', async () => {
    const { service, audit } = buildCitizen(DEVICE.hash);

    await expect(
      service.corroborate(PUBLIC_ID, {}, KEY, DEVICE, CONTEXT),
    ).rejects.toBeInstanceOf(AppError);

    expect(audit.denials[0]).toMatchObject({
      attempted: 'report.corroborate',
      reason: 'self_corroborate',
      actor: { kind: 'citizen', deviceHash: DEVICE.hash },
    });
  });

  it('records no denial when corroboration is legitimate', async () => {
    const { service, audit } = buildCitizen('c'.repeat(64));
    const repository = (service as unknown as { repository: ReportsRepository }).repository;
    (repository as unknown as { addCorroboration: unknown }).addCorroboration = async () => ({
      inserted: true,
      count: 2,
    });

    await service.corroborate(PUBLIC_ID, {}, KEY, DEVICE, CONTEXT);

    expect(audit.denials).toHaveLength(0);
    expect(audit.records[0]).toMatchObject({
      action: 'report.corroborate',
      payload: { alreadyCounted: false },
    });
  });
});
