import { z } from 'zod';
import { Estimate } from './estimate';
import { IsoDateTime, ReportCategory, StopCode, Uuid } from './common';

export const InternalEstimateRequest = z
  .object({
    stopCode: StopCode,
    window: z.enum(['7d', '30d']).default('7d'),
    routeId: Uuid.optional(),
  })
  .strict();

export type InternalEstimateRequest = z.infer<typeof InternalEstimateRequest>;

export const InternalEstimateResult = z.object({
  estimate: Estimate,
  methodVersion: z.string().min(1).max(40),
});

export type InternalEstimateResult = z.infer<typeof InternalEstimateResult>;

export const InternalHealth = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string().min(1).max(40),
  uptimeS: z.number().int().nonnegative(),
});

export type InternalHealth = z.infer<typeof InternalHealth>;

export const OutboxMetric = z.object({
  topic: z.string().min(1).max(80),
  pending: z.number().int().nonnegative(),
  oldestPendingSeconds: z.number().nonnegative().nullable(),
});

export type OutboxMetric = z.infer<typeof OutboxMetric>;

export const ReportMetric = z.object({
  category: ReportCategory,
  count: z.number().int().nonnegative(),
  generatedAt: IsoDateTime,
});

export type ReportMetric = z.infer<typeof ReportMetric>;
