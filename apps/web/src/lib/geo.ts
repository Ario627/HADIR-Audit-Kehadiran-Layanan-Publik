import type { AccuracyBucket, DistanceBucket, StopSummary } from '@hadir/contracts';

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface GeoFix extends Coordinates {
  accuracyM: number;
  atMs: number;
}

export interface PositionLike {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
  timestamp: number;
}

export interface NearbyStop {
  stop: StopSummary;
  distanceM: number;
  accuracyM: number;
}

export type OfferDecision = 'offer' | 'inaccurate' | 'out_of_range';

export const MAX_ACCURACY_M = 80;
export const MAX_NEARBY_M = 300;
export const DEFAULT_GEOFENCE_M = 150;
export const NEARBY_LIMIT = 50;

const EARTH_RADIUS_M = 6_371_008.8;
const METERS_PER_DEGREE_LAT = 111_320;
const MIN_COS_LAT = 0.01;
const MIN_ACCURACY_M = 0;
const MAX_ACCURACY_SANE_M = 100_000;
const BBOX_DECIMALS = 2;
const BBOX_SCALE = 10 ** BBOX_DECIMALS;

export const INDONESIA_BOUNDS = {
  minLon: 94.9,
  maxLon: 141.1,
  minLat: -11.1,
  maxLat: 6.1,
} as const;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function floorTo(value: number): number {
  return Math.floor(value * BBOX_SCALE) / BBOX_SCALE;
}

function ceilTo(value: number): number {
  return Math.ceil(value * BBOX_SCALE) / BBOX_SCALE;
}

export function haversineMeters(from: Coordinates, to: Coordinates): number {
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLon = toRadians(to.lon - from.lon);
  const latA = toRadians(from.lat);
  const latB = toRadians(to.lat);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const h = sinLat * sinLat + Math.cos(latA) * Math.cos(latB) * sinLon * sinLon;
  const clamped = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(clamped));
}

export function distanceBucketOf(meters: number | null | undefined): DistanceBucket | null {
  if (!isFiniteNumber(meters) || meters < 0) {
    return null;
  }
  if (meters <= 50) {
    return '0-50';
  }
  if (meters <= 100) {
    return '50-100';
  }
  if (meters <= 150) {
    return '100-150';
  }
  if (meters <= 300) {
    return '150-300';
  }
  return '>300';
}

export function accuracyBucketOf(meters: number | null | undefined): AccuracyBucket | null {
  if (!isFiniteNumber(meters) || meters < 0) {
    return null;
  }
  if (meters <= 20) {
    return '<=20';
  }
  if (meters <= 50) {
    return '21-50';
  }
  if (meters <= 80) {
    return '51-80';
  }
  if (meters <= 150) {
    return '81-150';
  }
  return '>150';
}

export function readFix(position: PositionLike | null | undefined): GeoFix | null {
  if (position === null || position === undefined) {
    return null;
  }
  const { latitude, longitude, accuracy } = position.coords;
  if (!isFiniteNumber(latitude) || latitude < -90 || latitude > 90) {
    return null;
  }
  if (!isFiniteNumber(longitude) || longitude < -180 || longitude > 180) {
    return null;
  }
  if (!isFiniteNumber(accuracy) || accuracy < MIN_ACCURACY_M || accuracy > MAX_ACCURACY_SANE_M) {
    return null;
  }
  if (!isFiniteNumber(position.timestamp) || position.timestamp <= 0) {
    return null;
  }
  if (latitude === 0 && longitude === 0) {
    return null;
  }
  return { lat: latitude, lon: longitude, accuracyM: accuracy, atMs: position.timestamp };
}

export function withinIndonesia(point: Coordinates): boolean {
  return (
    point.lon >= INDONESIA_BOUNDS.minLon &&
    point.lon <= INDONESIA_BOUNDS.maxLon &&
    point.lat >= INDONESIA_BOUNDS.minLat &&
    point.lat <= INDONESIA_BOUNDS.maxLat
  );
}

