import { z } from 'zod';
import { IsoDateTime, Uuid } from './common';

export const AnchorDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, { message: 'Tanggal anchor tidak valid.' });

export const AnchorSignature = z.object({
  algorithm: z.literal('ed25519'),
  keyId: z.string().min(1).max(64),
  signature: z.string().min(1).max(128),
  publicKey: z.string().min(1).max(64),
  signedAt: IsoDateTime,
});

export type AnchorSignature = z.infer<typeof AnchorSignature>;

export const AnchorVerificationState = z.enum([
  'verified',
  'unsigned',
  'signature_missing',
  'signature_invalid',
  'key_mismatch',
  'structural_invalid',
  'window_inconsistent',
  'future_dated',
  'root_mismatch',
]);

export type AnchorVerificationState = z.infer<typeof AnchorVerificationState>;

export const TransparencyAnchor = z.object({
  date: AnchorDate,
  merkleRoot: z.string().min(1).max(128),
  eventCount: z.number().int().nonnegative(),
  txRef: z.string().max(200).nullable(),
  verifyUrl: z.string().min(1).max(500),
  publishedAt: IsoDateTime,
  windowStart: IsoDateTime,
  windowEnd: IsoDateTime,
  signature: AnchorSignature.nullable(),
  payloadDigest: z.string().min(1).max(128),
  caveat: z.string().min(1).max(500),
});

export type TransparencyAnchor = z.infer<typeof TransparencyAnchor>;

export const AnchorPublicKey = z.object({
  algorithm: z.literal('ed25519'),
  keyId: z.string().min(1).max(64),
  publicKey: z.string().min(1).max(64),
  firstAnchoredAt: IsoDateTime.nullable(),
  lastAnchoredAt: IsoDateTime.nullable(),
  anchorCount: z.number().int().nonnegative(),
});

export type AnchorPublicKey = z.infer<typeof AnchorPublicKey>;

export const AnchorTimelineEntry = z.object({
  date: AnchorDate,
  status: AnchorVerificationState.or(z.literal('missing')),
  eventCount: z.number().int().nonnegative().nullable(),
  signed: z.boolean(),
});

export type AnchorTimelineEntry = z.infer<typeof AnchorTimelineEntry>;

export const AnchorTimelineQuery = z
  .object({
    from: AnchorDate.optional(),
    to: AnchorDate.optional(),
    days: z.coerce.number().int().min(1).max(366).default(30),
  })
  .strict();

export type AnchorTimelineQuery = z.infer<typeof AnchorTimelineQuery>;

export const AnchorTimeline = z.object({
  from: AnchorDate,
  to: AnchorDate,
  entries: z.array(AnchorTimelineEntry).max(366),
  gaps: z.array(
    z.object({
      date: AnchorDate,
      reason: z.enum(['missing', 'unsigned', 'unverified']),
    }),
  ),
  complete: z.boolean(),
});

export type AnchorTimeline = z.infer<typeof AnchorTimeline>;

export const AnchorInclusionProof = z.object({
  date: AnchorDate,
  reportPublicId: z.string().min(6).max(40),
  seq: z.number().int().positive(),
  leaf: z.string().min(1).max(128),
  index: z.number().int().nonnegative(),
  proof: z.array(z.string().min(1).max(128)).max(64),
  root: z.string().min(1).max(128),
  verified: z.boolean(),
});

export type AnchorInclusionProof = z.infer<typeof AnchorInclusionProof>;

export const AnchorProofSubject = z.object({
  reportPublicId: z.string().min(6).max(40),
  eventId: Uuid.nullable(),
});

export type AnchorProofSubject = z.infer<typeof AnchorProofSubject>;
