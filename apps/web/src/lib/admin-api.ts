import type {
  AdminAuditEntry,
  AppealDecisionResult,
  AppealView,
  AdminChainVerifyResult,
  AdminProfile,
  AdminReportQueue,
  CityList,
  CitySlaOverrideView,
  Commitment,
  FeatureFlag,
  HolidayView,
  InstitutionScorecardList,
  Notice,
  PanelCandidates,
  PanelView,
  SlaBreachItem,
} from '@hadir/contracts';
import { apiGetChecked, apiRequest, apiSendChecked, withQuery, type PayloadSchema } from './api';
import {
  adminProfileSchema,
  adminReportDetailSchema,
  adminReportQueueSchema,
  auditListSchema,
  chainVerifySchema,
  cityListSchema,
  featureFlagListSchema,
  featureFlagSchema,
  moderationResultSchema,
  noticeListSchema,
  noticeSchema,
  resolutionResultSchema,
  retentionRunListSchema,
  retentionSchema,
  rupImportSchema,
  rupListSchema,
  type RetentionReportView,
  type RetentionRunView,
  type RupRowView,
} from './admin-guards';
import {
  appealListSchema,
  appealSchema,
  citySlaListSchema,
  citySlaSchema,
  commitmentHistorySchema,
  commitmentListSchema,
  commitmentSchema,
  type CommitmentChangeView,
  holidayListSchema,
  holidaySchema,
  panelCandidatesSchema,
  panelSchema,
  scorecardListSchema,
  slaBreachListSchema,
} from './governance-guards';

const ADMIN_PATH = '/v1/admin';
const PUBLIC_PATH = '/v1';

export interface AdminCredentials {
  email: string;
  password: string;
  totp: string;
}

export async function adminLogin(input: AdminCredentials): Promise<AdminProfile> {
  const envelope = await apiSendChecked(`${ADMIN_PATH}/sessions`, adminProfileSchema, {
    method: 'POST',
    body: input,
  });
  return envelope.data;
}

export async function adminProfile(): Promise<AdminProfile> {
  const envelope = await apiGetChecked(`${ADMIN_PATH}/me`, adminProfileSchema);
  return envelope.data;
}

export async function adminLogout(): Promise<void> {
  await apiRequest(`${ADMIN_PATH}/sessions/current`, { method: 'DELETE' });
}

export async function fetchModerationQueue(input: {
  moderation: string;
  category?: string;
  limit?: number;
}): Promise<AdminReportQueue> {
  const envelope = await apiGetChecked(
    withQuery(`${ADMIN_PATH}/reports`, {
      moderation: input.moderation,
      category: input.category,
      limit: input.limit ?? 20,
    }),
    adminReportQueueSchema,
  );
  return envelope.data;
}

export async function fetchAdminReportDetail(
  publicId: string,
): Promise<import('@hadir/contracts').AdminReportDetail> {
  const envelope = await apiGetChecked(
    `${ADMIN_PATH}/reports/${encodeURIComponent(publicId)}`,
    adminReportDetailSchema,
  );
  return envelope.data;
}

export async function moderateReport(
  publicId: string,
  moderation: 'approved' | 'rejected' | 'quarantined',
  reason?: string,
): Promise<{ publicId: string; moderation: string; previousModeration: string; mediaUpdated: number }> {
  const body = reason === undefined ? { moderation } : { moderation, reason };
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/reports/${encodeURIComponent(publicId)}/moderation`,
    moderationResultSchema,
    { method: 'PATCH', body },
  );
  return envelope.data;
}

export async function fetchAdminCities(): Promise<CityList> {
  const envelope = await apiGetChecked(`${ADMIN_PATH}/cities`, cityListSchema);
  return envelope.data;
}

export async function fetchAdminNotices(input: {
  stopId?: string;
  routeId?: string;
  cityId?: string;
  limit?: number;
} = {}): Promise<Notice[]> {
  const envelope = await apiGetChecked(
    withQuery(`${ADMIN_PATH}/notices`, { ...input, limit: input.limit ?? 20 }),
    noticeListSchema,
  );
  return envelope.data;
}

export async function createNotice(body: unknown): Promise<Notice> {
  const envelope = await apiSendChecked(`${ADMIN_PATH}/notices`, noticeSchema, {
    method: 'POST',
    body,
  });
  return envelope.data;
}

export async function saveHoliday(body: unknown): Promise<HolidayView> {
  const envelope = await apiSendChecked(`${ADMIN_PATH}/holidays`, holidaySchema, {
    method: 'POST',
    body,
  });
  return envelope.data;
}

export async function fetchHolidays(input: {
  from?: string;
  to?: string;
  cityId?: string;
} = {}): Promise<HolidayView[]> {
  const envelope = await apiGetChecked(
    withQuery(`${PUBLIC_PATH}/holidays`, input),
    holidayListSchema,
  );
  return envelope.data;
}

export async function fetchCommitmentHistory(stopId: string): Promise<CommitmentChangeView[]> {
  const envelope = await apiGetChecked(
    withQuery(`${PUBLIC_PATH}/commitments/history`, { stopId, limit: 20 }),
    commitmentHistorySchema,
  );
  return envelope.data;
}

export async function createCommitment(body: unknown): Promise<Commitment> {
  const envelope = await apiSendChecked(`${ADMIN_PATH}/commitments`, commitmentSchema, {
    method: 'POST',
    body,
  });
  return envelope.data;
}

export async function verifyCommitment(id: string): Promise<Commitment> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/commitments/${encodeURIComponent(id)}/verify`,
    commitmentSchema,
    { method: 'POST' },
  );
  return envelope.data;
}

