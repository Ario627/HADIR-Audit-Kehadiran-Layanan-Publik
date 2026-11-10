import { recordingAudit } from '../../test-support/audit.stub';
import type { PartnerSession } from '../../../common/auth/partner-session';
import type { Transaction } from '../../../db/client';
import type {
  AccountabilityRepository,
  EventRow,
  ReportCaseRow,
  ResponseRow,
  SlaRow,
  VerificationRow,
} from '../../../db/repositories/accountability.repository';
import type { ReportsRepository } from '../../../db/repositories/reports.repository';
import { AccountabilityService } from './accountability.service';

const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const POLRES = '0192f0c4-0000-7000-8000-0000000000a2';
const PUBLIC_ID = 'LPR-2026-000101';
const REPORT_ID = '0192f0c4-0000-7000-8000-0000000000e1';
const USER_ID = '0192f0c4-0000-7000-8000-0000000000b1';

const passthroughRunner = async <T>(
  work: (tx: Transaction) => Promise<T>,
): Promise<T> => work({} as Transaction);

function session(role: PartnerSession['role'] = 'responder'): PartnerSession {
  return {
    sessionId: 'session-1',
    userId: USER_ID,
    displayName: 'Budi',
    institutionId: DISHUB,
    institutionName: 'Dishub',
    role,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-10-01T00:00:00.000Z'),
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    revokedAt: null,
  };
}

