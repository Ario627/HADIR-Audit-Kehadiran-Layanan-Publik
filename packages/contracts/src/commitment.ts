import { z } from 'zod';
import { AnchorDate } from './transparency';
import { Cursor, IsoDateTime, Uuid } from './common';

export const CommitmentKind = z.enum(['headway', 'span', 'reliability', 'other']);
export const CommitmentStatus = z.enum(['draft', 'verified', 'superseded', 'revoked']);
export const CommitmentDayScope = z.enum(['all', 'weekday', 'weekend', 'holiday']);

export type CommitmentKind = z.infer<typeof CommitmentKind>;
export type CommitmentStatus = z.infer<typeof CommitmentStatus>;
export type CommitmentDayScope = z.infer<typeof CommitmentDayScope>;

export const Commitment = z.object({
  id: Uuid,
  routeId: Uuid.nullable(),
  stopId: Uuid.nullable(),
  kind: CommitmentKind,
  dayScope: CommitmentDayScope,
  headwayMin: z.number().positive().max(240).nullable(),
  spanStart: z.string().max(16).nullable(),
  spanEnd: z.string().max(16).nullable(),
  sourceDocumentUrl: z.string().min(8).max(500),
  sourceDocumentTitle: z.string().max(200).nullable(),
  sourceDocumentVersion: z.string().max(80).nullable(),
  validFrom: AnchorDate,
  validUntil: AnchorDate.nullable(),
  status: CommitmentStatus,
  verifiedAt: IsoDateTime.nullable(),
  institutionName: z.string().min(1).max(160),
});

export type Commitment = z.infer<typeof Commitment>;

export const BenchmarkReason = z.enum([
  'no_commitment',
  'not_verified',
  'outside_validity',
  'scope_mismatch',
  'missing_headway',
]);

export const Benchmark = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('resolved'),
    commitmentId: Uuid,
    specificity: z.enum(['stop', 'route']),
    headwayMin: z.number().positive(),
    idealWaitMin: z.number().nonnegative(),
    thresholdMin: z.number().nonnegative(),
    sourceDocumentUrl: z.string().min(1).max(500),
    sourceDocumentVersion: z.string().max(80).nullable(),
    validFrom: AnchorDate,
    validUntil: AnchorDate.nullable(),
    message: z.string().min(1).max(500),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: BenchmarkReason,
    message: z.string().min(1).max(500),
    considered: z.number().int().nonnegative(),
  }),
]);

export type Benchmark = z.infer<typeof Benchmark>;

export const CommitmentQuery = z
  .object({
    routeId: Uuid.optional(),
    stopId: Uuid.optional(),
    onDate: AnchorDate.optional(),
    dayScope: CommitmentDayScope.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: Cursor.optional(),
  })
  .strict()
  .refine((value) => value.routeId !== undefined || value.stopId !== undefined, {
    message: 'Sertakan routeId atau stopId.',
    path: ['routeId'],
  });

export type CommitmentQuery = z.infer<typeof CommitmentQuery>;

export const CommitmentChange = z.object({
  validFrom: AnchorDate,
  validUntil: AnchorDate.nullable(),
  headwayMin: z.number().positive().nullable(),
  sourceDocumentUrl: z.string().min(1).max(500),
  sourceDocumentVersion: z.string().max(80).nullable(),
  supersededBy: Uuid.nullable(),
  days: z.number().int().nonnegative().nullable(),
});

export type CommitmentChange = z.infer<typeof CommitmentChange>;

