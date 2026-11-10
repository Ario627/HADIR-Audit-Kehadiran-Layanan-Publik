import { z } from 'zod';
import { IsoDateTime, Uuid } from './common';

export const ResponseKind = z.enum(['initial', 'follow_up', 'closure_claim', 'correction']);

export type ResponseKind = z.infer<typeof ResponseKind>;

export const ResolutionMethod = z.enum([
  'citizen_confirmation',
  'field_inspection',
  'observation_data',
  'panel_review',
]);

export type ResolutionMethod = z.infer<typeof ResolutionMethod>;

export const ResolutionVerdict = z.enum(['confirmed', 'refuted', 'inconclusive']);

export type ResolutionVerdict = z.infer<typeof ResolutionVerdict>;

export const VerifierKind = z.enum([
  'citizen',
  'independent_institution',
  'platform',
  'automatic',
]);

export type VerifierKind = z.infer<typeof VerifierKind>;

export const MilestoneKey = z.enum([
  'submitted',
  'triaged',
  'acknowledged',
  'scheduled',
  'responded',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
  'rejected',
]);

export type MilestoneKey = z.infer<typeof MilestoneKey>;

export const ResponseAttestation = z.object({
  signed: z.boolean(),
  status: z.enum([
    'unsigned',
    'verified',
    'signature_mismatch',
    'unsupported_algorithm',
    'payload_mismatch',
    'structural_invalid',
  ]),
  bodyDigest: z.string().length(64).nullable(),
  signingKeyId: z.string().max(64).nullable(),
  keyFingerprint: z.string().max(20).nullable(),
  algorithm: z.string().max(40).nullable(),
  signedAt: IsoDateTime.nullable(),
  message: z.string().min(1).max(400),
});

export type ResponseAttestation = z.infer<typeof ResponseAttestation>;

export const ReportResponse = z.object({
  id: Uuid,
  kind: ResponseKind,
  body: z.string().min(1).max(4000),
  evidenceUrls: z.array(z.string().min(1).max(500)).max(5),
  institutionId: Uuid,
  institutionName: z.string().min(1).max(160),
  authorDisplayName: z.string().max(120).nullable(),
  correctsResponseId: Uuid.nullable(),
  publishedAt: IsoDateTime,
  attestation: ResponseAttestation.nullable(),
});

export type ReportResponse = z.infer<typeof ReportResponse>;

export const MilestoneEntry = z.object({
  key: MilestoneKey,
  at: IsoDateTime,
  actorType: z.enum(['citizen', 'partner', 'admin', 'system']),
  label: z.string().min(1).max(80),
  terminal: z.boolean(),
});

export type MilestoneEntry = z.infer<typeof MilestoneEntry>;

export const MilestoneTracker = z.object({
  entries: z.array(MilestoneEntry).max(20),
  current: MilestoneKey.nullable(),
  next: MilestoneKey.nullable(),
  progress: z.number().min(0).max(1),
  terminal: z.enum(['resolved', 'disputed', 'rejected']).nullable(),
  pendingInfoRequest: z.boolean(),
  gaps: z.array(MilestoneKey).max(10),
  caveats: z.array(z.string().min(1).max(300)).max(10),
});

export type MilestoneTracker = z.infer<typeof MilestoneTracker>;

export const SlaPhaseView = z.object({
  phase: z.enum(['acknowledge', 'respond', 'resolve']),
  dueAt: IsoDateTime,
  metAt: IsoDateTime.nullable(),
  state: z.enum(['not_started', 'pending', 'met', 'overdue', 'met_late']),
  lateByHours: z.number().nullable(),
  remainingHours: z.number().nullable(),
});

export const SlaView = z.object({
  policyVersion: z.string().min(1).max(40),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  targets: z.object({
    acknowledgeHours: z.number().positive(),
    respondHours: z.number().positive(),
    resolveHours: z.number().positive(),
  }),
  phases: z.array(SlaPhaseView).length(3),
  breached: z.boolean(),
  escalation: z.number().int().min(0).max(3),
  summary: z.string().min(1).max(300),
});

export type SlaView = z.infer<typeof SlaView>;

export const ResolutionVerificationView = z.object({
  id: Uuid,
  method: ResolutionMethod,
  verdict: ResolutionVerdict,
  verifierKind: VerifierKind,
  verifierLabel: z.string().min(1).max(160),
  note: z.string().max(400).nullable(),
  evidenceUrls: z.array(z.string().min(1).max(500)).max(5),
  verifiedAt: IsoDateTime,
});

export type ResolutionVerificationView = z.infer<typeof ResolutionVerificationView>;

export const CaseFile = z.object({
  publicId: z.string().min(6).max(40),
  status: z.string().min(1).max(40),
  category: z.string().min(1).max(40),
  createdAt: IsoDateTime,
  milestones: MilestoneTracker,
  sla: SlaView.nullable(),
  responses: z.array(ReportResponse).max(20),
  verifications: z.array(ResolutionVerificationView).max(20),
  resolution: z.object({
    outcome: z.enum(['verified', 'disputed', 'undecided']),
    reason: z.string().min(1).max(400),
    supporting: z.number().int().nonnegative(),
    refuting: z.number().int().nonnegative(),
    inconclusive: z.number().int().nonnegative(),
    conflicts: z.array(z.object({ code: z.string().max(60), detail: z.string().max(300) })),
    cautions: z.array(z.string().max(400)).max(10),
  }),
  caveats: z.array(z.string().min(1).max(400)).max(10),
});