function caseRow(overrides: Partial<ReportCaseRow> = {}): ReportCaseRow {
  return {
    id: REPORT_ID,
    publicId: PUBLIC_ID,
    status: 'claimed_resolved',
    category: 'service_wait',
    institutionId: DISHUB,
    institutionName: 'Dishub',
    deviceHash: 'd'.repeat(64),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function event(seq: number, kind: string, at: string): EventRow {
  return {
    seq,
    kind,
    actorType: 'partner',
    actorId: USER_ID,
    createdAt: new Date(at),
  };
}

function verificationRow(overrides: Partial<VerificationRow> = {}): VerificationRow {
  return {
    id: '0192f0c4-0000-7000-8000-0000000000f2',
    method: 'field_inspection',
    verdict: 'confirmed',
    verifierKind: 'independent_institution',
    verifierInstitutionId: POLRES,
    verifierUserId: null,
    verifierLabel: 'Polrestabes',
    note: null,
    evidenceUrls: ['https://bukti.test/1'],
    verifiedAt: new Date('2026-10-05T00:00:00.000Z'),
    ...overrides,
  };
}

function slaRow(): SlaRow {
  return {
    reportId: REPORT_ID,
    policyVersion: 'sla-v1',
    priority: 'normal',
    acknowledgeHours: 24,
    respondHours: 72,
    resolveHours: 168,
    acknowledgeDue: new Date('2026-10-02T00:00:00.000Z'),
    respondDue: new Date('2026-10-04T00:00:00.000Z'),
    resolveDue: new Date('2026-10-08T00:00:00.000Z'),
  };
}

interface Doubles {
  repository: AccountabilityRepository;
  reports: ReportsRepository;
  appended: { kind: string; payload: Record<string, unknown> }[];
  statuses: string[];
  auditRecorder: { records: Record<string, unknown>[] };
}

function build(overrides: {
  caseRow?: ReportCaseRow | null;
  events?: readonly EventRow[];
  responses?: readonly ResponseRow[];
  verifications?: readonly VerificationRow[];
  closures?: readonly {
    id: string;
    answer: string;
    note: string | null;
    mediaId: string | null;
    createdAt: Date;
  }[];
  sla?: SlaRow | null;
  insertFails?: boolean;
  breaches?: Awaited<ReturnType<AccountabilityRepository['listBreaches']>>;
} = {}): { service: AccountabilityService; doubles: Doubles } {
  const appended: { kind: string; payload: Record<string, unknown> }[] = [];
  const statuses: string[] = [];

  const repository = {
    findCase: async () => (overrides.caseRow === undefined ? caseRow() : overrides.caseRow),
    lockCase: async () => (overrides.caseRow === undefined ? caseRow() : overrides.caseRow),
    listEvents: async () => [...(overrides.events ?? [])],
    listResponses: async () => [...(overrides.responses ?? [])],
    listVerifications: async () =>
      overrides.insertFails === true
        ? [verificationRow({ verdict: 'refuted', evidenceUrls: [] })]
        : [...(overrides.verifications ?? [])],
    listClosureAnswers: async () => [...(overrides.closures ?? [])],
    listAttestations: async () => [],
    attachAttestation: async () => true,
    findSla: async () => (overrides.sla === undefined ? slaRow() : overrides.sla),
    insertResponse: async () => '0192f0c4-0000-7000-8000-0000000000f9',
    insertVerification: async () => '0192f0c4-0000-7000-8000-0000000000fa',
    listBreaches: async () => overrides.breaches ?? [],
  } as unknown as AccountabilityRepository;

  const reports = {
    appendEvent: async (
      _tx: Transaction,
      _reportId: string,
      values: { kind: string; payload: Record<string, unknown> },
    ) => {
      appended.push({ kind: values.kind, payload: values.payload });
      return appended.length;
    },
    updateStatus: async (_tx: Transaction, _id: string, status: string) => {
      statuses.push(status);
    },
  } as unknown as ReportsRepository;

  const auditRecorder = recordingAudit();
  const audit = auditRecorder.service;

  return {
    service: new AccountabilityService(
      repository,
      reports,
      audit,
      passthroughRunner,
    ),
    doubles: {
      repository,
      reports,
      appended,
      statuses,
      auditRecorder: {
        records: auditRecorder.records,
      },
    },
  };
}

describe('AccountabilityService.caseFile', () => {
  it('rejects an unknown report', async () => {
    const { service } = build({ caseRow: null });
    await expect(service.caseFile(PUBLIC_ID)).rejects.toThrow(/tidak ditemukan/u);
  });

  it('builds milestones from the hashed event chain', async () => {
    const { service } = build({
      events: [
        event(1, 'submitted', '2026-10-01T00:00:00.000Z'),
        event(2, 'acknowledged', '2026-10-01T05:00:00.000Z'),
        event(3, 'responded', '2026-10-02T00:00:00.000Z'),
        event(4, 'claimed_resolved', '2026-10-04T00:00:00.000Z'),
      ],
    });
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.milestones.entries.map((entry) => entry.key)).toEqual([
      'submitted',
      'acknowledged',
      'responded',
      'claimed_resolved',
    ]);
    expect(file.milestones.current).toBe('claimed_resolved');
    expect(file.milestones.terminal).toBeNull();
  });

  it('marks a disputed case as terminal', async () => {
    const { service } = build({
      events: [
        event(1, 'submitted', '2026-10-01T00:00:00.000Z'),
        event(2, 'claimed_resolved', '2026-10-04T00:00:00.000Z'),
        event(3, 'disputed', '2026-10-06T00:00:00.000Z'),
      ],
      verifications: [verificationRow({ verdict: 'refuted', evidenceUrls: [] })],
    });
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.milestones.terminal).toBe('disputed');
    expect(file.resolution.outcome).toBe('disputed');
  });

  it('reports an unverified claim as undecided rather than resolved', async () => {
    const { service } = build({
      events: [event(1, 'submitted', '2026-10-01T00:00:00.000Z')],
      verifications: [],
    });
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.resolution.outcome).toBe('undecided');
    expect(file.resolution.reason).toContain('Belum ada verifikasi');
  });

  it('verifies when an independent institution confirms', async () => {
    const { service } = build({
      events: [event(1, 'submitted', '2026-10-01T00:00:00.000Z')],
      verifications: [verificationRow()],
    });
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.resolution.outcome).toBe('verified');
    expect(file.verifications[0]?.verifierLabel).toBe('Polrestabes');
  });

  it('computes the SLA view from the frozen row and the event times', async () => {
    const { service } = build({
      events: [
        event(1, 'submitted', '2026-10-01T00:00:00.000Z'),
        event(2, 'acknowledged', '2026-10-03T00:00:00.000Z'),
      ],
    });
    const file = await service.caseFile(PUBLIC_ID);
    const acknowledge = file.sla?.phases.find((phase) => phase.phase === 'acknowledge');
    expect(acknowledge?.metAt).toBe('2026-10-03T00:00:00.000Z');
    expect(file.sla?.policyVersion).toBe('sla-v1');
  });

  it('returns a null SLA when the report predates the policy', async () => {
    const { service } = build({ sla: null });
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.sla).toBeNull();
  });

  it('always publishes resolution caveats', async () => {
    const { service } = build();
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.caveats.join(' ')).toContain('tidak pernah memutuskan sendiri');
  });
});

