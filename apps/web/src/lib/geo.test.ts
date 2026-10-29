import { describe, expect, it } from 'vitest';
import type { StopSummary } from '@hadir/contracts';
import {
  accuracyBucketLabel,
  accuracyBucketOf,
  bboxAround,
  DEFAULT_GEOFENCE_M,
  distanceBucketLabel,
  distanceBucketOf,
  formatDistanceMeters,
  haversineMeters,
  MAX_NEARBY_M,
  nearbyStops,
  offerDecision,
  readFix,
  withinIndonesia,
} from './geo';

const MONAS = { lat: -6.175392, lon: 106.827153 };
const SARINAH = { lat: -6.181_861, lon: 106.824_205 };

function stop(overrides: Partial<StopSummary> & { name: string; code: string }): StopSummary {
  return {
    id: '0192f0d0-0000-7000-8000-000000000001',
    location: { lat: -6.175392, lon: 106.827153 },
    status: 'active',
    isDemo: false,
    routes: [],
    ...overrides,
  };
}

describe('haversineMeters', () => {
  it('returns zero for the same point', () => {
    expect(haversineMeters(MONAS, MONAS)).toBe(0);
  });

  it('matches the degree length for one degree of latitude', () => {
    const meters = haversineMeters({ lat: 0, lon: 100 }, { lat: 1, lon: 100 });
    expect(meters).toBeGreaterThan(110_000);
    expect(meters).toBeLessThan(112_500);
  });

  it('is symmetric', () => {
    const forward = haversineMeters(MONAS, SARINAH);
    const backward = haversineMeters(SARINAH, MONAS);
    expect(Math.abs(forward - backward)).toBeLessThan(1e-6);
  });

  it('keeps short distances close to a planar estimate', () => {
    const meters = haversineMeters(MONAS, SARINAH);
    expect(meters).toBeGreaterThan(700);
    expect(meters).toBeLessThan(900);
  });
});

describe('distanceBucketOf', () => {
  it('maps exact boundaries into the lower bucket', () => {
    expect(distanceBucketOf(0)).toBe('0-50');
    expect(distanceBucketOf(50)).toBe('0-50');
    expect(distanceBucketOf(50.01)).toBe('50-100');
    expect(distanceBucketOf(100)).toBe('50-100');
    expect(distanceBucketOf(100.01)).toBe('100-150');
    expect(distanceBucketOf(150)).toBe('100-150');
    expect(distanceBucketOf(150.01)).toBe('150-300');
    expect(distanceBucketOf(300)).toBe('150-300');
    expect(distanceBucketOf(300.01)).toBe('>300');
  });

  it('rejects unusable numbers', () => {
    expect(distanceBucketOf(null)).toBeNull();
    expect(distanceBucketOf(undefined)).toBeNull();
    expect(distanceBucketOf(Number.NaN)).toBeNull();
    expect(distanceBucketOf(-1)).toBeNull();
  });
});

describe('accuracyBucketOf', () => {
  it('maps exact boundaries into the lower bucket', () => {
    expect(accuracyBucketOf(0)).toBe('<=20');
    expect(accuracyBucketOf(20)).toBe('<=20');
    expect(accuracyBucketOf(20.01)).toBe('21-50');
    expect(accuracyBucketOf(50)).toBe('21-50');
    expect(accuracyBucketOf(50.01)).toBe('51-80');
    expect(accuracyBucketOf(80)).toBe('51-80');
    expect(accuracyBucketOf(80.01)).toBe('81-150');
    expect(accuracyBucketOf(150)).toBe('81-150');
    expect(accuracyBucketOf(150.01)).toBe('>150');
  });

  it('rejects unusable numbers', () => {
    expect(accuracyBucketOf(null)).toBeNull();
    expect(accuracyBucketOf(-0.5)).toBeNull();
  });
});

describe('labels', () => {
  it('renders distance buckets in Indonesian', () => {
    expect(distanceBucketLabel('0-50')).toBe('0-50 m');
    expect(distanceBucketLabel('>300')).toBe('lebih dari 300 m');
  });

  it('renders accuracy buckets in Indonesian', () => {
    expect(accuracyBucketLabel('<=20')).toBe('sampai 20 m');
    expect(accuracyBucketLabel('>150')).toBe('lebih dari 150 m');
  });
});

describe('readFix', () => {
  it('accepts a plausible position', () => {
    const fix = readFix({
      coords: { latitude: MONAS.lat, longitude: MONAS.lon, accuracy: 12 },
      timestamp: 1_700_000_000_000,
    });
    expect(fix).toEqual({
      lat: MONAS.lat,
      lon: MONAS.lon,
      accuracyM: 12,
      atMs: 1_700_000_000_000,
    });
  });

  it('rejects coordinates outside the earth', () => {
    expect(
      readFix({ coords: { latitude: 91, longitude: 0, accuracy: 10 }, timestamp: 1 }),
    ).toBeNull();
    expect(
      readFix({ coords: { latitude: 0, longitude: -181, accuracy: 10 }, timestamp: 1 }),
    ).toBeNull();
  });

  it('rejects the null island fix', () => {
    expect(readFix({ coords: { latitude: 0, longitude: 0, accuracy: 5 }, timestamp: 1 })).toBeNull();
  });

  it('rejects impossible accuracy and timestamps', () => {
    expect(
      readFix({ coords: { latitude: 1, longitude: 100, accuracy: -3 }, timestamp: 1 }),
    ).toBeNull();
    expect(
      readFix({ coords: { latitude: 1, longitude: 100, accuracy: 500_000 }, timestamp: 1 }),
    ).toBeNull();
    expect(readFix({ coords: { latitude: 1, longitude: 100, accuracy: 10 }, timestamp: 0 })).toBeNull();
  });
});

