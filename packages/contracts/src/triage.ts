import { z } from 'zod';
import {
  IsoDateTime,
  ReportCategory,
  SourceTier,
  StopCode,
  TriageVerdict,
  Uuid,
  UuidV7,
} from './common';

export const TriageInput = z
  .object({
    stopCode: StopCode,
    category: ReportCategory,
    text: z.string().trim().min(3).max(2000).optional(),
    clientEventId: UuidV7,
  })
  .strict();

export const TriageEvidence = z.object({
  id: z.string().min(3).max(80),
  claim: z.string().min(1).max(300),
  tier: SourceTier,
  sourceUrl: z.url().nullable(),
  retrievedAt: IsoDateTime,
  matchScore: z.number().min(0).max(1).nullable(),
  label: z.string().min(1).max(80),
});

export const TriageAction = z.object({
  kind: z.enum([
    'join',
    'monitor',
    'send_elsewhere',
    'measure',
    'send_anyway',
    'open_radar',
  ]),
  label: z.string().min(1).max(80),
});

export const TriageResult = z.object({
  sessionId: Uuid,
  verdict: TriageVerdict,
  headline: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
  actions: z.array(TriageAction).min(1).max(6),
  evidence: z.array(TriageEvidence).max(20),
  connectors: z.record(z.string(), z.enum(['ok', 'unavailable', 'not_configured'])),
  rulesVersion: z.string().min(1).max(40),
  latencyMs: z.number().int().nonnegative(),
  reasons: z.array(z.string().min(1).max(300)).max(10),
  requiresConfirmation: z.boolean(),
});

export const TriageSessionView = z.object({
  sessionId: Uuid,
  verdict: TriageVerdict,
  connectors: z.record(z.string(), z.enum(['ok', 'unavailable', 'not_configured'])),
  latencyMs: z.number().int().nonnegative().nullable(),
  createdAt: IsoDateTime,
});

export const TriageRules = z.object({
  rulesVersion: z.string().min(1).max(40),
  verdicts: z
    .array(
      z.object({
        verdict: TriageVerdict,
        headline: z.string().min(1).max(200),
        description: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(10),
  thresholds: z.object({
    minSample: z.number().int().nonnegative(),
    possibleMatch: z.number().min(0).max(1),
    duplicateRadiusM: z.number().int().nonnegative(),
    duplicateWindowDays: z.number().int().nonnegative(),
  }),
  alwaysAvailableAction: z.literal('send_anyway'),
});

export type TriageInput = z.infer<typeof TriageInput>;
export type TriageEvidence = z.infer<typeof TriageEvidence>;
export type TriageAction = z.infer<typeof TriageAction>;
export type TriageResult = z.infer<typeof TriageResult>;
export type TriageSessionView = z.infer<typeof TriageSessionView>;
export type TriageRules = z.infer<typeof TriageRules>;