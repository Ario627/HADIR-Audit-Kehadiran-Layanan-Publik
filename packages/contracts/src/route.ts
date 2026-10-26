import { z } from 'zod';
import { Cursor, IsoDateTime, Uuid } from './common';

export const RouteMode = z.enum(['brt', 'non_brt', 'feeder', 'other']);
export const RouteStatus = z.enum(['active', 'suspended', 'stopped', 'planned']);

export const ListRoutesQuery = z
  .object({
    city: z.string().trim().toUpperCase().regex(/^[A-Z]{2,8}$/).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: Cursor.optional(),
  })
  .strict();

export const RouteDetail = z.object({
  id: Uuid,
  code: z.string().min(1).max(12),
  name: z.string().min(1).max(120),
  mode: RouteMode,
  status: RouteStatus,
  promisedHeadwayPeakMin: z.number().int().positive().nullable(),
  promisedHeadwayOffMin: z.number().int().positive().nullable(),
  headwaySourceUrl: z.url().nullable(),
  headwayValidFrom: z.string().max(10).nullable(),
  headwayValidTo: z.string().max(10).nullable(),
  stopCount: z.number().int().nonnegative(),
});

export const RouteStop = z.object({
  stopId: Uuid,
  stopCode: z.string().min(1).max(12),
  stopName: z.string().min(1).max(160),
  direction: z.number().int().min(0).max(1),
  seq: z.number().int().nonnegative(),
  status: z.enum(['active', 'inactive', 'moved', 'planned']),
});

export const RouteStopList = z.object({
  route: RouteDetail,
  stops: z.array(RouteStop).max(500),
});

export const RouteCreatedAt = IsoDateTime;

export type ListRoutesQuery = z.infer<typeof ListRoutesQuery>;
export type RouteDetail = z.infer<typeof RouteDetail>;
export type RouteStop = z.infer<typeof RouteStop>;
export type RouteStopList = z.infer<typeof RouteStopList>;