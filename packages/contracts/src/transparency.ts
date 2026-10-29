import { z } from 'zod';
import { IsoDateTime } from './common';

export const AnchorDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, { message: 'Tanggal anchor tidak valid.' });

export const TransparencyAnchor = z.object({
  date: AnchorDate,
  merkleRoot: z.string().min(1).max(128),
  eventCount: z.number().int().nonnegative(),
  txRef: z.string().max(200).nullable(),
  verifyUrl: z.string().min(1).max(500),
  publishedAt: IsoDateTime,
});

export type TransparencyAnchor = z.infer<typeof TransparencyAnchor>;
