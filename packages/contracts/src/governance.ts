import { z } from 'zod';
import { IsoDateTime, Uuid } from './common';

export const PanelRole = z.enum(['observer', 'verifier']);
export const PanelStatus = z.enum(['invited', 'active', 'declined', 'revoked']);

export type PanelRole = z.infer<typeof PanelRole>;
export type PanelStatus = z.infer<typeof PanelStatus>;

export const PanelGrantView = z.object({
  id: Uuid,
  institutionId: Uuid,
  institutionName: z.string().min(1).max(160),
  role: PanelRole,
  status: PanelStatus,
  isOwnInstitution: z.boolean(),
  createdAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
});

export type PanelGrantView = z.infer<typeof PanelGrantView>;

export const PanelView = z.object({
  publicId: z.string().min(6).max(40),
  cityId: Uuid,
  claimantInstitutionId: Uuid.nullable(),
  claimantInstitutionName: z.string().min(1).max(160),
  grants: z.array(PanelGrantView).max(30),
  quorum: z.object({
    required: z.number().int().nonnegative(),
    present: z.number().int().nonnegative(),
    met: z.boolean(),
    missing: z.number().int().nonnegative(),
  }),
  strength: z.enum(['weak', 'adequate', 'strong']),
  canVerify: z.boolean(),
  caveats: z.array(z.string().min(1).max(300)).max(10),
  summary: z.string().min(1).max(300),
});

export type PanelView = z.infer<typeof PanelView>;

export const PanelInviteInput = z
  .object({
    institutionId: Uuid,
    role: PanelRole.default('verifier'),
  })
  .strict();

export type PanelInviteInput = z.infer<typeof PanelInviteInput>;

export const PanelCandidateView = z.object({
  institutionId: Uuid,
  displayName: z.string().min(1).max(160),
  eligible: z.boolean,
  role: PanelRole,
  refusal: z
    .enum(['self', 'different_city', 'already_active', 'revoked_recently', 'unknown_city'])
    .nullable(),
  reason: z.string().min(1).max(300),
});

export type PanelCandidateView = z.infer<typeof PanelCandidateView>;

export const PanelCandidates = z.object({
  publicId: z.string().min(6).max(40),
  cityId: Uuid.nullable(),
  candidates: z.array(PanelCandidateView).max(100),
});

export type PanelCandidates = z.infer<typeof PanelCandidates>;

export const AppealGrounds = z.enum(['rejection', 'resolution', 'moderation', 'service']);
export const AppealStatus = z.enum([
  'submitted',
  'inadmissible',
  'admitted',
  'upheld',
  'overturned',
]);

export type AppealGrounds = z.infer<typeof AppealGrounds>;
export type AppealStatus = z.infer<typeof AppealStatus>;

export const AppealView = z.object({
  id: Uuid,
  publicId: z.string().min(6).max(40),
  grounds: AppealGrounds,
  groundsLabel: z.string().min(1).max(80),
  status: AppealStatus,
  statement: z.string().min(20).max(2000),
  evidenceUrls: z.array(z.string().min(1).max(500)).max(5),
  decisionNote: z.string().max(1000).nullable(),
  outcomeTransition: z.string().max(40).nullable(),
  decidedAt: IsoDateTime.nullable(),
  windowDeadline: IsoDateTime,
  windowOpen: z.boolean(),
  createdAt: IsoDateTime,
  decisionDue: IsoDateTime,
  decisionOverdue: z.boolean(),
  decisionLabel: z.string().min(1).max(80),
  summary: z.string().min(1).max(300),
});

export type AppealView = z.infer<typeof AppealView>;

export const AppealCreate = z
  .object({
    grounds: AppealGrounds,
    statement: z.string().trim().min(20).max(2000),
    evidenceUrls: z.array(z.url().max(500)).max(5).default([]),
  })
  .strict();

export type AppealCreate = z.infer<typeof AppealCreate>;

