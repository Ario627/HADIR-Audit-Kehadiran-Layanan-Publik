import { z } from 'zod';
import { Direction, EvidenceLevel, IsoDateTime } from './common';

export const EvidenceCriteria = z.object({
  minN: z.number().int().positive(),
  minClusters: z.number().int().positive(),
  strongN: z.number().int().positive(),
  strongDays: z.number().int().positive(),
  strongDevices: z.number().int().positive(),
  strongClusters: z.number().int().positive(),
  designEffectLimit: z.number().positive(),
  ciLevel: z.number().min(0).max(1),
  tauMinutes: z.number().int().positive(),
  thresholdMultiplier: z.number().positive(),
});

export const EvidenceLevelInfo = z.object({
  level: EvidenceLevel,
  label: z.string().min(1).max(80),
  requirement: z.string().min(1).max(240),
});

export const DirectionInfo = z.object({
  direction: Direction,
  label: z.string().min(1).max(120),
  condition: z.string().min(1).max(160),
});

export const WarningInfo = z.object({
  code: z.string().min(1).max(80),
  meaning: z.string().min(1).max(240),
});

export const ServiceMeta = z.object({
  name: z.string().min(1).max(80),
  version: z.string().min(1).max(40),
  methodVersion: z.string().min(1).max(40),
  tauMinutes: z.number().int().positive(),
  windows: z.array(z.enum(['7d', '30d'])).min(1),
  ci: z.object({
    level: z.number().min(0).max(1),
    method: z.string().min(1).max(80),
    iterations: z.number().int().positive(),
  }),
  criteria: EvidenceCriteria,
  levels: z.array(EvidenceLevelInfo).min(1).max(8),
  directions: z.array(DirectionInfo).min(1).max(8),
  warnings: z.array(WarningInfo).max(40),
  privacy: z.object({
    coordinatesStored: z.literal(false),
    devicePseudonym: z.string().min(1).max(240),
    locationData: z.string().min(1).max(240),
  }),
  generatedAt: IsoDateTime,
});

export const MethodologyStep = z.object({
  order: z.number().int().positive(),
  title: z.string().min(1).max(120),
  detail: z.string().min(1).max(600),
});

export const Methodology = z.object({
  methodVersion: z.string().min(1).max(40),
  updatedAt: IsoDateTime,
  primaryEstimand: z.string().min(1).max(240),
  secondaryEstimand: z.string().min(1).max(240),
  steps: z.array(MethodologyStep).min(1).max(20),
  clusterUnit: z.string().min(1).max(120),
  clusterRationale: z.string().min(1).max(600),
  thresholds: z.object({
    excessMultiplier: z.number().positive(),
    idealWaitFormula: z.string().min(1).max(120),
  }),
  limitations: z.array(z.string().min(1).max(400)).min(1).max(20),
  generatedAt: IsoDateTime,
});

export type EvidenceCriteria = z.infer<typeof EvidenceCriteria>;
export type ServiceMeta = z.infer<typeof ServiceMeta>;
export type Methodology = z.infer<typeof Methodology>;