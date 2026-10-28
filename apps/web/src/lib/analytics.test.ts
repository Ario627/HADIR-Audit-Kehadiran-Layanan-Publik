import { describe, expect, it } from 'vitest';
import type { AnalyticsBucket, PartnerAnalytics } from '@hadir/contracts';
import {
  DEFAULT_WINDOW_DAYS,
  K_THRESHOLD,
  MAX_WINDOW_DAYS,
  MIN_MEDIAN_SAMPLE,
  bucketNote,
  hasAnyBucket,
  medianNote,
  rateNote,
  suppressedBuckets,
  totalNote,
  windowDaysLabel,
  windowSpanNote,
} from './analytics';

function bucket(overrides: Partial<AnalyticsBucket> & { key: string }): AnalyticsBucket {
  return { key: overrides.key, count: overrides.count ?? 0, suppressed: overrides.suppressed ?? false };
}

const ANALYTICS: PartnerAnalytics = {
  window: { start: '2026-09-28T00:00:00.000Z', end: '2026-10-28T00:00:00.000Z', days: 30 },
  totalReports: 40,
  totalSuppressed: false,
  byStatus: [],
  byCategory: [],
  medianFirstResponseHours: 3,
  medianResolutionHours: 20,
  claimedResolvedRate: 0.4,
  disputedRate: 0.1,
  corroborationRate: 0.2,
  kThreshold: K_THRESHOLD,
  generatedAt: '2026-10-28T08:00:00.000Z',
};

describe('threshold constants', () => {
  it('match the server values', () => {
    expect(K_THRESHOLD).toBe(5);
    expect(MIN_MEDIAN_SAMPLE).toBe(10);
    expect(DEFAULT_WINDOW_DAYS).toBe(30);
    expect(MAX_WINDOW_DAYS).toBe(180);
  });
});

describe('totalNote', () => {
  it('explains suppression instead of showing a number', () => {
    const note = totalNote(null, true);
    expect(note).toContain('disembunyikan');
    expect(note).toContain(String(K_THRESHOLD));
  });

  it('distinguishes an empty range from a hidden one', () => {
    expect(totalNote(0, false)).toContain('Tidak ada laporan');
    expect(totalNote(null, false)).toContain('tidak bisa dihitung');
  });

  it('stays silent when the total is publishable', () => {
    expect(totalNote(40, false)).toBeNull();
  });
});

describe('medianNote', () => {
  it('hides medians together with a suppressed total', () => {
    expect(medianNote(null, true)).toContain('Median disembunyikan');
  });

  it('names the sample threshold when there is not enough data', () => {
    const note = medianNote(6, false);
    expect(note).toContain(String(MIN_MEDIAN_SAMPLE));
    expect(note).toContain('6');
  });

  it('stays silent once the sample is large enough', () => {
    expect(medianNote(MIN_MEDIAN_SAMPLE, false)).toBeNull();
  });
});

describe('rateNote', () => {
  it('hides ratios together with a suppressed total', () => {
    expect(rateNote(null, true)).toContain('Rasio disembunyikan');
  });

  it('names the k threshold below the cut', () => {
    expect(rateNote(2, false)).toContain(String(K_THRESHOLD));
  });

  it('stays silent above the cut', () => {
    expect(rateNote(K_THRESHOLD, false)).toBeNull();
  });
});

describe('suppressedBuckets', () => {
  it('counts only the hidden buckets', () => {
    expect(
      suppressedBuckets([
        bucket({ key: 'a', suppressed: true }),
        bucket({ key: 'b', count: 9 }),
        bucket({ key: 'c', suppressed: true }),
      ]),
    ).toBe(2);
  });

  it('returns zero for an empty list', () => {
    expect(suppressedBuckets([])).toBe(0);
  });
});

describe('bucketNote', () => {
  it('is silent when nothing is hidden', () => {
    expect(bucketNote([bucket({ key: 'a', count: 9 })])).toBeNull();
  });

  it('counts the hidden groups', () => {
    const note = bucketNote([
      bucket({ key: 'a', suppressed: true }),
      bucket({ key: 'b', suppressed: true }),
    ]);
    expect(note).toContain('2 kelompok');
    expect(note).toContain(String(K_THRESHOLD));
  });
});

describe('windowDaysLabel', () => {
  it('uses the singular for one day', () => {
    expect(windowDaysLabel(1)).toBe('1 hari');
    expect(windowDaysLabel(30)).toBe('30 hari');
  });
});

describe('windowSpanNote', () => {
  it('stays silent when the server honoured the request', () => {
    expect(windowSpanNote(ANALYTICS, 30)).toBeNull();
    expect(windowSpanNote(ANALYTICS, null)).toBeNull();
  });

  it('explains a clamp by the server', () => {
    const note = windowSpanNote({ ...ANALYTICS, window: { ...ANALYTICS.window, days: 180 } }, 365);
    expect(note).toContain('180');
    expect(note).toContain(String(MAX_WINDOW_DAYS));
  });
});

describe('hasAnyBucket', () => {
  it('is false for an empty list', () => {
    expect(hasAnyBucket([])).toBe(false);
  });

  it('is true when a bucket survives suppression', () => {
    expect(hasAnyBucket([bucket({ key: 'a', count: 7 })])).toBe(true);
  });

  it('is true when a bucket is suppressed', () => {
    expect(hasAnyBucket([bucket({ key: 'a', suppressed: true })])).toBe(true);
  });
});
