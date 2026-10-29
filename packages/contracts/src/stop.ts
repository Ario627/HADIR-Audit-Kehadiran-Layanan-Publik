import { z } from 'zod';
import {
  Cursor,
  IsoDateTime,
  StopCode,
  Uuid,
} from './common';

const INDONESIA_MIN_LON = 94.9;
const INDONESIA_MAX_LON = 141.1;
const INDONESIA_MIN_LAT = -11.1;
const INDONESIA_MAX_LAT = 6.1;

function isBbox(value: string): boolean {
  const parts = value.split(',');
  if (parts.length !== 4) {
    return false;
  }
  const numbers = parts.map(Number);
  if (numbers.some((part) => !Number.isFinite(part))) {
    return false;
  }
  const [minLon, minLat, maxLon, maxLat] = numbers as [number, number, number, number];
  if (minLon >= maxLon || minLat >= maxLat) {
    return false;
  }
  if (
    minLon < INDONESIA_MIN_LON ||
    maxLon > INDONESIA_MAX_LON ||
    minLat < INDONESIA_MIN_LAT ||
    maxLat > INDONESIA_MAX_LAT
  ) {
    return false;
  }
  return true;
}

export const Bbox = z
  .string()
  .min(7)
  .max(80)
  .regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/)
  .refine(isBbox, { message: 'bbox di luar batas Indonesia atau tidak valid.' });

export const RouteSummary = z.object({
  id: Uuid,
  code: z.string().min(1).max(12),
  name: z.string().min(1).max(120),
  promisedHeadwayPeakMin: z.number().int().positive().nullable(),
  headwaySourceUrl: z.url().nullable(),
});

export const StopSummary = z.object({
  id: Uuid,
  code: StopCode,
  name: z.string().min(1).max(160),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  status: z.enum(['active', 'inactive', 'moved', 'planned']),
  isDemo: z.boolean(),
  routes: z.array(RouteSummary),
});

export const ListStopsQuery = z
  .object({
    q: z.string().trim().min(2).max(100).optional(),
    city: z.string().trim().toUpperCase().regex(/^[A-Z]{2,8}$/).optional(),
    bbox: Bbox.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: Cursor.optional(),
  })
  .strict();

export const StopDetail = StopSummary.extend({
  description: z.string().max(500).nullable(),
  geofenceRadiusM: z.number().int().min(50).max(500),
  createdAt: IsoDateTime,
});

export const QrQuery = z
  .object({
    e: z.string().regex(/^(20\d{4}|r\d{1,3})$/),
    k: z.string().regex(/^[a-z0-9]{1,16}$/),
    s: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  })
  .strict();

export const QrLanding = z.object({
  stop: StopDetail,
  qr: z.object({
    valid: z.boolean(),
    epoch: z.string().max(16).nullable(),
    keyId: z.string().max(16).nullable(),
  }),
  privacy: z.object({ locationUsed: z.literal(false) }),
});

export type Bbox = z.infer<typeof Bbox>;
export type RouteSummary = z.infer<typeof RouteSummary>;
export type StopSummary = z.infer<typeof StopSummary>;
export type ListStopsQuery = z.infer<typeof ListStopsQuery>;
export type StopDetail = z.infer<typeof StopDetail>;
export type QrQuery = z.infer<typeof QrQuery>;
export type QrLanding = z.infer<typeof QrLanding>;