export async function revokeCommitment(id: string, reason: string): Promise<Commitment> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/commitments/${encodeURIComponent(id)}/revoke`,
    commitmentSchema,
    { method: 'POST', body: { reason } },
  );
  return envelope.data;
}

export async function fetchCommitments(input: {
  stopId?: string;
  routeId?: string;
  limit?: number;
}): Promise<Commitment[]> {
  const envelope = await apiGetChecked(
    withQuery(`${PUBLIC_PATH}/commitments`, { ...input, limit: input.limit ?? 50 }),
    commitmentListSchema,
  );
  return envelope.data;
}

const idOnlySchema: PayloadSchema<{ id: string }> = {
  safeParse(value: unknown) {
    if (!isRecordLike(value)) {
      return { success: false };
    }
    const id = value.id;
    return typeof id === 'string' && id.length > 0
      ? { success: true, data: { id } }
      : { success: false };
  },
};

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function createIncident(body: unknown): Promise<{ id: string }> {
  const envelope = await apiSendChecked(`${ADMIN_PATH}/incidents`, idOnlySchema, {
    method: 'POST',
    body,
  });
  return envelope.data;
}

export async function fetchInstitutions(): Promise<InstitutionScorecardList> {
  const envelope = await apiGetChecked(
    withQuery(`${PUBLIC_PATH}/institutions`, {}),
    scorecardListSchema,
  );
  return envelope.data;
}

export async function fetchAudit(input: {
  action?: string;
  objectType?: string;
  limit?: number;
} = {}): Promise<AdminAuditEntry[]> {
  const envelope = await apiGetChecked(
    withQuery(`${ADMIN_PATH}/audit`, { ...input, limit: input.limit ?? 50 }),
    auditListSchema,
  );
  return envelope.data;
}

export async function fetchFlags(): Promise<FeatureFlag[]> {
  const envelope = await apiGetChecked(`${ADMIN_PATH}/flags`, featureFlagListSchema);
  return envelope.data;
}

export async function setFlag(key: string, body: { value: unknown; description?: string }): Promise<FeatureFlag> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/flags/${encodeURIComponent(key)}`,
    featureFlagSchema,
    { method: 'POST', body },
  );
  return envelope.data;
}

export async function verifyChain(
  input: { since?: string; until?: string; maxReports?: number } = {},
): Promise<AdminChainVerifyResult> {
  const envelope = await apiSendChecked(`${ADMIN_PATH}/chain/verify`, chainVerifySchema, {
    method: 'POST',
    body: input,
  });
  return envelope.data;
}

const anchorSealedSchema: PayloadSchema<{ date: string; root: string; count: number }> = {
  safeParse(value: unknown) {
    if (!isRecordLike(value)) {
      return { success: false };
    }
    return typeof value.date === 'string' &&
      typeof value.root === 'string' &&
      typeof value.count === 'number'
      ? { success: true, data: { date: value.date, root: value.root, count: value.count } }
      : { success: false };
  },
};

export async function sealAnchor(
  date: string,
  force = false,
): Promise<{ date: string; root: string; count: number }> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/anchor/${encodeURIComponent(date)}`,
    anchorSealedSchema,
    { method: 'POST', body: { force } },
  );
  return envelope.data;
}

export async function importRup(body: {
  csv: string;
  sourceUrl: string;
  fiscalYear: number;
  dryRun: boolean;
}): Promise<{ inserted: number; updated: number; skipped: number; issues: { row: number; message: string }[]; dryRun: boolean }> {
  const envelope = await apiSendChecked(`${ADMIN_PATH}/rup/import`, rupImportSchema, {
    method: 'POST',
    body,
  });
  return envelope.data;
}

export async function fetchRup(input: {
  satker?: string;
  fiscalYear?: number;
  keyword?: string;
  limit?: number;
} = {}): Promise<RupRowView[]> {
  const envelope = await apiGetChecked(
    withQuery(`${ADMIN_PATH}/rup`, { ...input, limit: input.limit ?? 20 }),
    rupListSchema,
  );
  return envelope.data;
}

export async function fetchRetention(): Promise<RetentionReportView> {
  const envelope = await apiGetChecked(`${ADMIN_PATH}/retention`, retentionSchema);
  return envelope.data;
}

export async function fetchRetentionRuns(): Promise<RetentionRunView[]> {
  const envelope = await apiGetChecked(`${ADMIN_PATH}/retention/runs`, retentionRunListSchema);
  return envelope.data;
}

const retentionRunSchema: PayloadSchema<{ deleted: number; tables: number }> = {
  safeParse(value: unknown) {
    if (!isRecordLike(value)) {
      return { success: false };
    }
    return typeof value.deleted === 'number' && typeof value.tables === 'number'
      ? { success: true, data: { deleted: value.deleted, tables: value.tables } }
      : { success: false };
  },
};

export async function runRetention(): Promise<{ deleted: number; tables: number }> {
  const envelope = await apiSendChecked(`${ADMIN_PATH}/retention/run`, retentionRunSchema, {
    method: 'POST',
  });
  return envelope.data;
}

export async function fetchSlaBreaches(input: { limit?: number; minEscalation?: number } = {}): Promise<SlaBreachItem[]> {
  const envelope = await apiGetChecked(
    withQuery(`${ADMIN_PATH}/sla/breaches`, {
      limit: input.limit ?? 50,
      minEscalation: input.minEscalation ?? 1,
    }),
    slaBreachListSchema,
  );
  return envelope.data;
}

export async function verifyResolution(
  publicId: string,
  body: { method: string; verdict: string; note?: string; evidenceUrls: string[] },
): Promise<{ publicId: string; status: string; previousStatus: string; outcome: 'verified' | 'disputed' | 'undecided'; conflicts: { code: string; detail: string }[] }> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/reports/${encodeURIComponent(publicId)}/resolution`,
    resolutionResultSchema,
    { method: 'POST', body },
  );
  return envelope.data;
}

