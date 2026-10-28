import { z } from 'zod';
import { Cursor, ReportCategory, ReportStatus } from './common';

export const PartnerEmail = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());

export const PartnerPassword = z.string().min(12).max(256);

export const PartnerOtpCode = z.string().regex(/^[0-9]{6}$/);

export const PartnerInviteToken = z.string().min(20).max(4096);

export const PartnerSessionInput = z.discriminatedUnion('method', [
  z
    .object({
      method: z.literal('invite'),
      inviteToken: PartnerInviteToken,
    })
    .strict(),
  z
    .object({
      method: z.literal('password'),
      email: PartnerEmail,
      password: PartnerPassword,
    })
    .strict(),
  z
    .object({
      method: z.literal('otp'),
      email: PartnerEmail,
      code: PartnerOtpCode,
    })
    .strict(),
]);

export type PartnerSessionInput = z.infer<typeof PartnerSessionInput>;

export const PartnerOtpRequest = z
  .object({
    email: PartnerEmail,
  })
  .strict();

export type PartnerOtpRequest = z.infer<typeof PartnerOtpRequest>;

export const PartnerPasswordSet = z
  .object({
    email: PartnerEmail,
    inviteToken: PartnerInviteToken,
    password: PartnerPassword,
  })
  .strict();

export type PartnerPasswordSet = z.infer<typeof PartnerPasswordSet>;

export const PartnerProfile = z.object({
  userId: z.uuid(),
  displayName: z.string().min(1).max(120),
  institutionId: z.uuid(),
  institutionName: z.string().min(1).max(160),
  role: z.enum(['viewer', 'responder', 'admin']),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export type PartnerProfile = z.infer<typeof PartnerProfile>;

export const PasskeyOptionsResult = z.object({
  challengeId: z.string().min(1).max(64),
  options: z.record(z.string(), z.unknown()),
});

export type PasskeyOptionsResult = z.infer<typeof PasskeyOptionsResult>;

export const PasskeyRegistrationFinish = z
  .object({
    challengeId: z.uuid(),
    response: z.record(z.string(), z.unknown()),
  })
  .strict();

export type PasskeyRegistrationFinish = z.infer<typeof PasskeyRegistrationFinish>;

export const PasskeyAuthenticationFinish = z
  .object({
    challengeId: z.uuid(),
    response: z.record(z.string(), z.unknown()),
  })
  .strict();

export type PasskeyAuthenticationFinish = z.infer<typeof PasskeyAuthenticationFinish>;

export const PartnerInboxQuery = z
  .object({
    category: ReportCategory.optional(),
    status: ReportStatus.exclude(['draft']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: Cursor.optional(),
  })
  .strict();

export type PartnerInboxQuery = z.infer<typeof PartnerInboxQuery>;

export const PartnerPasswordChange = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(12).max(256),
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'Kata sandi baru harus berbeda dari yang lama.',
    path: ['newPassword'],
  });

export type PartnerPasswordChange = z.infer<typeof PartnerPasswordChange>;