export const AppealDecisionInput = z
  .object({
    outcome: z.enum(['upheld', 'overturned', 'partial', 'inadmissible']),
    note: z.string().trim().min(10).max(1000),
  })
  .strict();

export type AppealDecisionInput = z.infer<typeof AppealDecisionInput>;

export const AppealDecisionResult = z.object({
  appealId: Uuid,
  publicId: z.string().min(6).max(40),
  status: AppealStatus,
  outcome: z.enum(['upheld', 'overturned', 'partial', 'inadmissible']),
  reportStatus: z.string().min(1).max(40),
  previousReportStatus: z.string().min(1).max(40),
});

export type AppealDecisionResult = z.infer<typeof AppealDecisionResult>;

export const AppealQueueQuery = z
  .object({
    status: z.enum(['submitted', 'admitted', 'decided']).default('submitted'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type AppealQueueQuery = z.infer<typeof AppealQueueQuery>;

export const CitySlaOverrideView = z.object({
  cityId: Uuid,
  cityName: z.string().min(1).max(120),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  acknowledgeHours: z.number().positive(),
  respondHours: z.number().positive(),
  resolveHours: z.number().positive(),
  sourceUrl: z.string().min(1).max(500),
  note: z.string().max(500).nullable(),
});

export type CitySlaOverrideView = z.infer<typeof CitySlaOverrideView>;

export const CitySlaOverrideInput = z
  .object({
    priority: z.enum(['low', 'normal', 'high', 'critical']),
    acknowledgeHours: z.number().positive().max(2160),
    respondHours: z.number().positive().max(2160),
    resolveHours: z.number().positive().max(8760),
    sourceUrl: z.url().max(500),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.acknowledgeHours <= value.respondHours &&
      value.respondHours <= value.resolveHours,
    { message: 'Urutan tenggat harus acknowledge <= respond <= resolve.', path: ['respondHours'] },
  );

export type CitySlaOverrideInput = z.infer<typeof CitySlaOverrideInput>;

export const ScorecardQuery = z
  .object({
    windowDays: z.coerce.number().int().min(30).max(365).default(90),
  })
  .strict();

export type ScorecardQuery = z.infer<typeof ScorecardQuery>;

export const ScorecardDimensionView = z.object({
  dimension: z.enum([
    'responsiveness',
    'timeliness',
    'resolutionIntegrity',
    'appealFairness',
  ]),
  value: z.number().min(0).max(1).nullable(),
  band: z.enum(['very_low', 'low', 'moderate', 'high']),
  numerator: z.number().int().nonnegative(),
  denominator: z.number().int().nonnegative(),
  label: z.string().min(1).max(120),
});

export const InstitutionScorecard = z.object({
  institutionId: Uuid,
  institutionName: z.string().min(1).max(160),
  cityId: Uuid.nullable(),
  cityName: z.string().max(120).nullable(),
  windowDays: z.number().int().positive(),
  state: z.enum(['insufficient', 'provisional', 'published']),
  overall: z.number().min(0).max(1).nullable(),
  band: z.enum(['very_low', 'low', 'moderate', 'high']),
  rank: z.number().int().positive().nullable(),
  dimensions: z.array(ScorecardDimensionView).length(4),
  sample: z.object({
    reportsReceived: z.number().int().nonnegative(),
    slaTracked: z.number().int().nonnegative(),
    appealsDecided: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string().min(1).max(300)).max(10),
  summary: z.string().min(1).max(400),
  caveats: z.array(z.string().min(1).max(400)).max(10),
});

export type InstitutionScorecard = z.infer<typeof InstitutionScorecard>;

export const InstitutionScorecardList = z.object({
  items: z.array(InstitutionScorecard).max(200),
  cityId: Uuid.nullable(),
  generatedAt: IsoDateTime,
  caveats: z.array(z.string().min(1).max(400)).max(10),
});

export type InstitutionScorecardList = z.infer<typeof InstitutionScorecardList>;