describe('AccountabilityService.addResponse', () => {
  it('stores the response and appends a responded event', async () => {
    const { service, doubles } = build();
    const created = await service.addResponse(
      PUBLIC_ID,
      { kind: 'initial', body: 'Perbaikan dijadwalkan minggu depan.', evidenceUrls: [] },
      session(),
    );
    expect(created.institutionId).toBe(DISHUB);
    expect(doubles.appended.map((entry) => entry.kind)).toEqual(['responded']);
    expect(doubles.auditRecorder.records.map((entry) => entry.action)).toContain(
      'report.response_published',
    );
  });

  it('refuses a report owned by another institution', async () => {
    const { service } = build({ caseRow: caseRow({ institutionId: POLRES }) });
    await expect(
      service.addResponse(
        PUBLIC_ID,
        { kind: 'initial', body: 'Perbaikan dijadwalkan minggu depan.', evidenceUrls: [] },
        session(),
      ),
    ).rejects.toThrow(/tidak ditemukan/u);
  });

  it('refuses a response on a rejected report', async () => {
    const { service } = build({ caseRow: caseRow({ status: 'rejected' }) });
    await expect(
      service.addResponse(
        PUBLIC_ID,
        { kind: 'initial', body: 'Perbaikan dijadwalkan minggu depan.', evidenceUrls: [] },
        session(),
      ),
    ).rejects.toThrow(/status rejected/u);
  });

  it('refuses a response on an already verified report', async () => {
    const { service } = build({ caseRow: caseRow({ status: 'verified_resolved' }) });
    await expect(
      service.addResponse(
        PUBLIC_ID,
        { kind: 'initial', body: 'Perbaikan dijadwalkan minggu depan.', evidenceUrls: [] },
        session(),
      ),
    ).rejects.toThrow(/verified_resolved/u);
  });
});

describe('AccountabilityService.verifyResolution', () => {
  const ADMIN = '0192f0c4-0000-7000-8000-0000000000d1';

  it('refuses verification outside claimed_resolved or disputed', async () => {
    const { service } = build({ caseRow: caseRow({ status: 'acknowledged' }) });
    await expect(
      service.verifyResolution(
        PUBLIC_ID,
        { method: 'field_inspection', verdict: 'confirmed', evidenceUrls: ['https://b.test/1'] },
        { adminId: ADMIN },
      ),
    ).rejects.toThrow(/claimed_resolved/u);
  });

  it('reopens the case when a refutation lands', async () => {
    const { service, doubles } = build({ insertFails: true });
    const result = await service.verifyResolution(
      PUBLIC_ID,
      { method: 'field_inspection', verdict: 'confirmed', evidenceUrls: ['https://b.test/1'] },
      { adminId: ADMIN },
    );
    expect(result.outcome).toBe('disputed');
    expect(result.status).toBe('disputed');
    expect(doubles.statuses).toContain('disputed');
    expect(doubles.appended.map((entry) => entry.kind)).toContain('disputed');
    expect(doubles.auditRecorder.records.map((entry) => entry.action)).toContain(
      'report.resolution_verified',
    );
  });

  it('refuses a report without an owning institution', async () => {
    const { service } = build({ caseRow: caseRow({ institutionId: null }) });
    await expect(
      service.verifyResolution(
        PUBLIC_ID,
        { method: 'panel_review', verdict: 'confirmed', evidenceUrls: ['https://b.test/1'] },
        { adminId: ADMIN },
      ),
    ).rejects.toThrow(/tanpa institusi/u);
  });

  it('records a platform panel review', async () => {
    const { service, doubles } = build();
    const result = await service.verifyResolution(
      PUBLIC_ID,
      { method: 'panel_review', verdict: 'refuted', note: 'Masih ada antrean panjang.' },
      { adminId: ADMIN },
    );
    expect(result.publicId).toBe(PUBLIC_ID);
    expect(doubles.auditRecorder.records.map((entry) => entry.action)).toContain(
      'report.resolution_verified',
    );
  });
});