export function bboxAround(point: Coordinates, radiusM: number): string | null {
  if (!withinIndonesia(point) || !isFiniteNumber(radiusM) || radiusM <= 0) {
    return null;
  }
  const deltaLat = radiusM / METERS_PER_DEGREE_LAT;
  const cosLat = Math.max(MIN_COS_LAT, Math.cos(toRadians(point.lat)));
  const deltaLon = radiusM / (METERS_PER_DEGREE_LAT * cosLat);
  const minLon = Math.max(INDONESIA_BOUNDS.minLon, point.lon - deltaLon);
  const maxLon = Math.min(INDONESIA_BOUNDS.maxLon, point.lon + deltaLon);
  const minLat = Math.max(INDONESIA_BOUNDS.minLat, point.lat - deltaLat);
  const maxLat = Math.min(INDONESIA_BOUNDS.maxLat, point.lat + deltaLat);
  if (minLon >= maxLon || minLat >= maxLat) {
    return null;
  }
  const parts = [
    floorTo(minLon),
    floorTo(minLat),
    ceilTo(maxLon),
    ceilTo(maxLat),
  ].map((value) => value.toFixed(BBOX_DECIMALS));
  return parts.join(',');
}

export function offerDecision(input: {
  distanceM: number | null;
  accuracyM: number | null;
  geofenceRadiusM?: number;
}): OfferDecision {
  const { distanceM, accuracyM } = input;
  const geofence = input.geofenceRadiusM ?? DEFAULT_GEOFENCE_M;
  if (!isFiniteNumber(accuracyM) || accuracyM > MAX_ACCURACY_M) {
    return 'inaccurate';
  }
  if (!isFiniteNumber(distanceM) || distanceM > Math.min(geofence, MAX_NEARBY_M)) {
    return 'out_of_range';
  }
  return 'offer';
}

export function nearbyStops(
  stops: readonly StopSummary[],
  origin: Coordinates,
  accuracyM: number,
  maxM: number = MAX_NEARBY_M,
): NearbyStop[] {
  const found: NearbyStop[] = [];
  for (const stop of stops) {
    const distanceM = haversineMeters(origin, { lat: stop.location.lat, lon: stop.location.lon });
    if (distanceM > maxM) {
      continue;
    }
    found.push({ stop, distanceM, accuracyM });
  }
  found.sort((left, right) => {
    if (left.distanceM !== right.distanceM) {
      return left.distanceM - right.distanceM;
    }
    const byName = left.stop.name.localeCompare(right.stop.name, 'id');
    if (byName !== 0) {
      return byName;
    }
    return left.stop.code.localeCompare(right.stop.code, 'id');
  });
  return found;
}

export function formatDistanceMeters(meters: number): string {
  if (!isFiniteNumber(meters) || meters < 0) {
    return 'jarak tidak diketahui';
  }
  const step = meters < 50 ? 5 : meters < 1000 ? 10 : 100;
  const rounded = Math.max(step, Math.round(meters / step) * step);
  if (rounded < 1000) {
    return `${rounded} m`;
  }
  const km = rounded / 1000;
  return `${Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km`;
}

export function distanceBucketLabel(bucket: DistanceBucket): string {
  switch (bucket) {
    case '0-50':
      return '0-50 m';
    case '50-100':
      return '50-100 m';
    case '100-150':
      return '100-150 m';
    case '150-300':
      return '150-300 m';
    case '>300':
      return 'lebih dari 300 m';
  }
}

export function accuracyBucketLabel(bucket: AccuracyBucket): string {
  switch (bucket) {
    case '<=20':
      return 'sampai 20 m';
    case '21-50':
      return '21-50 m';
    case '51-80':
      return '51-80 m';
    case '81-150':
      return '81-150 m';
    case '>150':
      return 'lebih dari 150 m';
  }
}