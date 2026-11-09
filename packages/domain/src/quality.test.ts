import { describe, expect, it } from 'vitest';
import {
  describeQuality,
  qualityBandOf,
  qualityBreakdown,
  qualityDimensions,
  strongestBand,
  weakestBand,
  type QualityInput,
} from './quality';

function input(overrides: Partial<QualityInput> = {}): QualityInput {
  return {
    n: 48,
    clusters: 12,
    days: 6,
    hours: 10,
    deviceDays: 20,
    ciLow: 16.5,
    ciHigh: 17.5,
    threshold: 7.5,
    designEffect: 1.2,
    lowTrustShare: 0,
    sourceAgeDays: 2,
    corroborationCount: 3,
    fieldVerified: false,
    ...overrides,
  };
}

describe('qualityBandOf', () => {
  it('maps scores to four bands with the documented cut points', () => {
    expect(qualityBandOf(0)).toBe('very_low');
    expect(qualityBandOf(0.24)).toBe('very_low');
    expect(qualityBandOf(0.25)).toBe('low');
    expect(qualityBandOf(0.49)).toBe('low');
    expect(qualityBandOf(0.5)).toBe('moderate');
    expect(qualityBandOf(0.74)).toBe('moderate');
    expect(qualityBandOf(0.75)).toBe('high');
    expect(qualityBandOf(1)).toBe('high');
  });

  it('treats non finite input as very low', () => {
    expect(qualityBandOf(Number.NaN)).toBe('very_low');
    expect(qualityBandOf(Number.POSITIVE_INFINITY)).toBe('very_low');
  });
});

describe('qualityBreakdown dimensions', () => {
  it('always returns five dimensions in a stable order', () => {
    const report = qualityBreakdown(input());
    expect(report.dimensions).toHaveLength(5);
    expect(report.dimensions.map((entry) => entry.dimension)).toEqual([
      ...qualityDimensions(),
    ]);
  });

  it('keeps every score inside the unit interval', () => {
    const report = qualityBreakdown(input());
    for (const entry of report.dimensions) {
      expect(entry.score).toBeGreaterThanOrEqual(0);
      expect(entry.score).toBeLessThanOrEqual(1);
    }
  });

  it('rewards a large, well spread sample', () => {
    const report = qualityBreakdown(input());
    expect(report.dimensions[0]!.band).toBe('high');
    expect(report.dimensions[2]!.band).toBe('high');
    expect(report.band).toBe('high');
  });

  it('lets a wide interval cap the whole assessment', () => {
    const report = qualityBreakdown(input({ ciLow: 12, ciHigh: 20 }));
    expect(report.limiting).toBe('precision');
    expect(report.dimensions[1]!.reasons).toContain('interval_wide');
    expect(report.band).not.toBe('high');
  });

  it('is limited by the weakest dimension, not the average', () => {
    const narrow = qualityBreakdown(
      input({ days: 1, hours: 1, deviceDays: 1, n: 100, clusters: 1 }),
    );
    expect(narrow.limiting).toBe('coverage');
    expect(narrow.band).not.toBe('high');
    expect(narrow.score).toBe(narrow.dimensions[2]!.score);
  });

  it('explains why precision is zero when the threshold is unknown', () => {
    const report = qualityBreakdown(input({ threshold: null }));
    const precision = report.dimensions[1]!;
    expect(precision.score).toBe(0);
    expect(precision.reasons).toContain('threshold_unknown');
    expect(report.warnings).toContain('benchmark_unavailable');
  });

  it('explains why precision is zero when the interval is missing', () => {
    const report = qualityBreakdown(input({ ciLow: null, ciHigh: null }));
    const precision = report.dimensions[1]!;
    expect(precision.reasons).toContain('interval_missing');
    expect(report.warnings).toContain('interval_missing');
  });

  it('penalises precision when the design effect is high', () => {
    const normal = qualityBreakdown(input({ designEffect: 1 }));
    const clustered = qualityBreakdown(input({ designEffect: 4 }));
    expect(clustered.dimensions[1]!.score).toBeLessThan(normal.dimensions[1]!.score);
    expect(clustered.dimensions[1]!.reasons).toContain('design_effect_high');
  });

  it('penalises reliability when low trust dominates', () => {
    const report = qualityBreakdown(input({ lowTrustShare: 0.6 }));
    const reliability = report.dimensions[3]!;
    expect(reliability.reasons).toContain('low_trust_dominant');
    expect(reliability.band).not.toBe('high');
  });

  it('decays reliability as the source gets older', () => {
    const fresh = qualityBreakdown(input({ sourceAgeDays: 1 }));
    const aging = qualityBreakdown(input({ sourceAgeDays: 20 }));
    const stale = qualityBreakdown(input({ sourceAgeDays: 60 }));
    const expired = qualityBreakdown(input({ sourceAgeDays: 400 }));
    expect(fresh.dimensions[3]!.score).toBeGreaterThan(aging.dimensions[3]!.score);
    expect(aging.dimensions[3]!.score).toBeGreaterThan(stale.dimensions[3]!.score);
    expect(stale.dimensions[3]!.score).toBeGreaterThan(expired.dimensions[3]!.score);
    expect(expired.dimensions[3]!.reasons).toContain('source_expired');
  });

  it('treats an unknown source age as a penalty rather than as fresh', () => {
    const unknown = qualityBreakdown(input({ sourceAgeDays: null }));
    const fresh = qualityBreakdown(input({ sourceAgeDays: 1 }));
    expect(unknown.dimensions[3]!.score).toBeLessThan(fresh.dimensions[3]!.score);
    expect(unknown.dimensions[3]!.reasons).toContain('source_age_unknown');
  });

  it('raises corroboration when a field verification exists', () => {
    const none = qualityBreakdown(input({ corroborationCount: 0 }));
    const verified = qualityBreakdown(
      input({ corroborationCount: 0, fieldVerified: true }),
    );
    expect(verified.dimensions[4]!.score).toBeGreaterThan(none.dimensions[4]!.score);
    expect(verified.dimensions[4]!.reasons).toContain('field_verified');
  });

  it('refuses to let field verification rescue an otherwise weak sample', () => {
    const report = qualityBreakdown(
      input({ fieldVerified: true, n: 5, clusters: 1, days: 1, hours: 1, deviceDays: 1 }),
    );
    expect(report.fieldVerifiedEligible).toBe(false);
    expect(report.warnings).toContain('field_verification_not_applicable');
  });

  it('allows field verification when the sample is defensible', () => {
    const report = qualityBreakdown(input({ fieldVerified: true }));
    expect(report.fieldVerifiedEligible).toBe(true);
  });
});

describe('quality helpers', () => {
  it('describes every dimension in Indonesian', () => {
    const lines = describeQuality(qualityBreakdown(input()));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('kekuatan bukti');
    expect(lines[4]).toContain('konfirmasi independen');
  });

  it('picks the strongest and weakest band', () => {
    expect(strongestBand(['low', 'high', 'moderate'])).toBe('high');
    expect(weakestBand(['low', 'high', 'moderate'])).toBe('low');
    expect(weakestBand([])).toBe('high');
    expect(strongestBand([])).toBe('very_low');
  });
});
