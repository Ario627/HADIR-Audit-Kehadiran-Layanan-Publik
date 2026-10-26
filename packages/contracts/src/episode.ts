import { z } from 'zod';
import {
  AccuracyBucket,
  DistanceBucket,
  EpisodeOutcome,
  IsoDateTime,
  Presence,
  StartMode,
  StopCode,
  Uuid,
  UuidV7,
} from './common';

const Epoch = z.string().regex(/^(20\d{4}|r\d{1,3})$/);
const KeyId = z.string().regex(/^[a-z0-9]{1,16}$/);
const Signature = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

export const QrProof = z
  .object({
    epoch: Epoch,
    keyId: KeyId,
    signature: Signature,
  })
  .strict();

export const StartEpisodeInput = z
  .object({
    stopCode: StopCode,
    routeId: Uuid.nullable().optional(),
    startMode: StartMode,
    clientStartedAt: IsoDateTime,
    clientEventId: UuidV7,
    qr: QrProof.optional(),
    distanceBucket: DistanceBucket.nullable().optional(),
    accuracyBucket: AccuracyBucket.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasQr = value.startMode === 'qr';
    if (hasQr && value.qr === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['qr'],
        message: 'Mode QR wajib menyertakan bukti QR.',
      });
    }
    if (!hasQr && value.qr !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['qr'],
        message: 'Bukti QR hanya boleh dikirim pada mode QR.',
      });
    }
    if (value.startMode === 'gps_nearby') {
      if (value.distanceBucket === undefined || value.distanceBucket === null) {
        context.addIssue({
          code: 'custom',
          path: ['distanceBucket'],
          message: 'Mode GPS wajib menyertakan bucket jarak.',
        });
      }
      if (value.accuracyBucket === undefined || value.accuracyBucket === null) {
        context.addIssue({
          code: 'custom',
          path: ['accuracyBucket'],
          message: 'Mode GPS wajib menyertakan bucket akurasi.',
        });
      }
    }
    if (
      value.startMode !== 'gps_nearby' &&
      value.startMode !== 'qr' &&
      (value.distanceBucket !== undefined || value.accuracyBucket !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['distanceBucket'],
        message: 'Bucket lokasi hanya boleh dikirim pada mode QR atau GPS.',
      });
    }
  });

export const EndEpisodeInput = z
  .object({
    outcome: z.enum(['boarded', 'abandoned', 'passed_full', 'cancelled']),
    clientEndedAt: IsoDateTime,
    clientEventId: UuidV7,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const HeartbeatInput = z
  .object({
    clientEventId: UuidV7,
    clientAt: IsoDateTime,
  })
  .strict();

export const Episode = z.object({
  id: Uuid,
  stopId: Uuid,
  stopCode: StopCode,
  stopName: z.string().min(1).max(160),
  routeId: Uuid.nullable(),
  startMode: StartMode,
  presence: Presence,
  trustWeight: z.number().min(0).max(1),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  status: z.enum(['active', 'ended']),
  durationS: z.number().int().nonnegative().nullable(),
  outcome: EpisodeOutcome.nullable(),
  qualityFlags: z.array(z.string().max(64)).max(20),
});

export type QrProof = z.infer<typeof QrProof>;
export type StartEpisodeInput = z.infer<typeof StartEpisodeInput>;
export type EndEpisodeInput = z.infer<typeof EndEpisodeInput>;
export type HeartbeatInput = z.infer<typeof HeartbeatInput>;
export type Episode = z.infer<typeof Episode>;