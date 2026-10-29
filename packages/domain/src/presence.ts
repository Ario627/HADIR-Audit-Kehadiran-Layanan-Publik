export type StartMode = 'qr' | 'gps_nearby' | 'manual' | 'resume' | 'import';
export type Presence =
  | 'unverified'
  | 'qr_only'
  | 'qr_geo'
  | 'gps_verified'
  | 'field_verified';
export type DistanceBucket = '0-50' | '50-100' | '100-150' | '150-300' | '>300';
export type AccuracyBucket = '<=20' | '21-50' | '51-80' | '81-150' | '>150';

export interface PresenceInput {
  startMode: StartMode;
  qrValid: boolean;
  distanceBucket?: DistanceBucket | null;
  accuracyBucket?: AccuracyBucket | null;
}

const NEAR_DISTANCE = new Set<DistanceBucket>(['0-50', '50-100', '100-150']);
const GOOD_ACCURACY = new Set<AccuracyBucket>(['<=20', '21-50', '51-80']);
const TIGHT_ACCURACY = new Set<AccuracyBucket>(['<=20', '21-50']);

const EARTH_RADIUS_M = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function presenceFor(input: PresenceInput): {
  presence: Presence;
  trustWeight: number;
} {
  if (input.startMode === 'qr' && input.qrValid) {
    const near =
      input.distanceBucket !== null &&
      input.distanceBucket !== undefined &&
      NEAR_DISTANCE.has(input.distanceBucket);
    const accurate =
      input.accuracyBucket !== null &&
      input.accuracyBucket !== undefined &&
      GOOD_ACCURACY.has(input.accuracyBucket);
    if (near && accurate) {
      return { presence: 'qr_geo', trustWeight: 0.9 };
    }
    return { presence: 'qr_only', trustWeight: 0.7 };
  }
  if (input.startMode === 'gps_nearby') {
    const near =
      input.distanceBucket !== null &&
      input.distanceBucket !== undefined &&
      NEAR_DISTANCE.has(input.distanceBucket);
    const tight =
      input.accuracyBucket !== null &&
      input.accuracyBucket !== undefined &&
      TIGHT_ACCURACY.has(input.accuracyBucket);
    if (near && tight) {
      return { presence: 'gps_verified', trustWeight: 0.85 };
    }
    if (near) {
      return { presence: 'unverified', trustWeight: 0.6 };
    }
    if (input.distanceBucket === '150-300') {
      return { presence: 'unverified', trustWeight: 0.45 };
    }
    return { presence: 'unverified', trustWeight: 0.3 };
  }
  if (input.startMode === 'manual') {
    return { presence: 'unverified', trustWeight: 0.55 };
  }
  return { presence: 'unverified', trustWeight: 0.5 };
}

export function bucketDistance(meters: number | null | undefined): DistanceBucket | null {
  if (meters === null || meters === undefined || !Number.isFinite(meters) || meters < 0) {
    return null;
  }
  if (meters <= 50) return '0-50';
  if (meters <= 100) return '50-100';
  if (meters <= 150) return '100-150';
  if (meters <= 300) return '150-300';
  return '>300';
}

export function bucketAccuracy(meters: number | null | undefined): AccuracyBucket | null {
  if (meters === null || meters === undefined || !Number.isFinite(meters) || meters < 0) {
    return null;
  }
  if (meters <= 20) return '<=20';
  if (meters <= 50) return '21-50';
  if (meters <= 80) return '51-80';
  if (meters <= 150) return '81-150';
  return '>150';
}

export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const sinLat = Math.sin(deltaLat / 2) ** 2;
  const sinLon =
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(sinLat + sinLon));
}