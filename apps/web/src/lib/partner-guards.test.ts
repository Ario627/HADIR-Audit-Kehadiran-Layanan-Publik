import { describe, expect, it } from 'vitest';
import {
  partnerActionResultSchema,
  partnerAnalyticsSchema,
  partnerInboxSchema,
  partnerOtpIssueSchema,
  partnerProfileSchema,
  partnerReportSchema,
} from './partner-guards';

const PROFILE = {
  userId: '0192f0d0-0000-7000-8000-000000000001',
  displayName: 'Petugas Dinhub',
  institutionId: '0192f0d0-0000-7000-8000-000000000002',
  institutionName: 'Dinas Perhubungan',
  role: 'responder',
  expiresAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
};

const REPORT_ITEM = {
  publicId: 'ABC123',
  category: 'service_wait',
  status: 'submitted',
  stopCode: 'BJM-014',
  stopName: 'Halte Pasar Wage',
  corroborationCount: 3,
  evidenceLevel: 'indication',
  createdAt: '2026-10-27T10:00:00.000Z',
};

const REPORT_DETAIL = {
  ...REPORT_ITEM,
  moderation: 'approved',
  text: 'Bus tidak datang lebih dari empat puluh menit di halte ini.',
  authorityName: 'Dinas Perhubungan',
  evidenceScore: 0.62,
  resolvedAt: null,
  events: [
    {
      kind: 'submitted',
      actorType: 'citizen',
      note: null,
      createdAt: '2026-10-27T10:00:00.000Z',
    },
  ],
  followUpAt: null,
  media: [],
};

describe('partnerProfileSchema', () => {
  it('accepts a complete profile', () => {
    const parsed = partnerProfileSchema.safeParse(PROFILE);
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown role', () => {
    expect(partnerProfileSchema.safeParse({ ...PROFILE, role: 'superadmin' }).success).toBe(false);
  });

  it('rejects a missing session expiry', () => {
    expect(partnerProfileSchema.safeParse({ ...PROFILE, expiresAt: 'kemarin' }).success).toBe(false);
  });

  it('rejects a non-object payload', () => {
    expect(partnerProfileSchema.safeParse(null).success).toBe(false);
    expect(partnerProfileSchema.safeParse([]).success).toBe(false);
  });
});