export async function fetchAdminPanel(publicId: string): Promise<PanelView> {
  const envelope = await apiGetChecked(
    `${ADMIN_PATH}/reports/${encodeURIComponent(publicId)}/panel`,
    panelSchema,
  );
  return envelope.data;
}

export async function fetchPanelCandidates(publicId: string): Promise<PanelCandidates> {
  const envelope = await apiGetChecked(
    `${ADMIN_PATH}/reports/${encodeURIComponent(publicId)}/panel/candidates`,
    panelCandidatesSchema,
  );
  return envelope.data;
}

export async function invitePanelMember(
  publicId: string,
  body: { institutionId: string; role: string },
): Promise<PanelView> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/reports/${encodeURIComponent(publicId)}/panel`,
    panelSchema,
    { method: 'POST', body },
  );
  return envelope.data;
}

export async function revokePanelMember(publicId: string, institutionId: string): Promise<PanelView> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/reports/${encodeURIComponent(publicId)}/panel/${encodeURIComponent(institutionId)}`,
    panelSchema,
    { method: 'DELETE' },
  );
  return envelope.data;
}

export async function fetchAppealQueue(input: {
  status: string;
  limit?: number;
}): Promise<AppealView[]> {
  const envelope = await apiGetChecked(
    withQuery(`${ADMIN_PATH}/appeals`, { status: input.status, limit: input.limit ?? 25 }),
    appealListSchema,
  );
  return envelope.data;
}

const APPEAL_STATUS_VALUES = ['submitted', 'inadmissible', 'admitted', 'upheld', 'overturned'] as const;
const APPEAL_OUTCOMES = ['upheld', 'overturned', 'partial', 'inadmissible'] as const;

const appealDecisionSchema: PayloadSchema<AppealDecisionResult> = {
  safeParse(value: unknown) {
    if (!isRecordLike(value)) {
      return { success: false };
    }
    const appealId = value.appealId;
    const publicId = value.publicId;
    const status = APPEAL_STATUS_VALUES.find((entry) => entry === value.status);
    const outcome = APPEAL_OUTCOMES.find((entry) => entry === value.outcome);
    const reportStatus = value.reportStatus;
    const previousReportStatus = value.previousReportStatus;
    if (
      typeof appealId !== 'string' ||
      typeof publicId !== 'string' ||
      status === undefined ||
      outcome === undefined ||
      typeof reportStatus !== 'string' ||
      typeof previousReportStatus !== 'string'
    ) {
      return { success: false };
    }
    return {
      success: true,
      data: { appealId, publicId, status, outcome, reportStatus, previousReportStatus },
    };
  },
};

export async function decideAppeal(
  appealId: string,
  body: { outcome: string; note: string },
): Promise<AppealDecisionResult> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/appeals/${encodeURIComponent(appealId)}/decision`,
    appealDecisionSchema,
    { method: 'POST', body },
  );
  return envelope.data;
}

export async function fetchCitySla(cityId: string): Promise<CitySlaOverrideView[]> {
  const envelope = await apiGetChecked(
    `${ADMIN_PATH}/cities/${encodeURIComponent(cityId)}/sla`,
    citySlaListSchema,
  );
  return envelope.data;
}

export async function setCitySla(cityId: string, body: unknown): Promise<CitySlaOverrideView> {
  const envelope = await apiSendChecked(
    `${ADMIN_PATH}/cities/${encodeURIComponent(cityId)}/sla`,
    citySlaSchema,
    { method: 'PUT', body },
  );
  return envelope.data;
}

export async function fetchReportAppealsForAdmin(publicId: string): Promise<AppealView[]> {
  const envelope = await apiGetChecked(
    `${PUBLIC_PATH}/reports/${encodeURIComponent(publicId)}/appeals`,
    appealListSchema,
  );
  return envelope.data;
}

export { appealSchema };
