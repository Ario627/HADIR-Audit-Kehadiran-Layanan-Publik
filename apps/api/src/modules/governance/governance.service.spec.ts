import { recordingAudit } from '../../test-support/audit.stub';
import type { PartnerSession } from '../../common/auth/partner-session';
import type { DeviceIdentity } from '../../common/http/request-context';
import type { Transaction } from '../../db/client';
import type {
  AppealRow,
  GovernanceRepository,
  PanelCandidateRow,
  PanelGrantRow,
} from '../../db/repositories/governance.repository';
import type { ReportsRepository } from '../../db/repositories/reports.repository';
import { GovernanceService } from './governance.service';

const CITY = '0192f0c4-0000-7000-8000-0000000000c0';
const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const POLRES = '0192f0c4-0000-7000-8000-0000000000a2';
const REPORT_ID = '0192f0c4-0000-7000-8000-0000000000e1';
const PUBLIC_ID = 'LPR-2026-000101';
const ADMIN_ID = '0192f0c4-0000-7000-8000-0000000000d1';
const DEVICE = 'd'.repeat(64);

const passthroughRunner = async <T>(
  work: (tx: Transaction) => Promise<T>,
): Promise<T> => work({} as Transaction);

function partnerSession(
  institutionId = POLRES,
  role: PartnerSession['role'] = 'responder',
): PartnerSession {
  return {
    sessionId: 'session-1',
    userId: '0192f0c4-0000-7000-8000-0000000000b1',
    displayName: 'Budi',
    institutionId,
    institutionName: 'Polrestabes',
    role,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-10-01T00:00:00.000Z'),
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    revokedAt: null,
  };
}

const device: DeviceIdentity = { hash: DEVICE, dayHash: 'e'.repeat(64), isNew: false };

