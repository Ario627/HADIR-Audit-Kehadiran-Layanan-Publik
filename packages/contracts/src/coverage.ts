import { z } from 'zod';
import { EvidenceLevel, Uuid } from './common';
import { Bbox } from './stop';

export const CoveragePeriod = z.enum(['7d', '30d']);

export const CoverageQuery = z
  .object({
    period: CoveragePeriod.default('7d'),
    routeId: Uuid.optional(),
    bbox: Bbox.optional(),
  })
  .strict();

export const CoverageSummaryQuery = z
  .object({
    period: CoveragePeriod.default('7d'),
    bbox: Bbox.optional(),
  })
  .strict();

export const CoverageCell = z.object({
  stopId: Uuid,
  stopCode: z.string().min(1).max(12),
  stopName: z.string().min(1).max(160),
  hour: z.number().int().min(0).max(23),
  n: z.number().int().nonnegative(),
  devices: z.number().int().nonnegative(),
  days: z.number().int().nonnegative(),
  level: EvidenceLevel,
});

export const CoverageSummaryItem = z.object({
  stopId: Uuid,
  stopCode: z.string().min(1).max(12),
  stopName: z.string().min(1).max(160),
  n: z.number().int().nonnegative(),
  devices: z.number().int().nonnegative(),
  days: z.number().int().nonnegative(),
  clusters: z.number().int().nonnegative(),
  hoursCovered: z.number().int().min(0).max(24),
  level: EvidenceLevel,
});

export const Coverage = z.object({
  period: CoveragePeriod,
  cells: z.array(CoverageCell).max(5_000),
});

export const CoverageSummary = z.object({
  period: CoveragePeriod,
  stops: z.array(CoverageSummaryItem).max(2_000),
});

export type CoveragePeriod = z.infer<typeof CoveragePeriod>;
export type CoverageQuery = z.infer<typeof CoverageQuery>;
export type CoverageSummaryQuery = z.infer<typeof CoverageSummaryQuery>;
export type CoverageCell = z.infer<typeof CoverageCell>;
export type CoverageSummaryItem = z.infer<typeof CoverageSummaryItem>;
export type Coverage = z.infer<typeof Coverage>;
export type CoverageSummary = z.infer<typeof CoverageSummary>;