export type CaseFile = z.infer<typeof CaseFile>;

export const ResponseCreate = z
  .object({
    kind: ResponseKind.default('initial'),
    body: z.string().trim().min(20).max(4000),
    evidenceUrls: z.array(z.url().max(500)).max(5).default([]),
    correctsResponseId: Uuid.nullable().optional(),
  })
  .strict()
  .refine((value) => value.kind !== 'correction' || value.correctsResponseId != null, {
    message: 'Tanggapan koreksi wajib menyebut tanggapan yang dikoreksi.',
    path: ['correctsResponseId'],
  });

export type ResponseCreate = z.infer<typeof ResponseCreate>;

export const ResolutionVerifyInput = z
  .object({
    method: ResolutionMethod,
    verdict: ResolutionVerdict,
    note: z.string().trim().max(400).optional(),
    evidenceUrls: z.array(z.url().max(500)).max(5).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.verdict === 'confirmed' && value.evidenceUrls.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceUrls'],
        message: 'Verifikasi yang menguatkan klaim wajib menyertakan bukti.',
      });
    }
    if (value.verdict === 'refuted' && (value.note ?? '').length < 10) {
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Bantahan wajib menyertakan keterangan minimal 10 karakter.',
      });
    }
  });

export type ResolutionVerifyInput = z.infer<typeof ResolutionVerifyInput>;

export const ResolutionVerifyResult = z.object({
  publicId: z.string().min(6).max(40),
  status: z.string().min(1).max(40),
  previousStatus: z.string().min(1).max(40),
  outcome: z.enum(['verified', 'disputed', 'undecided']),
  conflicts: z.array(z.object({ code: z.string().max(60), detail: z.string().max(300) })),
});

export type ResolutionVerifyResult = z.infer<typeof ResolutionVerifyResult>;

export const SlaBreachItem = z.object({
  publicId: z.string().min(6).max(40),
  category: z.string().min(1).max(40),
  status: z.string().min(1).max(40),
  institutionName: z.string().max(160).nullable(),
  priority: z.enum(['low', 'normal', 'high', 'critical']),
  phase: z.enum(['acknowledge', 'respond', 'resolve']),
  dueAt: IsoDateTime,
  hoursLate: z.number().positive(),
  escalation: z.number().int().min(0).max(3),
});

export type SlaBreachItem = z.infer<typeof SlaBreachItem>;

export const SlaBreachQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    minEscalation: z.coerce.number().int().min(0).max(3).default(1),
  })
  .strict();

export type SlaBreachQuery = z.infer<typeof SlaBreachQuery>;

export const MemberRole = z.enum(['viewer', 'responder', 'admin']);

export type MemberRole = z.infer<typeof MemberRole>;

export const PartnerMember = z.object({
  membershipId: Uuid,
  userId: Uuid,
  displayName: z.string().min(1).max(120),
  role: MemberRole,
  status: z.enum(['active', 'suspended', 'revoked']),
  isSelf: z.boolean(),
  createdAt: IsoDateTime,
  revokedAt: IsoDateTime.nullable(),
  lastSeenAt: IsoDateTime.nullable(),
});

export type PartnerMember = z.infer<typeof PartnerMember>;

export const PartnerMemberList = z.object({
  members: z.array(PartnerMember).max(200),
  activeAdmins: z.number().int().nonnegative(),
  caveats: z.array(z.string().min(1).max(300)).max(10),
});

export type PartnerMemberList = z.infer<typeof PartnerMemberList>;

export const PartnerMemberUpdate = z
  .object({
    role: MemberRole,
  })
  .strict();

export type PartnerMemberUpdate = z.infer<typeof PartnerMemberUpdate>;

export const PartnerInviteCreate = z
  .object({
    email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
    role: MemberRole.default('responder'),
  })
  .strict();

export type PartnerInviteCreate = z.infer<typeof PartnerInviteCreate>;

export const PartnerInvite = z.object({
  inviteId: Uuid,
  emailMasked: z.string().min(3).max(254),
  role: MemberRole,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  consumedAt: IsoDateTime.nullable(),
  revokedAt: IsoDateTime.nullable(),
  pending: z.boolean(),
});

export type PartnerInvite = z.infer<typeof PartnerInvite>;

export const PartnerInviteIssued = z.object({
  invite: PartnerInvite,
  inviteToken: z.string().min(20).max(4096),
  expiresAt: IsoDateTime,
});

export type PartnerInviteIssued = z.infer<typeof PartnerInviteIssued>;

export const PartnerActionRecord = z.object({
  publicId: z.string().min(6).max(40),
  recorded: z.boolean(),
  id: Uuid,
});

export type PartnerActionRecord = z.infer<typeof PartnerActionRecord>;