function grant(overrides: Partial<PanelGrantRow> = {}): PanelGrantRow {
  return {
    id: 'grant-1',
    reportId: REPORT_ID,
    institutionId: POLRES,
    institutionName: 'Polrestabes',
    claimantInstitutionId: DISHUB,
    claimantInstitutionName: 'Dishub',
    cityId: CITY,
    role: 'verifier',
    status: 'active',
    createdAt: new Date('2026-10-02T00:00:00.000Z'),
    decidedAt: new Date('2026-10-02T00:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  };
}

function appeal(overrides: Partial<AppealRow> = {}): AppealRow {
  return {
    id: '0192f0c4-0000-7000-8000-0000000000f1',
    publicId: PUBLIC_ID,
    reportId: REPORT_ID,
    grounds: 'resolution',
    status: 'submitted',
    statement: 'Masalah masih terjadi setelah diklaim selesai.',
    evidenceUrls: [],
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    outcomeTransition: null,
    createdAt: new Date('2026-10-05T00:00:00.000Z'),
    reportStatus: 'claimed_resolved',
    deviceHash: DEVICE,
    ...overrides,
  };
}

interface Doubles {
  auditRecorder: { records: Record<string, unknown>[] };
  appended: { kind: string; payload: Record<string, unknown> }[];
  statuses: string[];
  appliedVerdicts: string[];
}

function build(
  overrides: {
    report?: {
      id: string;
      publicId: string;
      status: string;
      cityId: string | null;
      institutionId: string | null;
      deviceHash: string;
      moderation: string;
      createdAt: Date;
    } | null;
    grants?: readonly PanelGrantRow[];
    candidates?: readonly PanelCandidateRow[];
    appeals?: readonly AppealRow[];
    appealCounts?: { total: number; byGrounds: Record<string, number> };
    insertedAppealId?: string | null;
    activeVerifier?: boolean;
    institution?: { id: string; name: string; cityId: string | null; cityName: string | null } | null;
    counts?: Record<string, number>;
  } = {},
): { service: GovernanceService; doubles: Doubles } {
  const appended: { kind: string; payload: Record<string, unknown> }[] = [];
  const statuses: string[] = [];
  const appliedVerdicts: string[] = [];
  const audit = recordingAudit();

  const defaultReport = {
    id: REPORT_ID,
    publicId: PUBLIC_ID,
    status: 'claimed_resolved',
    cityId: CITY,
    institutionId: DISHUB,
    deviceHash: DEVICE,
    moderation: 'approved',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
  };

  const repository = {
    findReportContext: async () => (overrides.report === undefined ? defaultReport : overrides.report),
    findDecisionMoment: async () => new Date(Date.now() - 86_400_000),
    listPanelGrants: async () => [...(overrides.grants ?? [grant()])],
    listPanelCandidates: async () => [...(overrides.candidates ?? [])],
    upsertPanelGrant: async () => 'grant-new',
    revokePanelGrant: async () => true,
    findActiveVerifier: async () => overrides.activeVerifier ?? true,
    applyPanelVerdict: async (_tx: Transaction, _id: string, status: string) => {
      appliedVerdicts.push(status);
      return status;
    },
    attachAttestation: async () => true,
    listAppeals: async () => [...(overrides.appeals ?? [])],
    listAppealsForDevice: async () => [...(overrides.appeals ?? [])],
    listAppealQueue: async () => [...(overrides.appeals ?? [])],
    countAppealsForReport: async () => overrides.appealCounts ?? { total: 0, byGrounds: {} },
    insertAppeal: async () => (overrides.insertedAppealId === undefined ? '0192f0c4-0000-7000-8000-0000000000f1' : overrides.insertedAppealId),
    findAppeal: async () => (overrides.appeals ?? [appeal()])[0] ?? null,
    decideAppeal: async () => true,
    findInstitution: async () =>
      overrides.institution === undefined
        ? { id: POLRES, name: 'Polrestabes', cityId: CITY, cityName: 'Semarang' }
        : overrides.institution,
    listInstitutions: async () => [],
    scorecardCounts: async () => ({
      reportsReceived: overrides.counts?.reportsReceived ?? 50,
      reportsAcknowledged: overrides.counts?.reportsAcknowledged ?? 40,
      reportsResponded: overrides.counts?.reportsResponded ?? 35,
      slaTracked: overrides.counts?.slaTracked ?? 20,
      slaMet: overrides.counts?.slaMet ?? 15,
      claimsResolved: overrides.counts?.claimsResolved ?? 10,
      claimsVerified: overrides.counts?.claimsVerified ?? 7,
      claimsDisputed: overrides.counts?.claimsDisputed ?? 1,
      appealsDecided: overrides.counts?.appealsDecided ?? 6,
      appealsOverturned: overrides.counts?.appealsOverturned ?? 1,
    }),
    listCitySlaOverrides: async () => [
      {
        cityId: CITY,
        cityName: 'Semarang',
        priority: 'high',
        acknowledgeHours: 4,
        respondHours: 12,
        resolveHours: 48,
        sourceUrl: 'https://walikota.test/perwali/1',
        note: null,
      },
    ],
    upsertCitySlaOverride: async () => true,
    panelReportsForInstitution: async () => [
      {
        publicId: PUBLIC_ID,
        status: 'claimed_resolved',
        category: 'service_wait',
        claimantName: 'Dishub',
        role: 'verifier',
      },
    ],
  } as unknown as GovernanceRepository;

  const reports = {
    appendEvent: async (
      _tx: Transaction,
      _id: string,
      values: { kind: string; payload: Record<string, unknown> },
    ) => {
      appended.push({ kind: values.kind, payload: values.payload });
      return appended.length;
    },
    updateStatus: async (_tx: Transaction, _id: string, status: string) => {
      statuses.push(status);
    },
  } as unknown as ReportsRepository;

  return {
    service: new GovernanceService(repository, reports, audit.service, passthroughRunner),
    doubles: {
      auditRecorder: { records: audit.records },
      appended,
      statuses,
      appliedVerdicts,
    },
  };
}

describe('GovernanceService.panel', () => {
  it('reports the quorum and whether this institution can verify', async () => {
    const { service } = build();
    const view = await service.panel(PUBLIC_ID, POLRES);
    expect(view.quorum.present).toBe(1);
    expect(view.quorum.met).toBe(true);
    expect(view.canVerify).toBe(true);
    expect(view.claimantInstitutionName).toBe('Dishub');
  });

  it('denies verification capability to an uninvolved institution', async () => {
    const { service } = build();
    const view = await service.panel(PUBLIC_ID, DISHUB);
    expect(view.canVerify).toBe(false);
  });

  it('refuses a report without a city', async () => {
    const { service } = build({
      report: {
        id: REPORT_ID,
        publicId: PUBLIC_ID,
        status: 'claimed_resolved',
        cityId: null,
        institutionId: DISHUB,
        deviceHash: DEVICE,
        moderation: 'approved',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await expect(service.panel(PUBLIC_ID, null)).rejects.toThrow(/belum memiliki kota/u);
  });

  it('marks a revoked grant in the view', async () => {
    const { service } = build({
      grants: [grant({ status: 'revoked', revokedAt: new Date('2026-10-03T00:00:00.000Z') })],
    });
    const view = await service.panel(PUBLIC_ID, POLRES);
    expect(view.quorum.present).toBe(0);
    expect(view.canVerify).toBe(false);
    expect(view.grants[0]?.revokedAt).not.toBeNull();
  });
});

describe('GovernanceService.invitePanelMember', () => {
  it('refuses the claimant as a panel member', async () => {
    const { service } = build();
    await expect(
      service.invitePanelMember(PUBLIC_ID, { institutionId: DISHUB, role: 'verifier' }, ADMIN_ID),
    ).rejects.toThrow(/tidak dapat menjadi panel/u);
  });

  it('refuses an institution from another city', async () => {
    const { service } = build({
      institution: { id: POLRES, name: 'Polrestabes', cityId: 'other-city', cityName: 'Jakarta' },
    });
    await expect(
      service.invitePanelMember(PUBLIC_ID, { institutionId: POLRES, role: 'verifier' }, ADMIN_ID),
    ).rejects.toThrow(/satu kota/u);
  });

  it('refuses a report without a city', async () => {
    const { service } = build({
      report: {
        id: REPORT_ID,
        publicId: PUBLIC_ID,
        status: 'claimed_resolved',
        cityId: null,
        institutionId: DISHUB,
        deviceHash: DEVICE,
        moderation: 'approved',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await expect(
      service.invitePanelMember(PUBLIC_ID, { institutionId: POLRES, role: 'verifier' }, ADMIN_ID),
    ).rejects.toThrow(/belum memiliki kota/u);
  });

  it('grants a same-city verifier and records the audit action', async () => {
    const { service, doubles } = build();
    const view = await service.invitePanelMember(
      PUBLIC_ID,
      { institutionId: POLRES, role: 'verifier' },
      ADMIN_ID,
    );
    expect(view.publicId).toBe(PUBLIC_ID);
    expect(
      doubles.auditRecorder.records.map((entry) => entry.action),
    ).toContain('admin.panel_granted');
  });
});

describe('GovernanceService.partnerPanelReports', () => {
  it('lists reports where this institution is an active panel member', async () => {
    const { service } = build();
    const result = await service.partnerPanelReports(partnerSession(), 20);
    expect(result.count).toBe(1);
    expect(result.items[0]?.role).toBe('verifier');
  });
});

describe('GovernanceService.verifyAsPanel', () => {
  it('refuses a viewer role', async () => {
    const { service } = build();
    await expect(
      service.verifyAsPanel(
        PUBLIC_ID,
        { method: 'panel_review', verdict: 'confirmed', evidenceUrls: ['https://b.test/1'] },
        partnerSession(POLRES, 'viewer'),
      ),
    ).rejects.toThrow(/viewer tidak dapat/u);
  });

  it('refuses an institution without an active verifier grant', async () => {
    const { service } = build({ activeVerifier: false });
    await expect(
      service.verifyAsPanel(
        PUBLIC_ID,
        { method: 'panel_review', verdict: 'confirmed', evidenceUrls: ['https://b.test/1'] },
        partnerSession(),
      ),
    ).rejects.toThrow(/bukan verifier panel aktif/u);
  });

  it('refuses a report that is not awaiting a verdict', async () => {
    const { service } = build({
      report: {
        id: REPORT_ID,
        publicId: PUBLIC_ID,
        status: 'acknowledged',
        cityId: CITY,
        institutionId: DISHUB,
        deviceHash: DEVICE,
        moderation: 'approved',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await expect(
      service.verifyAsPanel(
        PUBLIC_ID,
        { method: 'panel_review', verdict: 'confirmed', evidenceUrls: ['https://b.test/1'] },
        partnerSession(),
      ),
    ).rejects.toThrow(/claimed_resolved/u);
  });

  it('applies verified_resolved for a confirmation', async () => {
    const { service, doubles } = build();
    const result = await service.verifyAsPanel(
      PUBLIC_ID,
      { method: 'field_inspection', verdict: 'confirmed', evidenceUrls: ['https://b.test/1'] },
      partnerSession(),
    );
    expect(result.status).toBe('verified_resolved');
    expect(doubles.appliedVerdicts).toEqual(['verified_resolved']);
    expect(doubles.appended.map((entry) => entry.kind)).toEqual(['verified_resolved']);
    expect(doubles.auditRecorder.records.map((entry) => entry.action)).toContain(
      'report.panel_verdict',
    );
  });

  it('applies disputed for a refutation', async () => {
    const { service, doubles } = build();
    const result = await service.verifyAsPanel(
      PUBLIC_ID,
      { method: 'panel_review', verdict: 'refuted', note: 'Masih ada antrean.' },
      partnerSession(),
    );
    expect(result.status).toBe('disputed');
    expect(doubles.appliedVerdicts).toEqual(['disputed']);
    expect(doubles.appended.map((entry) => entry.kind)).toEqual(['disputed']);
  });

  it('treats an inconclusive verdict as a confirmation of nothing', async () => {
    const { service, doubles } = build();
    await service.verifyAsPanel(
      PUBLIC_ID,
      { method: 'panel_review', verdict: 'inconclusive' },
      partnerSession(),
    );
    expect(doubles.appliedVerdicts).toEqual(['verified_resolved']);
  });
});

describe('GovernanceService.submitAppeal', () => {
  it('refuses a report owned by another device', async () => {
    const { service } = build({
      report: {
        id: REPORT_ID,
        publicId: PUBLIC_ID,
        status: 'rejected',
        cityId: CITY,
        institutionId: DISHUB,
        deviceHash: 'f'.repeat(64),
        moderation: 'approved',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await expect(
      service.submitAppeal(
        PUBLIC_ID,
        { grounds: 'rejection', statement: 'Laporan saya memenuhi syarat.', evidenceUrls: [] },
        device,
      ),
    ).rejects.toThrow(/tidak ditemukan/u);
  });

  it('refuses an appeal before a decision exists', async () => {
    const { service } = build({
      report: {
        id: REPORT_ID,
        publicId: PUBLIC_ID,
        status: 'acknowledged',
        cityId: CITY,
        institutionId: DISHUB,
        deviceHash: DEVICE,
        moderation: 'approved',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await expect(
      service.submitAppeal(
        PUBLIC_ID,
        { grounds: 'service', statement: 'Tidak ada tindak lanjut selama tiga minggu.', evidenceUrls: [] },
        device,
      ),
    ).rejects.toThrow(/setelah keputusan/u);
  });

  it('refuses a duplicate ground', async () => {
    const { service } = build({ insertedAppealId: null });
    await expect(
      service.submitAppeal(
        PUBLIC_ID,
        { grounds: 'resolution', statement: 'Masalah masih terjadi sampai sekarang.', evidenceUrls: [] },
        device,
      ),
    ).rejects.toThrow(/sudah ada/u);
  });

  it('records an appeal and appends a disputed event', async () => {
    const { service, doubles } = build({
      appeals: [appeal()],
      report: {
        id: REPORT_ID,
        publicId: PUBLIC_ID,
        status: 'verified_resolved',
        cityId: CITY,
        institutionId: DISHUB,
        deviceHash: DEVICE,
        moderation: 'approved',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    const view = await service.submitAppeal(
      PUBLIC_ID,
      {
        grounds: 'resolution',
        statement: 'Masalah masih terjadi setelah diklaim selesai.',
        evidenceUrls: ['https://bukti.test/1'],
      },
      device,
    );
    expect(view.grounds).toBe('resolution');
    expect(doubles.appended.map((entry) => entry.kind)).toEqual(['disputed']);
    expect(doubles.auditRecorder.records.map((entry) => entry.action)).toContain(
      'report.appeal_submitted',
    );
  });
});

describe('GovernanceService.reportAppeals', () => {
  it('refuses to read appeals of a report owned by someone else', async () => {
    const { service } = build({
      report: {
        id: REPORT_ID,
        publicId: PUBLIC_ID,
        status: 'rejected',
        cityId: CITY,
        institutionId: DISHUB,
        deviceHash: 'f'.repeat(64),
        moderation: 'approved',
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    });
    await expect(service.reportAppeals(PUBLIC_ID, device)).rejects.toThrow(/tidak ditemukan/u);
  });

  it('returns the appeals of the report', async () => {
    const { service } = build({ appeals: [appeal()] });
    const items = await service.reportAppeals(PUBLIC_ID, device);
    expect(items).toHaveLength(1);
    expect(items[0]?.publicId).toBe(PUBLIC_ID);
  });
});

describe('GovernanceService.decideAppeal', () => {
  it('refuses to decide an already decided appeal', async () => {
    const { service } = build({ appeals: [appeal({ status: 'upheld', decidedAt: new Date() })] });
    await expect(
      service.decideAppeal('0192f0c4-0000-7000-8000-0000000000f1', { outcome: 'upheld', note: 'Sudah diputuskan sebelumnya.' }, ADMIN_ID),
    ).rejects.toThrow(/sudah diputuskan/u);
  });

  it('reopens the report when a resolution appeal is overturned', async () => {
    const { service, doubles } = build();
    const result = await service.decideAppeal(
      '0192f0c4-0000-7000-8000-0000000000f1',
      { outcome: 'overturned', note: 'Terbukti masih ada antrean panjang.' },
      ADMIN_ID,
    );
    expect(result.status).toBe('overturned');
    expect(result.reportStatus).toBe('disputed');
    expect(doubles.statuses).toEqual(['disputed']);
    expect(doubles.appended.map((entry) => entry.kind)).toEqual(['disputed']);
    expect(doubles.auditRecorder.records.map((entry) => entry.action)).toContain(
      'admin.appeal_decided',
    );
  });

  it('keeps the report untouched when the appeal is upheld', async () => {
    const { service, doubles } = build();
    const result = await service.decideAppeal(
      '0192f0c4-0000-7000-8000-0000000000f1',
      { outcome: 'upheld', note: 'Klaim selesai sudah didukung bukti lapangan.' },
      ADMIN_ID,
    );
    expect(result.status).toBe('upheld');
    expect(result.reportStatus).toBe('claimed_resolved');
    expect(doubles.statuses).toEqual([]);
    expect(doubles.appended).toEqual([]);
  });

  it('marks an inadmissible appeal without touching the report', async () => {
    const { service, doubles } = build();
    const result = await service.decideAppeal(
      '0192f0c4-0000-7000-8000-0000000000f1',
      { outcome: 'inadmissible', note: 'Banding diajukan melewati batas waktu.' },
      ADMIN_ID,
    );
    expect(result.status).toBe('inadmissible');
    expect(doubles.statuses).toEqual([]);
  });
});

describe('GovernanceService.scorecard', () => {
  it('returns a publishable scorecard above the gates', async () => {
    const { service } = build();
    const card = await service.scorecard(POLRES, 90);
    expect(card.state).toBe('published');
    expect(card.overall).not.toBeNull();
    expect(card.dimensions).toHaveLength(4);
    expect(card.caveats.length).toBeGreaterThan(0);
  });

  it('withholds the score below the report gate', async () => {
    const { service } = build({ counts: { reportsReceived: 3, reportsAcknowledged: 3 } });
    const card = await service.scorecard(POLRES, 90);
    expect(card.state).toBe('insufficient');
    expect(card.overall).toBeNull();
  });

  it('refuses an unknown institution', async () => {
    const { service } = build({ institution: null });
    await expect(service.scorecard(POLRES, 90)).rejects.toThrow(/tidak ditemukan/u);
  });
});

describe('GovernanceService.citySlaOverrides', () => {
  it('lists the configured overrides', async () => {
    const { service } = build();
    const items = await service.citySlaOverrides(CITY);
    expect(items[0]?.priority).toBe('high');
  });

  it('saves an override and returns the stored row', async () => {
    const { service, doubles } = build();
    const saved = await service.upsertCitySlaOverride(
      CITY,
      {
        priority: 'high',
        acknowledgeHours: 4,
        respondHours: 12,
        resolveHours: 48,
        sourceUrl: 'https://walikota.test/perwali/1',
      },
      ADMIN_ID,
    );
    expect(saved.cityId).toBe(CITY);
    expect(doubles.auditRecorder.records.map((entry) => entry.action)).toContain(
      'admin.city_sla_set',
    );
  });
});
