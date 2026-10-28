import { z } from 'zod';
import { IsoDateTime, ReportCategory, ReportStatus, Uuid } from './common';

export const PartnerExportFormat = z.enum(['csv', 'open311']);

export const PartnerExportInput = z
  .object({
    format: PartnerExportFormat,
    from: IsoDateTime.optional(),
    to: IsoDateTime.optional(),
    category: ReportCategory.optional(),
    status: ReportStatus.exclude(['draft']).optional(),
  })
  .strict()
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: 'Rentang tanggal terbalik.', path: ['from'] },
  );

export type PartnerExportInput = z.infer<typeof PartnerExportInput>;

export const PartnerExportStatus = z.enum(['queued', 'running', 'ready', 'failed', 'expired']);

export const PartnerExportTicket = z.object({
  exportId: Uuid,
  status: PartnerExportStatus,
  format: PartnerExportFormat,
  createdAt: IsoDateTime,
});

export type PartnerExportTicket = z.infer<typeof PartnerExportTicket>;

export const PartnerExportDetail = z.object({
  exportId: Uuid,
  status: PartnerExportStatus,
  format: PartnerExportFormat,
  rowCount: z.number().int().nonnegative().nullable(),
  byteSize: z.number().int().nonnegative().nullable(),
  downloadUrl: z.string().min(1).max(500).nullable(),
  expiresAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});

export type PartnerExportDetail = z.infer<typeof PartnerExportDetail>;

export const PartnerExportListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export type PartnerExportListQuery = z.infer<typeof PartnerExportListQuery>;

export const PartnerAnalyticsQuery = z
  .object({
    from: IsoDateTime.optional(),
    to: IsoDateTime.optional(),
  })
  .strict()
  .refine(
    (value) => value.from === undefined || value.to === undefined || value.from <= value.to,
    { message: 'Rentang tanggal terbalik.', path: ['from'] },
  );

export type PartnerAnalyticsQuery = z.infer<typeof PartnerAnalyticsQuery>;

export const AnalyticsBucket = z.object({
  key: z.string().min(1).max(40),
  count: z.number().int().nonnegative().nullable(),
  suppressed: z.boolean(),
});

export type AnalyticsBucket = z.infer<typeof AnalyticsBucket>;

export const PartnerAnalytics = z.object({
  window: z.object({
    start: IsoDateTime,
    end: IsoDateTime,
    days: z.number().int().positive(),
  }),
  totalReports: z.number().int().nonnegative().nullable(),
  totalSuppressed: z.boolean(),
  byStatus: z.array(AnalyticsBucket).max(20),
  byCategory: z.array(AnalyticsBucket).max(20),
  medianFirstResponseHours: z.number().nonnegative().nullable(),
  medianResolutionHours: z.number().nonnegative().nullable(),
  claimedResolvedRate: z.number().min(0).max(1).nullable(),
  disputedRate: z.number().min(0).max(1).nullable(),
  corroborationRate: z.number().min(0).max(1).nullable(),
  kThreshold: z.number().int().positive(),
  generatedAt: IsoDateTime,
});

export type PartnerAnalytics = z.infer<typeof PartnerAnalytics>;
