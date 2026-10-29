import { describe, expect, it } from 'vitest';
import {
  bucketAccuracy,
  bucketDistance,
  evidenceView,
  formatClock,
  percentile,
  presenceFor,
  summarizeEpisodes,
} from './index';

describe('presenceFor', () => {
  it('classifies QR-only and QR-plus-GPS correctly', () => {
    expect(presenceFor({ startMode: 'qr', qrValid: true })).toEqual({
      presence: 'qr_only',
      trustWeight: 0.7,
    });
    expect(
      presenceFor({
        startMode: 'qr',
        qrValid: true,
        distanceBucket: '0-50',
        accuracyBucket: '<=20',
      }),
    ).toEqual({ presence: 'qr_geo', trustWeight: 0.9 });
  });

  it('does not grant QR trust when the proof is invalid', () => {
    expect(presenceFor({ startMode: 'qr', qrValid: false })).toEqual({
      presence: 'unverified',
      trustWeight: 0.5,
    });
  });

  it('keeps GPS far away in the unverified bucket', () => {
    expect(
      presenceFor({
        startMode: 'gps_nearby',
        qrValid: false,
        distanceBucket: '>300',
        accuracyBucket: '<=20',
      }),
    ).toEqual({ presence: 'unverified', trustWeight: 0.3 });
  });
});

describe('buckets', () => {
  it('maps negative or non-finite input to null', () => {
    expect(bucketDistance(-1)).toBeNull();
    expect(bucketDistance(Number.NaN)).toBeNull();
    expect(bucketAccuracy(-1)).toBeNull();
  });

  it('uses inclusive upper bounds', () => {
    expect(bucketDistance(50)).toBe('0-50');
    expect(bucketDistance(51)).toBe('50-100');
    expect(bucketAccuracy(80)).toBe('51-80');
  });
});

describe('evidence', () => {
  const strong = {
    n: 34,
    days: 5,
    devices: 21,
    clusters: 12,
    ciLow: 18.2,
    ciHigh: 25.1,
    threshold: 9.375,
  };

  it('promotes field verification only when statistical strength is met', () => {
    expect(evidenceView({ ...strong, fieldVerified: true }).evidence).toBe('field_verified');
    expect(
      evidenceView({
        ...strong,
        n: 5,
        devices: 2,
        clusters: 2,
        fieldVerified: true,
      }).evidence,
    ).toBe('none');
  });

  it('never turns a no-excess finding into positive evidence', () => {
    expect(
      evidenceView({
        ...strong,
        ciLow: 2.1,
        ciHigh: 8.9,
      }),
    ).toEqual({ evidence: 'none', direction: 'no_excess' });
  });
});

describe('stats', () => {
  it('computes nearest-rank percentiles', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(percentile([1, 2], 101)).toBeNull();
  });

  it('excludes cancelled and too-short episodes', () => {
    expect(
      summarizeEpisodes([
        { durationS: 600, outcome: 'boarded' },
        { durationS: 1_200, outcome: 'abandoned' },
        { durationS: 10, outcome: 'boarded' },
        { durationS: 900, outcome: 'cancelled' },
      ]),
    ).toMatchObject({ n: 2, medianMin: 10, meanMin: 15, abandonRate: 0.5 });
  });

  it('formats clocks consistently', () => {
    expect(formatClock(43)).toBe('00:43');
    expect(formatClock(3_723)).toBe('01:02:03');
  });
});