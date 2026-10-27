import { auditStub } from '../../test-support/audit.stub';
import type { PartnerSession } from '../../common/auth/partner-session';
import type {
  IdempotencyContext,
  IdempotencyService,
} from '../../common/idempotency/idempotency.service';
import type { DevicesRepository } from '../../db/repositories/devices.repository';
import type {
  ReportsRepository,
  StoredReportStatus,
} from '../../db/repositories/reports.repository';
import {
  ReportsService,
  allowedPartnerActions,
  eventKindForAction,
  partnerTransition,
} from './reports.service';

const PUBLIC_ID = 'LPR-2026-004242';
const REPORT_ID = '0192f0c4-0000-7000-8000-0000000000ab';

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

const CONTEXT: IdempotencyContext = { requestId: 'req-1' };
const KEY = '0192f0c4-0000-7000-8000-000000000002';

const ALL_STATUSES: readonly StoredReportStatus[] = [
  'draft',
  'submitted',
  'triaged',
  'acknowledged',
  'in_progress',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
  'rejected',
  'closed',
];

interface CallLog {
  statusWrites: { status: StoredReportStatus; resolvedAt: Date | null }[];
  events: { kind: string; actorType: string; payload: Record<string, unknown> }[];
}

function repositoryDouble(status: StoredReportStatus, log: CallLog): ReportsRepository {
  return {
    findReportIdInInstitution: async () => REPORT_ID,
    lockReportInInstitution: async () => ({ status, deviceHash: 'c'.repeat(64) }),
    updateStatus: async (
      _tx: unknown,
      _id: string,
      next: StoredReportStatus,
      resolvedAt: Date | null,
    ) => {
      log.statusWrites.push({ status: next, resolvedAt });
    },
    appendEvent: async (
      _tx: unknown,
      _id: string,
      values: { kind: string; actorType: string; payload: Record<string, unknown> },
    ) => {
      log.events.push({
        kind: values.kind,
        actorType: values.actorType,
        payload: values.payload,
      });
      return log.events.length;
    },
  } as unknown as ReportsRepository;
}

function buildService(status: StoredReportStatus): { service: ReportsService; log: CallLog } {
  const log: CallLog = { statusWrites: [], events: [] };
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
    service: new ReportsService(repositoryDouble(status, log), devices, idempotency, auditStub()),
    log,
  };
}

describe('partnerTransition', () => {
  it('allows acknowledgement from a freshly submitted report', () => {
    expect(partnerTransition('submitted', 'acknowledge')).toBe('acknowledged');
  });

  it('refuses to claim resolution before acknowledging', () => {
    expect(partnerTransition('submitted', 'claim_resolved')).toBeNull();
  });

  it('allows claiming resolution once acknowledged', () => {
    expect(partnerTransition('acknowledged', 'claim_resolved')).toBe('claimed_resolved');
  });

  it('allows a disputed report to be answered again', () => {
    expect(partnerTransition('disputed', 'respond')).toBe('in_progress');
    expect(partnerTransition('disputed', 'claim_resolved')).toBe('claimed_resolved');
  });

  it('treats verified and rejected reports as terminal', () => {
    expect(allowedPartnerActions('verified_resolved')).toEqual([]);
    expect(allowedPartnerActions('rejected')).toEqual([]);
    expect(allowedPartnerActions('closed')).toEqual([]);
  });

  it('does not let a partner verify a closure themselves', () => {
    for (const status of ALL_STATUSES) {
      expect(partnerTransition(status, 'claim_resolved')).not.toBe('verified_resolved');
    }
  });

  it('maps every action to an audit event kind', () => {
    expect(eventKindForAction('acknowledge')).toBe('acknowledged');
    expect(eventKindForAction('request_info')).toBe('info_requested');
    expect(eventKindForAction('schedule')).toBe('scheduled');
    expect(eventKindForAction('respond')).toBe('responded');
    expect(eventKindForAction('claim_resolved')).toBe('claimed_resolved');
    expect(eventKindForAction('reject_with_reason')).toBe('rejected');
  });
});

describe('ReportsService.partnerAction', () => {
  it('moves a submitted report to acknowledged', async () => {
    const { service, log } = buildService('submitted');

    const result = await service.partnerAction(
      PUBLIC_ID,
      { action: 'acknowledge', note: 'Kami periksa minggu ini.' },
      KEY,
      SESSION,
      CONTEXT,
    );

    expect(result.status).toBe('acknowledged');
    expect(result.previousStatus).toBe('submitted');
    expect(log.statusWrites).toEqual([{ status: 'acknowledged', resolvedAt: null }]);
  });

  it('marks the event as simulated so it is never mistaken for a real partner', async () => {
    const { service, log } = buildService('submitted');

    await service.partnerAction(
      PUBLIC_ID,
      { action: 'acknowledge' },
      KEY,
      SESSION,
      CONTEXT,
    );

    expect(log.events[0]?.actorType).toBe('partner');
    expect(log.events[0]?.payload).not.toHaveProperty('simulated');
  });

  it('records the transition source and target', async () => {
    const { service, log } = buildService('acknowledged');

    await service.partnerAction(
      PUBLIC_ID,
      { action: 'claim_resolved', note: 'Atap sudah ditambal pagi ini.' },
      KEY,
      SESSION,
      CONTEXT,
    );

    expect(log.events[0]?.payload).toMatchObject({
      action: 'claim_resolved',
      from: 'acknowledged',
      to: 'claimed_resolved',
    });
  });

  it('refuses a transition the state machine forbids', async () => {
    const { service, log } = buildService('submitted');

    await expect(
      service.partnerAction(
        PUBLIC_ID,
        { action: 'claim_resolved', note: 'cukup panjang' },
        KEY,
        SESSION,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(log.statusWrites).toEqual([]);
  });

  it('lists the actions that are available when rejecting a transition', async () => {
    const { service } = buildService('verified_resolved');

    await expect(
      service.partnerAction(PUBLIC_ID, { action: 'acknowledge' }, KEY, SESSION, CONTEXT),
    ).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
      errors: [{ field: 'action', code: 'not_allowed' }],
    });
  });

  it('keeps resolvedAt empty until a citizen verifies', async () => {
    const { service, log } = buildService('acknowledged');

    await service.partnerAction(
      PUBLIC_ID,
      { action: 'claim_resolved', note: 'Sudah diperbaiki kemarin.' },
      KEY,
      SESSION,
      CONTEXT,
    );

    expect(log.statusWrites[0]?.resolvedAt).toBeNull();
  });

  it('refuses a viewer even when the transition is valid', async () => {
    const { service, log } = buildService('submitted');

    await expect(
      service.partnerAction(
        PUBLIC_ID,
        { action: 'acknowledge' },
        KEY,
        { ...SESSION, role: 'viewer' },
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(log.statusWrites).toEqual([]);
  });

  it('refuses a report that belongs to another institution', async () => {
    const log: CallLog = { statusWrites: [], events: [] };
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
    const repository = {
      findReportIdInInstitution: async () => null,
      lockReportInInstitution: async () => null,
      updateStatus: async () => undefined,
      appendEvent: async () => 1,
    } as unknown as ReportsRepository;
    const service = new ReportsService(repository, devices, idempotency, auditStub());

    await expect(
      service.partnerAction(PUBLIC_ID, { action: 'acknowledge' }, KEY, SESSION, CONTEXT),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(log.statusWrites).toEqual([]);
  });
});
