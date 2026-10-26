import { z } from 'zod';
import {
  Direction,
  EvidenceLevel,
  IsoDateTime,
  Uuid,
} from './common';

export const EstimateMetrics = z.object({
  n: z.number().int().nonnegative(),
  nEffective: z.number().nonnegative().nullable(),
  medianMin: z.number().nonnegative().nullable(),
  meanMin: z.number().nonnegative().nullable(),
  rmstMin: z.number().nonnegative().nullable(),
  p95Min: z.number().nonnegative().nullable(),
  ewtMin: z.number().nullable(),
  abandonRate: z.number().min(0).max(1).nullable(),
  fullRate: z.number().min(0).max(1).nullable(),
  cifAbandon: z.number().min(0).max(1).nullable(),
  timeToBoardRmstMin: z.number().nonnegative().nullable(),
  ci: z
    .object({
      low: z.number(),
      high: z.number(),
      level: z.number().min(0).max(1),
      method: z.string().min(1).max(80),
    })
    .nullable(),
});

export const EstimateQuery = z
  .object({
    window: z.enum(['7d', '30d']).default('7d'),
    routeId: Uuid.optional(),
  })
  .strict();

export const Estimate = z.object({
  stopId: Uuid,
  stopCode: z.string(),
  routeId: Uuid.nullable(),
  window: z.object({
    start: IsoDateTime,
    end: IsoDateTime,
    label: z.enum(['7d', '30d']),
  }),
  metrics: EstimateMetrics,
  promise: z
    .object({
      headwayMin: z.number().positive(),
      source: z.string(),
      sourceUrl: z.url().nullable(),
    })
    .nullable(),
  evidence: EvidenceLevel,
  direction: Direction,
  message: z.string(),
  warnings: z.array(z.string().max(80)).max(20),
  simulated: z.boolean(),
  sample: z.object({
    days: z.number().int().nonnegative(),
    devices: z.number().int().nonnegative(),
    clusters: z.number().int().nonnegative(),
    designEffect: z.number().nonnegative(),
    thresholdMin: z.number().nonnegative().nullable(),
  }),
  computedAt: IsoDateTime,
  methodVersion: z.string(),
});

export type EstimateMetrics = z.infer<typeof EstimateMetrics>;
export type EstimateQuery = z.infer<typeof EstimateQuery>;
export type Estimate = z.infer<typeof Estimate>;