export const CommitmentHistoryQuery = z
  .object({
    routeId: Uuid.optional(),
    stopId: Uuid.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine((value) => value.routeId !== undefined || value.stopId !== undefined, {
    message: 'Sertakan routeId atau stopId.',
    path: ['routeId'],
  });

export type CommitmentHistoryQuery = z.infer<typeof CommitmentHistoryQuery>;

export const IncidentImpact = z.enum(['none', 'minor', 'major', 'service_stopped']);

export type IncidentImpact = z.infer<typeof IncidentImpact>;

export const OperationalContext = z.object({
  id: Uuid,
  kind: z.string().min(1).max(40),
  impact: IncidentImpact,
  text: z.string().min(1).max(1000),
  sourceUrl: z.string().min(1).max(500),
  startsAt: IsoDateTime.nullable(),
  endsAt: IsoDateTime.nullable(),
  stopId: Uuid.nullable(),
  routeId: Uuid.nullable(),
  acknowledgedAt: IsoDateTime.nullable(),
  institutionName: z.string().max(160).nullable(),
});

export type OperationalContext = z.infer<typeof OperationalContext>;

export const ContextQuery = z
  .object({
    stopId: Uuid.optional(),
    routeId: Uuid.optional(),
    from: IsoDateTime.optional(),
    to: IsoDateTime.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export type ContextQuery = z.infer<typeof ContextQuery>;

export const ContextTimeline = z.object({
  events: z.array(OperationalContext).max(100),
  segments: z
    .array(
      z.object({
        start: IsoDateTime,
        end: IsoDateTime,
        impact: IncidentImpact,
        eventIds: z.array(Uuid).max(20),
      }),
    )
    .max(100),
  dominantImpact: IncidentImpact.nullable(),
  caveats: z.array(z.string().min(1).max(400)).max(10),
});

export type ContextTimeline = z.infer<typeof ContextTimeline>;

export const ProvenanceSourceKind = z.enum([
  'citizen_observation',
  'service_commitment',
  'operational_notice',
  'gtfs_snapshot',
  'gps_snapshot',
  'report',
]);

export const ProvenanceSource = z.object({
  kind: ProvenanceSourceKind,
  ref: z.string().min(1).max(200),
  retrievedAt: IsoDateTime.nullable(),
  url: z.string().max(500).nullable(),
});

export type ProvenanceSource = z.infer<typeof ProvenanceSource>;

export const ReproducibilityRecipe = z.object({
  methodVersion: z.string().min(1).max(40),
  parameters: z.record(z.string(), z.unknown()),
  datasetDigest: z.string().min(1).max(128),
  outputDigest: z.string().min(1).max(128),
  inputRows: z.number().int().nonnegative(),
  window: z.object({ start: IsoDateTime, end: IsoDateTime }),
  steps: z.array(z.string().min(1).max(600)).max(20),
  caveats: z.array(z.string().min(1).max(400)).max(20),
});

export type ReproducibilityRecipe = z.infer<typeof ReproducibilityRecipe>;

export const ProvenanceEntity = z.object({
  provType: z.literal('prov:Entity'),
  id: z.string().min(1).max(300),
  label: z.string().min(1).max(300),
  digest: z.string().min(1).max(128),
  generatedBy: z.string().min(1).max(300),
  derivedFrom: z.array(z.string().min(1).max(300)).max(20),
});

export const ProvenanceActivity = z.object({
  provType: z.literal('prov:Activity'),
  id: z.string().min(1).max(300),
  methodVersion: z.string().min(1).max(40),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime,
  used: z.array(z.string().min(1).max(300)).max(50),
  generated: z.array(z.string().min(1).max(300)).max(20),
});

export const ProvenanceAgent = z.object({
  provType: z.literal('prov:Agent'),
  id: z.string().min(1).max(300),
  role: z.enum(['software', 'human', 'organization']),
  label: z.string().min(1).max(200),
});

export const ProvenanceDocument = z.object({
  schemaVersion: z.number().int().positive(),
  generatedAt: IsoDateTime,
  subject: z.object({ kind: z.string().min(1).max(40), ref: z.string().min(1).max(80) }),
  entities: z.array(ProvenanceEntity).max(20),
  activity: ProvenanceActivity,
  agents: z.array(ProvenanceAgent).max(10),
  sources: z.array(ProvenanceSource).max(50),
  reproducibility: ReproducibilityRecipe,
});

export type ProvenanceDocument = z.infer<typeof ProvenanceDocument>;

export const AnalysisSnapshot = z.object({
  id: Uuid,
  subjectKind: z.string().min(1).max(40),
  subjectRef: z.string().min(1).max(80),
  methodVersion: z.string().min(1).max(40),
  datasetDigest: z.string().min(1).max(128),
  outputDigest: z.string().min(1).max(128),
  inputRows: z.number().int().nonnegative(),
  evidenceLevel: z.enum(['none', 'indication', 'strong', 'field_verified']),
  direction: z.enum(['excess', 'no_excess', 'inconclusive']),
  warnings: z.array(z.string().min(1).max(80)).max(20),
  computedAt: IsoDateTime,
});

export type AnalysisSnapshot = z.infer<typeof AnalysisSnapshot>;

export const QualityDimensionView = z.object({
  dimension: z.enum(['strength', 'precision', 'coverage', 'reliability', 'corroboration']),
  score: z.number().min(0).max(1),
  band: z.enum(['very_low', 'low', 'moderate', 'high']),
  reasons: z.array(z.string().min(1).max(60)).max(10),
});

export const QualityBreakdownView = z.object({
  dimensions: z.array(QualityDimensionView).length(5),
  limiting: z.enum(['strength', 'precision', 'coverage', 'reliability', 'corroboration']),
  band: z.enum(['very_low', 'low', 'moderate', 'high']),
  score: z.number().min(0).max(1),
  fieldVerifiedEligible: z.boolean(),
  warnings: z.array(z.string().min(1).max(60)).max(10),
});

export type QualityBreakdownView = z.infer<typeof QualityBreakdownView>;

export const RepresentativenessView = z.object({
  score: z.number().min(0).max(1),
  band: z.enum(['very_low', 'low', 'moderate', 'high']),
  limitedTo: z.string().max(200).nullable(),
  warnings: z
    .array(z.object({ code: z.string().min(1).max(60), detail: z.string().min(1).max(300) }))
    .max(20),
});

export type RepresentativenessView = z.infer<typeof RepresentativenessView>;

export const EvidencePack = z.object({
  stopId: Uuid,
  stopCode: z.string().min(1).max(12),
  stopName: z.string().min(1).max(160),
  generatedAt: IsoDateTime,
  dayScope: CommitmentDayScope,
  holidayName: z.string().min(1).max(120).nullable(),
  benchmark: Benchmark,
  quality: QualityBreakdownView,
  representativeness: RepresentativenessView,
  context: ContextTimeline,
  provenance: ProvenanceDocument.nullable(),
  snapshot: AnalysisSnapshot.nullable(),
  disclaimer: z.string().min(1).max(600),
});

export type EvidencePack = z.infer<typeof EvidencePack>;

export const EvidenceQuery = z
  .object({
    window: z.enum(['7d', '30d']).default('7d'),
    routeId: Uuid.optional(),
  })
  .strict();

export type EvidenceQuery = z.infer<typeof EvidenceQuery>;

export const HolidayView = z.object({
  date: AnchorDate,
  name: z.string().min(1).max(120),
  scope: z.enum(['national', 'city']),
  cityId: Uuid.nullable(),
  sourceUrl: z.string().min(8).max(500),
});

export type HolidayView = z.infer<typeof HolidayView>;

export const HolidayQuery = z
  .object({
    from: AnchorDate.optional(),
    to: AnchorDate.optional(),
    cityId: Uuid.optional(),
  })
  .strict();

export type HolidayQuery = z.infer<typeof HolidayQuery>;

export const CommitmentCreate = z
  .object({
    institutionId: Uuid,
    routeId: Uuid.nullable().optional(),
    stopId: Uuid.nullable().optional(),
    kind: CommitmentKind.default('headway'),
    dayScope: CommitmentDayScope.default('all'),
    headwayMin: z.number().positive().max(240).nullable().optional(),
    spanStart: z.string().max(16).nullable().optional(),
    spanEnd: z.string().max(16).nullable().optional(),
    sourceDocumentUrl: z.url().max(500),
    sourceDocumentTitle: z.string().trim().max(200).nullable().optional(),
    sourceDocumentVersion: z.string().trim().max(80).nullable().optional(),
    validFrom: AnchorDate,
    validUntil: AnchorDate.nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((value) => value.routeId != null || value.stopId != null, {
    message: 'Isi routeId atau stopId.',
    path: ['routeId'],
  })
  .refine(
    (value) => value.validUntil == null || value.validUntil >= value.validFrom,
    { message: 'validUntil harus setelah validFrom.', path: ['validUntil'] },
  );

export type CommitmentCreate = z.infer<typeof CommitmentCreate>;

export const CommitmentModerate = z
  .object({
    reason: z.string().trim().min(10).max(400).optional(),
  })
  .strict();

export type CommitmentModerate = z.infer<typeof CommitmentModerate>;

export const IncidentCreate = z
  .object({
    kind: z.enum(['detour', 'repair', 'suspension', 'schedule', 'other']),
    impact: IncidentImpact.default('minor'),
    text: z.string().trim().min(10).max(1000),
    sourceUrl: z.url().max(500),
    stopId: Uuid.nullable().optional(),
    routeId: Uuid.nullable().optional(),
    cityId: Uuid.nullable().optional(),
    startsAt: IsoDateTime.nullable().optional(),
    endsAt: IsoDateTime.nullable().optional(),
    publicVisible: z.boolean().default(true),
  })
  .strict()
  .refine(
    (value) => value.startsAt == null || value.endsAt == null || value.startsAt <= value.endsAt,
    { message: 'startsAt harus sebelum endsAt.', path: ['endsAt'] },
  );

export type IncidentCreate = z.infer<typeof IncidentCreate>;