describe('bboxAround', () => {
  it('produces an ordered box that contains the origin', () => {
    const bbox = bboxAround(MONAS, MAX_NEARBY_M);
    expect(bbox).not.toBeNull();
    const parts = (bbox ?? '').split(',').map(Number);
    expect(parts).toHaveLength(4);
    const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
    expect(minLon).toBeLessThan(MONAS.lon);
    expect(maxLon).toBeGreaterThan(MONAS.lon);
    expect(minLat).toBeLessThan(MONAS.lat);
    expect(maxLat).toBeGreaterThan(MONAS.lat);
  });

  it('keeps the box coarse so it cannot pin a precise position', () => {
    const bbox = bboxAround(MONAS, MAX_NEARBY_M) ?? '';
    const parts = bbox.split(',');
    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(part).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it('covers the request radius on both axes', () => {
    const bbox = bboxAround(MONAS, MAX_NEARBY_M);
    const [minLon, minLat, maxLon, maxLat] = (bbox ?? '').split(',').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    expect((MONAS.lon - minLon) * 111_000).toBeGreaterThanOrEqual(MAX_NEARBY_M);
    expect((maxLon - MONAS.lon) * 111_000).toBeGreaterThanOrEqual(MAX_NEARBY_M);
    expect((MONAS.lat - minLat) * 111_000).toBeGreaterThanOrEqual(MAX_NEARBY_M);
    expect((maxLat - MONAS.lat) * 111_000).toBeGreaterThanOrEqual(MAX_NEARBY_M);
  });

  it('stays inside the Indonesian envelope near the edge', () => {
    const bbox = bboxAround({ lat: -10.9, lon: 95.2 }, MAX_NEARBY_M);
    const [minLon, minLat] = (bbox ?? '').split(',').map(Number) as [number, number];
    expect(minLon).toBeGreaterThanOrEqual(94.9);
    expect(minLat).toBeGreaterThanOrEqual(-11.1);
  });

  it('returns null outside the mapped envelope', () => {
    expect(bboxAround({ lat: 25.2, lon: 55.27 }, MAX_NEARBY_M)).toBeNull();
    expect(bboxAround({ lat: 0, lon: 0 }, MAX_NEARBY_M)).toBeNull();
  });

  it('returns null for a useless radius', () => {
    expect(bboxAround(MONAS, 0)).toBeNull();
    expect(bboxAround(MONAS, Number.NaN)).toBeNull();
  });
});

describe('withinIndonesia', () => {
  it('accepts Jakarta and rejects Dubai', () => {
    expect(withinIndonesia(MONAS)).toBe(true);
    expect(withinIndonesia({ lat: 25.2, lon: 55.27 })).toBe(false);
  });
});

describe('offerDecision', () => {
  it('offers when the stop is close and the fix is accurate', () => {
    expect(offerDecision({ distanceM: 30, accuracyM: 15 })).toBe('offer');
    expect(offerDecision({ distanceM: DEFAULT_GEOFENCE_M, accuracyM: 80 })).toBe('offer');
  });

  it('refuses when accuracy is worse than the threshold', () => {
    expect(offerDecision({ distanceM: 10, accuracyM: 81 })).toBe('inaccurate');
    expect(offerDecision({ distanceM: 10, accuracyM: null })).toBe('inaccurate');
  });

  it('refuses when the stop is outside the geofence', () => {
    expect(offerDecision({ distanceM: 151, accuracyM: 20 })).toBe('out_of_range');
    expect(offerDecision({ distanceM: 151, accuracyM: 20, geofenceRadiusM: 400 })).toBe('offer');
    expect(offerDecision({ distanceM: 400, accuracyM: 20, geofenceRadiusM: 500 })).toBe('out_of_range');
  });

  it('never offers without a distance', () => {
    expect(offerDecision({ distanceM: null, accuracyM: 10 })).toBe('out_of_range');
  });
});

describe('nearbyStops', () => {
  const stops: readonly StopSummary[] = [
    stop({
      code: 'AAA',
      name: 'Zeta',
      location: { lat: -6.1758, lon: 106.8275 },
    }),
    stop({
      code: 'BBB',
      name: 'Alfa',
      location: { lat: -6.1758, lon: 106.8275 },
    }),
    stop({
      code: 'CCC',
      name: 'Jauh',
      location: { lat: -6.4, lon: 106.827 },
    }),
  ];

  it('drops stops beyond the radius', () => {
    const found = nearbyStops(stops, MONAS, 12);
    expect(found.map((item) => item.stop.code)).not.toContain('CCC');
  });

  it('sorts by distance then name', () => {
    const found = nearbyStops(stops, MONAS, 12);
    expect(found.map((item) => item.stop.code)).toEqual(['BBB', 'AAA']);
  });

  it('keeps the accuracy used for the ranking', () => {
    const found = nearbyStops(stops, MONAS, 37);
    expect(found.every((item) => item.accuracyM === 37)).toBe(true);
  });

  it('returns an empty list when nothing is near', () => {
    expect(nearbyStops(stops, { lat: 1.5, lon: 110 }, 15)).toEqual([]);
  });
});

describe('formatDistanceMeters', () => {
  it('rounds to a coarse readable value', () => {
    expect(formatDistanceMeters(3)).toBe('5 m');
    expect(formatDistanceMeters(47)).toBe('45 m');
    expect(formatDistanceMeters(120)).toBe('120 m');
    expect(formatDistanceMeters(1234)).toBe('1.2 km');
    expect(formatDistanceMeters(2000)).toBe('2 km');
  });

  it('handles unusable input', () => {
    expect(formatDistanceMeters(Number.NaN)).toBe('jarak tidak diketahui');
    expect(formatDistanceMeters(-5)).toBe('jarak tidak diketahui');
  });
});