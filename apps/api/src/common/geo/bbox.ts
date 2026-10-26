export interface BboxValue {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export function parseBbox(raw: string | undefined): BboxValue | null {
  if (raw === undefined) {
    return null;
  }
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (minLon >= maxLon || minLat >= maxLat) {
    return null;
  }
  return { minLon, minLat, maxLon, maxLat };
}