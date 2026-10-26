import { z } from 'zod';
import {
  IsoDateTime,
  ReportCategory,
  ReportStatus,
  StopCode,
  Uuid,
  UuidV7,
} from './common';

export const CreateReportInput = z
  .object({
    triageSessionId: Uuid.nullable().optional(),
    category: ReportCategory,
    stopCode: StopCode,
    text: z.string().trim().min(20).max(2000),
    photoUploadId: Uuid.nullable().optional(),
    contactEmail: z.email().max(254).nullable().optional(),
    clientEventId: UuidV7,
  })
  .strict();

export const Report = z.object({
  id: Uuid,
  publicId: z.string().min(6).max(40),
  category: ReportCategory,
  status: ReportStatus,
  moderation: z.enum(['pending', 'approved', 'rejected', 'quarantined']),
  stopCode: StopCode,
  stopName: z.string().min(1).max(160),
  authorityName: z.string().max(160).nullable(),
  evidenceScore: z.number().min(0).max(1),
  corroborationCount: z.number().int().nonnegative(),
  createdAt: IsoDateTime,
});

export const ReportEvent = z.object({
  kind: z.string().min(1).max(40),
  actorType: z.enum(['citizen', 'partner', 'system', 'moderator']),
  note: z.string().max(500).nullable(),
  createdAt: IsoDateTime,
});

export const CorroborateInput = z
  .object({
    note: z.string().trim().max(280).optional(),
  })
  .strict();

export const VerifyClosureInput = z
  .object({
    answer: z.enum(['yes', 'no', 'partial']),
    note: z.string().trim().max(280).optional(),
    photoUploadId: Uuid.nullable().optional(),
    clientEventId: UuidV7,
  })
  .strict();

export type CreateReportInput = z.infer<typeof CreateReportInput>;
export type Report = z.infer<typeof Report>;
export type ReportEvent = z.infer<typeof ReportEvent>;
export type CorroborateInput = z.infer<typeof CorroborateInput>;
export type VerifyClosureInput = z.infer<typeof VerifyClosureInput>;