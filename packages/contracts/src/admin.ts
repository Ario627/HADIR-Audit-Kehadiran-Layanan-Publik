import { z } from 'zod';
import { Cursor, IsoDateTime, Uuid } from './common';

export const PlatformAdminRole = z.enum(['moderator', 'superadmin']);

export const AdminLoginInput = z
  .object({
    email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
    password: z.string().min(12).max(256),
    totp: z.string().regex(/^[0-9]{6}$/),
  })
  .strict();

export const AdminProfile = z.object({
  adminId: Uuid,
  email: z.string().min(1).max(254),
  displayName: z.string().min(1).max(120),
  role: PlatformAdminRole,
  expiresAt: IsoDateTime,
});

export type AdminProfile = z.infer<typeof AdminProfile>;

export const NoticeKind = z.enum(['detour', 'repair', 'suspension', 'schedule', 'other']);

export const AdminNoticeInput = z
  .object({
    kind: NoticeKind,
    text: z.string().trim().min(10).max(1000),
    sourceUrl: z.url().max(500),
    cityId: Uuid.nullable().optional(),
    stopId: Uuid.nullable().optional(),
    routeId: Uuid.nullable().optional(),
    institutionId: Uuid.nullable().optional(),
    startsAt: IsoDateTime.nullable().optional(),
    endsAt: IsoDateTime.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.cityId != null || value.stopId != null || value.routeId != null,
    { message: 'Notice harus menempel pada kota, halte, atau rute.', path: ['stopId'] },
  )
  .refine(
    (value) =>
      value.startsAt == null || value.endsAt == null || value.startsAt <= value.endsAt,
    { message: 'startsAt harus sebelum endsAt.', path: ['endsAt'] },
  );

export type AdminNoticeInput = z.infer<typeof AdminNoticeInput>;

export const Notice = z.object({
  id: Uuid,
  kind: NoticeKind,
  text: z.string().min(1).max(1000),
  sourceUrl: z.string().min(1).max(500),
  cityId: Uuid.nullable(),
  stopId: Uuid.nullable(),
  routeId: Uuid.nullable(),
  institutionId: Uuid.nullable(),
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});

export type Notice = z.infer<typeof Notice>;

export const AdminNoticeQuery = z
  .object({
    stopId: Uuid.optional(),
    routeId: Uuid.optional(),
    cityId: Uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: Cursor.optional(),
  })
  .strict();

export type AdminNoticeQuery = z.infer<typeof AdminNoticeQuery>;

export const ModerationDecision = z.enum(['approved', 'rejected', 'quarantined']);

export const AdminModerationInput = z
  .object({
    moderation: ModerationDecision,
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.moderation !== 'approved' && (value.reason ?? '').length < 10) {
      context.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Alasan wajib diisi minimal 10 karakter untuk menolak atau karantina.',
      });
    }
  });

export type AdminModerationInput = z.infer<typeof AdminModerationInput>;

export const AdminModerationResult = z.object({
  publicId: z.string().min(6).max(40),
  moderation: z.enum(['pending', 'approved', 'rejected', 'quarantined']),
  previousModeration: z.enum(['pending', 'approved', 'rejected', 'quarantined']),
  mediaUpdated: z.number().int().nonnegative(),
});

export type AdminModerationResult = z.infer<typeof AdminModerationResult>;

export const AdminAuditQuery = z
  .object({
    action: z.string().min(1).max(80).optional(),
    objectType: z.string().min(1).max(40).optional(),
    objectId: z.string().min(1).max(80).optional(),
    since: IsoDateTime.optional(),
    until: IsoDateTime.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: Cursor.optional(),
  })
  .strict();

export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

export const AdminAuditEntry = z.object({
  id: Uuid,
  action: z.string().min(1).max(80),
  objectType: z.string().min(1).max(40),
  objectId: z.string().max(80).nullable(),
  actorType: z.enum(['citizen', 'partner', 'system', 'moderator', 'superadmin']),
  actorId: z.string().max(80).nullable(),
  requestId: z.string().max(80).nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: IsoDateTime,
});

export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

export const AdminFlagInput = z
  .object({
    value: z.unknown(),
    description: z.string().trim().max(240).optional(),
  })
  .strict();

export type AdminFlagInput = z.infer<typeof AdminFlagInput>;

export const FeatureFlag = z.object({
  key: z.string().min(1).max(64),
  value: z.unknown(),
  description: z.string().max(240).nullable(),
  updatedAt: IsoDateTime,
});

export type FeatureFlag = z.infer<typeof FeatureFlag>;

export const AdminChainVerifyInput = z
  .object({
    since: IsoDateTime.optional(),
    until: IsoDateTime.optional(),
    maxReports: z.coerce.number().int().min(1).max(5000).default(500),
  })
  .strict();

export type AdminChainVerifyInput = z.infer<typeof AdminChainVerifyInput>;

export const ChainBreak = z.object({
  reportPublicId: z.string().min(6).max(40),
  seq: z.number().int().positive(),
  kind: z.string().min(1).max(40),
  reason: z.enum(['prev_mismatch', 'payload_mismatch', 'chain_mismatch', 'gap']),
});

export type ChainBreak = z.infer<typeof ChainBreak>;

export const AdminChainVerifyResult = z.object({
  checkedReports: z.number().int().nonnegative(),
  checkedEvents: z.number().int().nonnegative(),
  breaks: z.array(ChainBreak).max(500),
  ok: z.boolean(),
});

export type AdminChainVerifyResult = z.infer<typeof AdminChainVerifyResult>;

export const AdminAnchorInput = z
  .object({
    force: z.boolean().default(false),
  })
  .strict();

export type AdminAnchorInput = z.infer<typeof AdminAnchorInput>;

export const AdminRupImportInput = z
  .object({
    csv: z.string().min(1).max(4 * 1024 * 1024),
    sourceUrl: z.url().max(500),
    fiscalYear: z.number().int().min(2000).max(2100),
    dryRun: z.boolean().default(false),
  })
  .strict();

export type AdminRupImportInput = z.infer<typeof AdminRupImportInput>;

export const RupImportIssue = z.object({
  row: z.number().int().positive(),
  message: z.string().min(1).max(240),
});

export const AdminRupImportResult = z.object({
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  issues: z.array(RupImportIssue).max(100),
  dryRun: z.boolean(),
});

export type AdminRupImportResult = z.infer<typeof AdminRupImportResult>;

export const AdminRupQuery = z
  .object({
    satker: z.string().min(1).max(160).optional(),
    fiscalYear: z.coerce.number().int().min(2000).max(2100).optional(),
    keyword: z.string().min(2).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: Cursor.optional(),
  })
  .strict();

export type AdminRupQuery = z.infer<typeof AdminRupQuery>;
