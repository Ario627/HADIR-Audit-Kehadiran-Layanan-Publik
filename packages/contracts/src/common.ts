import { z } from 'zod';

export const IsoDateTime = z.iso.datetime({ offset: true });
export const Uuid = z.uuid();
export const UuidV7 = z.uuid({ version: 'v7' });
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export const RequestId = z.union([Uuid, Ulid]);
export const IdempotencyKey = UuidV7;
export const Cursor = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/);
export const StopCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,11}$/);

export const StartMode = z.enum(['qr', 'gps_nearby', 'manual', 'resume', 'import']);
export const EpisodeOutcome = z.enum([
  'boarded',
  'abandoned',
  'passed_full',
  'cancelled',
  'timeout',
]);
export const Presence = z.enum([
  'unverified',
  'qr_only',
  'qr_geo',
  'gps_verified',
  'field_verified',
]);
export const DistanceBucket = z.enum(['0-50', '50-100', '100-150', '150-300', '>300']);
export const AccuracyBucket = z.enum(['<=20', '21-50', '51-80', '81-150', '>150']);
export const EvidenceLevel = z.enum(['none', 'indication', 'strong', 'field_verified']);
export const Direction = z.enum(['excess', 'no_excess', 'inconclusive']);
export const SourceTier = z.enum(['T1', 'T2', 'T3', 'T4']);
export const ReportCategory = z.enum([
  'service_wait',
  'service_no_show',
  'service_full',
  'stop_facility',
  'stop_cleanliness',
  'stop_safety',
  'route_info',
  'accessibility',
  'other',
]);
export const ReportStatus = z.enum([
  'draft',
  'submitted',
  'triaged',
  'acknowledged',
  'in_progress',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
  'rejected',
  'closed',
]);
export const TriageVerdict = z.enum([
  'join',
  'already_planned',
  'wrong_authority',
  'service_not_running',
  'data_supports',
  'data_insufficient',
  'new_report',
]);

export const Meta = z.object({
  requestId: RequestId,
  generatedAt: IsoDateTime,
  nextCursor: Cursor.nullable().optional(),
  hasMore: z.boolean().optional(),
});

export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: Meta });
}

export type StartMode = z.infer<typeof StartMode>;
export type EpisodeOutcome = z.infer<typeof EpisodeOutcome>;
export type Presence = z.infer<typeof Presence>;
export type DistanceBucket = z.infer<typeof DistanceBucket>;
export type AccuracyBucket = z.infer<typeof AccuracyBucket>;
export type EvidenceLevel = z.infer<typeof EvidenceLevel>;
export type Direction = z.infer<typeof Direction>;
export type SourceTier = z.infer<typeof SourceTier>;
export type ReportCategory = z.infer<typeof ReportCategory>;
export type ReportStatus = z.infer<typeof ReportStatus>;
export type TriageVerdict = z.infer<typeof TriageVerdict>;
export type Meta = z.infer<typeof Meta>;
export type Envelope<T> = { data: T; meta: Meta };