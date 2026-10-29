import type { AnalyticsAggregate } from './partner-analytics.service';
import { K_THRESHOLD, MIN_MEDIAN_SAMPLE, toPartnerAnalytics } from './partner-analytics.service';

const WINDOW = {
  start: new Date('2026-10-01T00:00:00.000Z'),
  end: new Date('2026-10-31T00:00:00.000Z'),
};
const NOW = new Date('2026-10-31T00:00:00.000Z');

function aggregate(overrides: Partial<AnalyticsAggregate> = {}): AnalyticsAggregate {
  return {
    total: 40,
    byStatus: [
      { key: 'acknowledged', count: 30 },
      { key: 'disputed', count: 2 },
    ],
    byCategory: [
      { key: 'service_wait', count: 38 },
      { key: 'stop_safety', count: 2 },
    ],
    medianFirstResponseHours: 3.456,
    medianResolutionHours: null,
    claimedResolvedCount: 10,
    disputedCount: 2,
    corroboratedCount: 20,
    ...overrides,
  };
}

describe('toPartnerAnalytics', () => {
  it('reports totals and buckets above the k threshold', () => {
    const result = toPartnerAnalytics(aggregate(), WINDOW, NOW);
    expect(result.totalReports).toBe(40);
    expect(result.totalSuppressed).toBe(false);
    expect(result.kThreshold).toBe(K_THRESHOLD);
    expect(result.byStatus[0]).toEqual({ key: 'acknowledged', count: 30, suppressed: false });
  });

  it('suppresses a bucket below the threshold without hiding the rest', () => {
    const result = toPartnerAnalytics(aggregate(), WINDOW, NOW);
    expect(result.byStatus[1]).toEqual({ key: 'disputed', count: null, suppressed: true });
    expect(result.byCategory[1]).toEqual({ key: 'stop_safety', count: null, suppressed: true });
  });

  it('suppresses every figure when the total is below the threshold', () => {
    const result = toPartnerAnalytics(aggregate({ total: 3 }), WINDOW, NOW);
    expect(result.totalReports).toBeNull();
    expect(result.totalSuppressed).toBe(true);
    expect(result.claimedResolvedRate).toBeNull();
    expect(result.disputedRate).toBeNull();
    expect(result.corroborationRate).toBeNull();
    expect(result.medianFirstResponseHours).toBeNull();
  });

  it('withholds medians until the sample is large enough', () => {
    const small = toPartnerAnalytics(
      aggregate({ total: MIN_MEDIAN_SAMPLE - 1 }),
      WINDOW,
      NOW,
    );
    expect(small.medianFirstResponseHours).toBeNull();

    const enough = toPartnerAnalytics(aggregate({ total: MIN_MEDIAN_SAMPLE }), WINDOW, NOW);
    expect(enough.medianFirstResponseHours).toBe(3.5);
  });

  it('keeps counts but drops medians when no report exists', () => {
    const result = toPartnerAnalytics(
      aggregate({ total: 0, byStatus: [], byCategory: [], claimedResolvedCount: 0, disputedCount: 0, corroboratedCount: 0 }),
      WINDOW,
      NOW,
    );
    expect(result.totalReports).toBeNull();
    expect(result.totalSuppressed).toBe(false);
    expect(result.medianResolutionHours).toBeNull();
    expect(result.byStatus).toEqual([]);
  });

  it('rounds rates to three decimals', () => {
    const result = toPartnerAnalytics(aggregate(), WINDOW, NOW);
    expect(result.claimedResolvedRate).toBe(0.25);
    expect(result.disputedRate).toBe(0.05);
    expect(result.corroborationRate).toBe(0.5);
  });

  it('exposes the window in days', () => {
    const result = toPartnerAnalytics(aggregate(), WINDOW, NOW);
    expect(result.window.days).toBe(30);
    expect(result.window.start).toBe('2026-10-01T00:00:00.000Z');
  });
});
