import { z } from 'zod';
import {
  Cursor,
  EvidenceLevel,
  IsoDateTime,
  ReportCategory,
  ReportStatus,
  StopCode,
  Uuid,
  UuidV7,
} from './common';
import { Bbox } from './stop';

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

export const ReportListItem = z.object({
  publicId: z.string().min(6).max(40),
  category: ReportCategory,
  status: ReportStatus,
  stopCode: StopCode,
  stopName: z.string().min(1).max(160),
  corroborationCount: z.number().int().nonnegative(),
  evidenceLevel: EvidenceLevel,
  createdAt: IsoDateTime,
});

export const ReportDetail = ReportListItem.extend({
  moderation: z.enum(['pending', 'approved', 'rejected', 'quarantined']),
  text: z.string().min(1).max(2000),
  authorityName: z.string().max(160).nullable(),
  evidenceScore: z.number().min(0).max(1),
  resolvedAt: IsoDateTime.nullable(),
  events: z.array(ReportEvent).max(200),
});

export const CreateReportResult = z.object({
  report: ReportDetail,
  warnings: z.array(z.string().min(1).max(80)).max(10),
});

export const ListReportsQuery = z
  .object({
    category: ReportCategory.optional(),
    status: ReportStatus.optional(),
    bbox: Bbox.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: Cursor.optional(),
  })
  .strict();

export const MyReportsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: Cursor.optional(),
  })
  .strict();

export const CorroborateResult = z.object({
  corroborationCount: z.number().int().nonnegative(),
  alreadyCounted: z.boolean(),
});

export const ClosureResult = z.object({
  status: ReportStatus,
  recorded: z.boolean(),
});

export const PartnerAction = z.enum([
  'acknowledge',
  'request_info',
  'schedule',
  'respond',
  'claim_resolved',
  'reject_with_reason',
]);

export const PartnerActionInput = z
  .object({
    action: PartnerAction,
    note: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'reject_with_reason' && value.reason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Alasan wajib diisi untuk menolak laporan.',
      });
    }
    if (value.action === 'claim_resolved' && (value.note ?? '').length < 10) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Klaim selesai wajib menyertakan keterangan bukti minimal 10 karakter.',
      });
    }
  });

export const PartnerActionResult = z.object({
  publicId: z.string().min(6).max(40),
  status: ReportStatus,
  previousStatus: ReportStatus,
  simulated: z.boolean(),
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
export type ReportListItem = z.infer<typeof ReportListItem>;
export type ReportDetail = z.infer<typeof ReportDetail>;
export type CreateReportResult = z.infer<typeof CreateReportResult>;
export type ListReportsQuery = z.infer<typeof ListReportsQuery>;
export type MyReportsQuery = z.infer<typeof MyReportsQuery>;
export type CorroborateResult = z.infer<typeof CorroborateResult>;
export type ClosureResult = z.infer<typeof ClosureResult>;
export type PartnerAction = z.infer<typeof PartnerAction>;
export type PartnerActionInput = z.infer<typeof PartnerActionInput>;
export type PartnerActionResult = z.infer<typeof PartnerActionResult>;
export type CorroborateInput = z.infer<typeof CorroborateInput>;
export type VerifyClosureInput = z.infer<typeof VerifyClosureInput>;