describe('partnerInboxSchema', () => {
  it('accepts an empty inbox', () => {
    const parsed = partnerInboxSchema.safeParse({ items: [], nextCursor: null, hasMore: false });
    expect(parsed.success).toBe(true);
  });

  it('accepts a page with a cursor', () => {
    const parsed = partnerInboxSchema.safeParse({
      items: [REPORT_ITEM],
      nextCursor: 'eyJpZCI6MX0',
      hasMore: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toHaveLength(1);
      expect(parsed.data.hasMore).toBe(true);
    }
  });

  it('rejects a malformed item instead of dropping it silently', () => {
    const parsed = partnerInboxSchema.safeParse({
      items: [{ ...REPORT_ITEM, status: 'hilang' }],
      nextCursor: null,
      hasMore: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a cursor with illegal characters', () => {
    const parsed = partnerInboxSchema.safeParse({
      items: [],
      nextCursor: 'a/b?c',
      hasMore: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('treats a missing hasMore as false', () => {
    const parsed = partnerInboxSchema.safeParse({ items: [], nextCursor: null });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.hasMore).toBe(false);
    }
  });
});

describe('partnerReportSchema', () => {
  it('accepts a report without media', () => {
    expect(partnerReportSchema.safeParse(REPORT_DETAIL).success).toBe(true);
  });

  it('accepts approved media with absolute dimensions', () => {
    const parsed = partnerReportSchema.safeParse({
      ...REPORT_DETAIL,
      media: [
        {
          mediaId: '0192f0d0-0000-7000-8000-000000000003',
          mime: 'image/jpeg',
          width: 800,
          height: 600,
          status: 'approved',
          url: '/v1/reports/ABC123/media/0192f0d0-0000-7000-8000-000000000003',
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unsupported mime type', () => {
    const parsed = partnerReportSchema.safeParse({
      ...REPORT_DETAIL,
      media: [
        {
          mediaId: '0192f0d0-0000-7000-8000-000000000003',
          mime: 'image/gif',
          width: null,
          height: null,
          status: 'approved',
          url: null,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-positive dimensions', () => {
    const parsed = partnerReportSchema.safeParse({
      ...REPORT_DETAIL,
      media: [
        {
          mediaId: '0192f0d0-0000-7000-8000-000000000003',
          mime: 'image/png',
          width: 0,
          height: 100,
          status: 'pending',
          url: null,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an invalid follow-up timestamp', () => {
    expect(
      partnerReportSchema.safeParse({ ...REPORT_DETAIL, followUpAt: 'besok pagi' }).success,
    ).toBe(false);
  });

  it('rejects an invalid event note shape', () => {
    const parsed = partnerReportSchema.safeParse({
      ...REPORT_DETAIL,
      events: [
        { kind: 'submitted', actorType: 'citizen', note: 42, createdAt: '2026-10-27T10:00:00.000Z' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an unknown actor type', () => {
    const parsed = partnerReportSchema.safeParse({
      ...REPORT_DETAIL,
      events: [
        {
          kind: 'submitted',
          actorType: 'robot',
          note: null,
          createdAt: '2026-10-27T10:00:00.000Z',
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('partnerActionResultSchema', () => {
  it('accepts a transition', () => {
    const parsed = partnerActionResultSchema.safeParse({
      publicId: 'ABC123',
      status: 'acknowledged',
      previousStatus: 'submitted',
      scheduledFor: null,
      simulated: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a bad schedule timestamp', () => {
    const parsed = partnerActionResultSchema.safeParse({
      publicId: 'ABC123',
      status: 'in_progress',
      previousStatus: 'acknowledged',
      scheduledFor: 'lusa',
      simulated: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a missing simulated flag', () => {
    const parsed = partnerActionResultSchema.safeParse({
      publicId: 'ABC123',
      status: 'in_progress',
      previousStatus: 'acknowledged',
      scheduledFor: null,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('partnerAnalyticsSchema', () => {
  const base = {
    window: { start: '2026-09-28T00:00:00.000Z', end: '2026-10-28T00:00:00.000Z', days: 30 },
    totalReports: 12,
    totalSuppressed: false,
    byStatus: [{ key: 'submitted', count: 12, suppressed: false }],
    byCategory: [{ key: 'service_wait', count: null, suppressed: true }],
    medianFirstResponseHours: 3.5,
    medianResolutionHours: null,
    claimedResolvedRate: 0.5,
    disputedRate: null,
    corroborationRate: 0.25,
    kThreshold: 5,
    generatedAt: '2026-10-28T00:00:00.000Z',
  };

  it('accepts a suppressed aggregate', () => {
    const parsed = partnerAnalyticsSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.totalSuppressed).toBe(false);
      expect(parsed.data.byCategory[0]?.suppressed).toBe(true);
    }
  });

  it('rejects a rate above one', () => {
    expect(partnerAnalyticsSchema.safeParse({ ...base, claimedResolvedRate: 1.5 }).success).toBe(
      false,
    );
  });

  it('rejects a zero k threshold', () => {
    expect(partnerAnalyticsSchema.safeParse({ ...base, kThreshold: 0 }).success).toBe(false);
  });

  it('rejects an empty window', () => {
    const parsed = partnerAnalyticsSchema.safeParse({
      ...base,
      window: { ...base.window, days: 0 },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a bucket with a non-numeric count', () => {
    const parsed = partnerAnalyticsSchema.safeParse({
      ...base,
      byStatus: [{ key: 'submitted', count: 'dua', suppressed: false }],
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a bucket without a suppression flag', () => {
    const parsed = partnerAnalyticsSchema.safeParse({
      ...base,
      byStatus: [{ key: 'submitted', count: 2 }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('partnerOtpIssueSchema', () => {
  it('accepts a sane issuance', () => {
    const parsed = partnerOtpIssueSchema.safeParse({ expiresInSeconds: 600, resendInSeconds: 60 });
    expect(parsed.success).toBe(true);
  });

  it('rejects an already expired code', () => {
    expect(
      partnerOtpIssueSchema.safeParse({ expiresInSeconds: 5, resendInSeconds: 60 }).success,
    ).toBe(false);
  });

  it('rejects a zero resend window', () => {
    expect(
      partnerOtpIssueSchema.safeParse({ expiresInSeconds: 600, resendInSeconds: 0 }).success,
    ).toBe(false);
  });
});
