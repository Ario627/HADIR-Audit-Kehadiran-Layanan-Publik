import { describe, expect, it } from 'vitest';
import {
  adminProfileSchema,
  adminReportDetailSchema,
  adminReportQueueSchema,
  auditListSchema,
  chainVerifySchema,
  cityListSchema,
  featureFlagListSchema,
  moderationResultSchema,
  noticeListSchema,
  retentionRunListSchema,
  retentionSchema,
  rupImportSchema,
  rupListSchema,
} from './admin-guards';
import {
  citySlaListSchema,
  commitmentHistorySchema,
  commitmentListSchema,
  holidayListSchema,
  panelCandidatesSchema,
  slaBreachListSchema,
} from './governance-guards';

const reportRow = {
  publicId: 'LPR-2026-000123',
  category: 'service_wait',
  status: 'submitted',
  moderation: 'pending',
  stopCode: 'BMS-A12',
  stopName: 'Halte UMP',
  institutionName: 'Dishub Banyumas',
  text: 'Bus tidak datang selama dua puluh menit.',
  evidenceLevel: 'indication',
  corroborationCount: 3,
  createdAt: '2026-11-10T03:00:00.000Z',
};

describe('admin guards', () => {
  it('accepts an admin profile', () => {
    const result = adminProfileSchema.safeParse({
      adminId: '0192f0d0-0000-7000-8000-000000000001',
      email: 'mod@hadir.id',
      displayName: 'Moderator Satu',
      role: 'moderator',
      expiresAt: '2026-11-10T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown admin role', () => {
    expect(
      adminProfileSchema.safeParse({
        adminId: '0192f0d0-0000-7000-8000-000000000001',
        email: 'mod@hadir.id',
        displayName: 'Moderator Satu',
        role: 'root',
        expiresAt: '2026-11-10T12:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('accepts a moderation queue and report detail', () => {
    const queue = adminReportQueueSchema.safeParse({ items: [reportRow], count: 1 });
    expect(queue.success).toBe(true);

    const detail = adminReportDetailSchema.safeParse({
      ...reportRow,
      followUpAt: null,
      resolvedAt: null,
      evidenceScore: 0.45,
    });
    expect(detail.success).toBe(true);
  });

  it('rejects a queue with a row missing text or moderation', () => {
    expect(adminReportQueueSchema.safeParse({ items: [{ ...reportRow, text: '' }] }).success).toBe(
      false,
    );
    expect(
      adminReportQueueSchema.safeParse({ items: [{ ...reportRow, moderation: 'ditunda' }] }).success,
    ).toBe(false);
  });

  it('accepts notices and flags', () => {
    expect(
      noticeListSchema.safeParse({ items: [
        {
          id: '0192f0d0-0000-7000-8000-000000000002',
          kind: 'detour',
          text: 'Rute dialihkan karena perbaikan jalan.',
          sourceUrl: 'https://dishub.go.id/pengumuman',
          cityId: null,
          stopId: null,
          routeId: null,
          institutionId: null,
          startsAt: null,
          endsAt: null,
          createdAt: '2026-11-10T03:00:00.000Z',
        },
      ] }).success,
    ).toBe(true);

    expect(
      featureFlagListSchema.safeParse({
        items: [
          { key: 'board.v2', value: true, description: null, updatedAt: '2026-11-10T03:00:00.000Z' },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts audit rows and rejects unknown actor types', () => {
    const entry = {
      id: '0192f0d0-0000-7000-8000-000000000003',
      action: 'admin.moderation',
      objectType: 'report',
      objectId: 'LPR-2026-000123',
      actorType: 'moderator',
      actorId: '0192f0d0-0000-7000-8000-000000000001',
      requestId: '01M72GW6EJM43XXW7RH6ES9303',
      payload: { from: 'pending', to: 'approved' },
      createdAt: '2026-11-10T03:00:00.000Z',
    };
    expect(auditListSchema.safeParse({ items: [entry] }).success).toBe(true);
    expect(auditListSchema.safeParse({ items: [{ ...entry, actorType: 'root' }] }).success).toBe(
      false,
    );
  });

  it('accepts a chain verification result and rejects unknown break reasons', () => {
    const base = {
      checkedReports: 30,
      checkedEvents: 120,
      breaks: [{ reportPublicId: 'LPR-2026-000123', seq: 4, kind: 'submitted', reason: 'gap' }],
      ok: false,
    };
    expect(chainVerifySchema.safeParse(base).success).toBe(true);
    expect(
      chainVerifySchema.safeParse({
        ...base,
        breaks: [{ ...base.breaks[0], reason: 'hilang' }],
      }).success,
    ).toBe(false);
  });

  it('accepts RUP imports with per-row issues', () => {
    expect(
      rupImportSchema.safeParse({
        inserted: 2,
        updated: 1,
        skipped: 1,
        issues: [{ row: 3, message: 'pagu bukan angka' }],
        dryRun: true,
      }).success,
    ).toBe(true);
  });

  it('accepts RUP rows and cities', () => {
    expect(
      rupListSchema.safeParse({ items: [
        {
          id: '0192f0d0-0000-7000-8000-000000000004',
          satker: 'Dinas Perhubungan',
          name: 'Pengadaan bus sedang',
          location: 'Banyumas',
          fundingSource: 'APBD',
          pagu: '1200000000',
          method: 'Tender',
          fiscalYear: 2026,
          status: 'aktif',
          sourceUrl: 'https://rup.go.id/paket/1',
          fetchedAt: '2026-11-10T03:00:00.000Z',
        },
      ] }).success,
    ).toBe(true);

    expect(
      cityListSchema.safeParse({
        items: [
          {
            id: '0192f0d0-0000-7000-8000-000000000005',
            code: 'BMS',
            name: 'Banyumas',
            timezone: 'Asia/Jakarta',
          },
        ],
        count: 1,
      }).success,
    ).toBe(true);
  });

  it('accepts retention policy and runs', () => {
    expect(
      retentionSchema.safeParse({
        version: '2026-11-10T03:00:00.000Z',
        description: ['uploads.pending: delete data lebih tua dari 2 hari'],
        actionable: 11,
        protectedCount: 5,
        decisions: [
          {
            dataset: 'uploads.pending',
            action: 'delete',
            effectiveDays: 2,
            cutoff: '2026-11-08T03:00:00.000Z',
            overridden: false,
            rejectedOverride: null,
            reason: 'Unggahan tanpa laporan tidak punya nilai bukti.',
          },
        ],
        warnings: [],
      }).success,
    ).toBe(true);

    expect(
      retentionRunListSchema.safeParse({
        items: [
          {
            startedAt: '2026-11-10T03:00:00.000Z',
            finishedAt: null,
            rowsRemoved: 120,
            triggeredBy: 'manual',
            errorCode: null,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts a moderation result', () => {
    expect(
      moderationResultSchema.safeParse({
        publicId: 'LPR-2026-000123',
        moderation: 'approved',
        previousModeration: 'pending',
        mediaUpdated: 2,
      }).success,
    ).toBe(true);
  });
});

describe('governance guards for console', () => {
  it('accepts SLA breaches', () => {
    expect(
      slaBreachListSchema.safeParse({ items: [
        {
          publicId: 'LPR-2026-000123',
          category: 'service_wait',
          status: 'acknowledged',
          institutionName: 'Dishub',
          priority: 'normal',
          phase: 'respond',
          dueAt: '2026-11-09T03:00:00.000Z',
          hoursLate: 12.5,
          escalation: 2,
        },
      ] }).success,
    ).toBe(true);
  });

  it('accepts city SLA overrides', () => {
    expect(
      citySlaListSchema.safeParse({ items: [
        {
          cityId: '0192f0d0-0000-7000-8000-000000000005',
          cityName: 'Banyumas',
          priority: 'high',
          acknowledgeHours: 8,
          respondHours: 24,
          resolveHours: 72,
          sourceUrl: 'https://perda.go.id/sla',
          note: null,
        },
      ] }).success,
    ).toBe(true);
  });

  it('accepts commitments and their history', () => {
    expect(
      commitmentListSchema.safeParse({ items: [
        {
          id: '0192f0d0-0000-7000-8000-000000000006',
          routeId: null,
          stopId: '0192f0d0-0000-7000-8000-000000000007',
          kind: 'headway',
          dayScope: 'all',
          headwayMin: 10,
          spanStart: null,
          spanEnd: null,
          sourceDocumentUrl: 'https://dishub.go.id/janji',
          sourceDocumentTitle: 'Janji layanan 2026',
          sourceDocumentVersion: 'v2',
          validFrom: '2026-01-01',
          validUntil: null,
          status: 'verified',
          verifiedAt: '2026-01-05T03:00:00.000Z',
          institutionName: 'Dishub',
        },
      ] }).success,
    ).toBe(true);

    expect(
      commitmentHistorySchema.safeParse({ items: [
        {
          validFrom: '2026-01-01',
          validUntil: null,
          headwayMin: 10,
          sourceDocumentUrl: 'https://dishub.go.id/janji',
          sourceDocumentVersion: 'v2',
          supersededBy: null,
          days: 120,
        },
      ] }).success,
    ).toBe(true);
  });

  it('accepts holidays with both scopes', () => {
    expect(
      holidayListSchema.safeParse({
        items: [
          {
            date: '2026-12-25',
            name: 'Natal',
            scope: 'national',
            cityId: null,
            sourceUrl: 'https://kemenag.go.id',
          },
          {
            date: '2026-04-21',
            name: 'Hari jadi kota',
            scope: 'city',
            cityId: '0192f0d0-0000-7000-8000-000000000005',
            sourceUrl: 'https://banyumaskab.go.id',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts panel candidates and rejects unknown refusals', () => {
    const base = {
      publicId: 'LPR-2026-000123',
      cityId: '0192f0d0-0000-7000-8000-000000000005',
      candidates: [
        {
          institutionId: '0192f0d0-0000-7000-8000-000000000008',
          displayName: 'Ombudsman',
          eligible: true,
          role: 'verifier',
          refusal: null,
          reason: 'Memenuhi syarat kota.',
        },
      ],
    };
    expect(panelCandidatesSchema.safeParse(base).success).toBe(true);
    expect(
      panelCandidatesSchema.safeParse({
        ...base,
        candidates: [{ ...base.candidates[0], refusal: 'asal' }],
      }).success,
    ).toBe(false);
  });
});