describe('AccountabilityService citizen confirmation', () => {
  it('counts a citizen yes answer as an independent confirmation', async () => {
    const { service } = build({
      closures: [
        {
          id: 'closure-1',
          answer: 'yes',
          note: 'Antrean sudah normal.',
          mediaId: null,
          createdAt: new Date('2026-10-06T00:00:00.000Z'),
        },
      ],
    });
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.resolution.outcome).toBe('verified');
    expect(file.resolution.supporting).toBe(1);
    expect(file.verifications[0]?.verifierKind).toBe('citizen');
  });

  it('treats a citizen no answer as a refutation', async () => {
    const { service } = build({
      closures: [
        {
          id: 'closure-1',
          answer: 'no',
          note: 'Masih menunggu lama.',
          mediaId: null,
          createdAt: new Date('2026-10-06T00:00:00.000Z'),
        },
      ],
    });
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.resolution.outcome).toBe('disputed');
  });

  it('treats a partial answer as inconclusive', async () => {
    const { service } = build({
      closures: [
        {
          id: 'closure-1',
          answer: 'partial',
          note: 'Lebih cepat tapi belum konsisten.',
          mediaId: null,
          createdAt: new Date('2026-10-06T00:00:00.000Z'),
        },
      ],
    });
    const file = await service.caseFile(PUBLIC_ID);
    expect(file.resolution.outcome).toBe('undecided');
    expect(file.resolution.inconclusive).toBe(1);
  });
});

describe('AccountabilityService.breaches', () => {
  it('computes the worst overdue phase in hours', async () => {
    const { service } = build({
      breaches: [
        {
          publicId: PUBLIC_ID,
          category: 'service_wait',
          status: 'acknowledged',
          institutionName: 'Dishub',
          priority: 'normal',
          acknowledgeDue: new Date('2026-10-01T00:00:00.000Z'),
          respondDue: new Date('2026-10-01T01:00:00.000Z'),
          resolveDue: new Date('2026-10-01T02:00:00.000Z'),
          acknowledgedAt: new Date('2026-10-01T00:30:00.000Z'),
          respondedAt: null,
          resolvedAt: null,
        },
      ],
    });
    const items = await service.breaches(50, 1);
    expect(items).toHaveLength(1);
    expect(items[0]?.phase).toBe('acknowledge');
    expect(items[0]?.hoursLate).toBeGreaterThan(0);
    expect(items[0]?.escalation).toBeGreaterThanOrEqual(1);
  });

  it('filters items below the requested escalation', async () => {
    const { service } = build({
      breaches: [
        {
          publicId: PUBLIC_ID,
          category: 'service_wait',
          status: 'submitted',
          institutionName: 'Dishub',
          priority: 'low',
          acknowledgeDue: new Date(Date.now() - 3_600_000),
          respondDue: new Date(Date.now() + 3_600_000),
          resolveDue: new Date(Date.now() + 7_200_000),
          acknowledgedAt: null,
          respondedAt: null,
          resolvedAt: null,
        },
      ],
    });
    const items = await service.breaches(50, 3);
    expect(items).toHaveLength(0);
  });
});
