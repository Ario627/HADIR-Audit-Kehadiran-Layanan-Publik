import type {
  AdminAuditEntry,
  AdminChainVerifyResult,
  AdminProfile,
  AdminReportQueue,
  AdminReportRow,
  CityList,
  FeatureFlag,
  Notice,
} from '@hadir/contracts';
import type { PayloadSchema } from './api';
import {
  isRecord,
  readCount,
  readIsoDateTime,
  readNullableNumber,
  readNullableText,
  readNumber,
  readText,
} from './guards';

const ROLES = ['moderator', 'superadmin'] as const;
const NOTICE_KINDS = ['detour', 'repair', 'suspension', 'schedule', 'other'] as const;
const MODERATIONS = ['pending', 'approved', 'rejected', 'quarantined'] as const;
const ACTOR_TYPES = ['citizen', 'partner', 'system', 'moderator', 'superadmin'] as const;
const BREAK_REASONS = [
  'prev_mismatch',
  'payload_mismatch',
  'chain_mismatch',
  'gap',
] as const;
const EVIDENCE_LEVELS = ['none', 'indication', 'strong', 'field_verified'] as const;

function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return allowed.some((entry) => entry === value) ? (value as T) : null;
}

function readNullableIso(value: unknown): string | null {
  return value === null ? null : readIsoDateTime(value);
}

function readNullableId(value: unknown, max: number): string | null {
  return value === null ? null : (readText(value, max) ?? null);
}

function readStringList(value: unknown, max: number, limit: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) {
    return null;
  }
  const out: string[] = [];
  for (const entry of value) {
    const text = readText(entry, max);
    if (text === null) {
      return null;
    }
    out.push(text);
  }
  return out;
}

export const adminProfileSchema: PayloadSchema<AdminProfile> = {
  safeParse(value: unknown) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const adminId = readText(value.adminId, 64);
    const email = readText(value.email, 254);
    const displayName = readText(value.displayName, 120);
    const role = pick(ROLES, value.role);
    const expiresAt = readIsoDateTime(value.expiresAt);
    if (adminId === null || email === null || displayName === null || role === null || expiresAt === null) {
      return { success: false };
    }
    return { success: true, data: { adminId, email, displayName, role, expiresAt } };
  },
};

function readNotice(value: unknown): Notice | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const kind = pick(NOTICE_KINDS, value.kind);
  const text = readText(value.text, 1000);
  const sourceUrl = readText(value.sourceUrl, 500);
  const createdAt = readIsoDateTime(value.createdAt);
  if (id === null || kind === null || text === null || sourceUrl === null || createdAt === null) {
    return null;
  }
  return {
    id,
    kind,
    text,
    sourceUrl,
    cityId: readNullableId(value.cityId, 64),
    stopId: readNullableId(value.stopId, 64),
    routeId: readNullableId(value.routeId, 64),
    institutionId: readNullableId(value.institutionId, 64),
    startsAt: readNullableIso(value.startsAt),
    endsAt: readNullableIso(value.endsAt),
    createdAt,
  };
}

export function readItems(value: unknown, max: number): unknown[] | null {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > max) {
    return null;
  }
  return value.items;
}

export const noticeListSchema: PayloadSchema<Notice[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 100);
    if (rows === null) {
      return { success: false };
    }
    const items: Notice[] = [];
    for (const entry of rows) {
      const parsed = readNotice(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    return { success: true, data: items };
  },
};

export const noticeSchema: PayloadSchema<Notice> = {
  safeParse(value: unknown) {
    const parsed = readNotice(value);
    return parsed === null ? { success: false } : { success: true, data: parsed };
  },
};

export const featureFlagListSchema: PayloadSchema<FeatureFlag[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 200);
    if (rows === null) {
      return { success: false };
    }
    const items: FeatureFlag[] = [];
    for (const entry of rows) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const key = readText(entry.key, 64);
      const updatedAt = readIsoDateTime(entry.updatedAt);
      const description = readNullableText(entry.description, 240);
      if (key === null || updatedAt === null || description === undefined) {
        return { success: false };
      }
      items.push({ key, value: entry.value ?? null, description, updatedAt });
    }
    return { success: true, data: items };
  },
};

export const featureFlagSchema: PayloadSchema<FeatureFlag> = {
  safeParse(value: unknown) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const key = readText(value.key, 64);
    const updatedAt = readIsoDateTime(value.updatedAt);
    const description = readNullableText(value.description, 240);
    if (key === null || updatedAt === null || description === undefined) {
      return { success: false };
    }
    return {
      success: true,
      data: { key, value: value.value ?? null, description, updatedAt },
    };
  },
};

function readAuditEntry(value: unknown): AdminAuditEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const action = readText(value.action, 80);
  const objectType = readText(value.objectType, 40);
  const actorType = pick(ACTOR_TYPES, value.actorType);
  const createdAt = readIsoDateTime(value.createdAt);
  if (id === null || action === null || objectType === null || actorType === null || createdAt === null) {
    return null;
  }
  return {
    id,
    action,
    objectType,
    objectId: readNullableId(value.objectId, 80),
    actorType,
    actorId: readNullableId(value.actorId, 80),
    requestId: readNullableId(value.requestId, 80),
    payload: isRecord(value.payload) ? value.payload : {},
    createdAt,
  };
}

export const auditListSchema: PayloadSchema<AdminAuditEntry[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 200);
    if (rows === null) {
      return { success: false };
    }
    const items: AdminAuditEntry[] = [];
    for (const entry of rows) {
      const parsed = readAuditEntry(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    return { success: true, data: items };
  },
};

export const chainVerifySchema: PayloadSchema<AdminChainVerifyResult> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.breaks)) {
      return { success: false };
    }
    const checkedReports = readCount(value.checkedReports, 100_000);
    const checkedEvents = readCount(value.checkedEvents, 10_000_000);
    if (checkedReports === null || checkedEvents === null || value.breaks.length > 500) {
      return { success: false };
    }
    const breaks: AdminChainVerifyResult['breaks'] = [];
    for (const entry of value.breaks) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const reportPublicId = readText(entry.reportPublicId, 40);
      const seq = readCount(entry.seq, 10_000_000);
      const kind = readText(entry.kind, 40);
      const reason = pick(BREAK_REASONS, entry.reason);
      if (reportPublicId === null || seq === null || kind === null || reason === null) {
        return { success: false };
      }
      breaks.push({ reportPublicId, seq, kind, reason });
    }
    return {
      success: true,
      data: { checkedReports, checkedEvents, breaks, ok: value.ok === true },
    };
  },
};

export const rupImportSchema: PayloadSchema<{
  inserted: number;
  updated: number;
  skipped: number;
  issues: { row: number; message: string }[];
  dryRun: boolean;
}> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.issues)) {
      return { success: false };
    }
    const inserted = readCount(value.inserted, 1_000_000);
    const updated = readCount(value.updated, 1_000_000);
    const skipped = readCount(value.skipped, 1_000_000);
    if (inserted === null || updated === null || skipped === null || value.issues.length > 100) {
      return { success: false };
    }
    const issues: { row: number; message: string }[] = [];
    for (const entry of value.issues) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const row = readCount(entry.row, 100_000);
      const message = readText(entry.message, 240);
      if (row === null || message === null) {
        return { success: false };
      }
      issues.push({ row, message });
    }
    return { success: true, data: { inserted, updated, skipped, issues, dryRun: value.dryRun === true } };
  },
};

export interface RupRowView {
  id: string;
  satker: string;
  name: string;
  location: string | null;
  fundingSource: string | null;
  pagu: string | null;
  method: string | null;
  fiscalYear: number;
  status: string | null;
  sourceUrl: string;
  fetchedAt: string;
}

export const rupListSchema: PayloadSchema<RupRowView[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 100);
    if (rows === null) {
      return { success: false };
    }
    const items: RupRowView[] = [];
    for (const entry of rows) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const id = readText(entry.id, 64);
      const satker = readText(entry.satker, 160);
      const name = readText(entry.name, 500);
      const fiscalYear = readCount(entry.fiscalYear, 2100);
      const sourceUrl = readText(entry.sourceUrl, 500);
      const fetchedAt = readIsoDateTime(entry.fetchedAt);
      if (id === null || satker === null || name === null || fiscalYear === null || sourceUrl === null || fetchedAt === null) {
        return { success: false };
      }
      items.push({
        id,
        satker,
        name,
        location: readNullableId(entry.location, 200),
        fundingSource: readNullableId(entry.fundingSource, 200),
        pagu: readNullableId(entry.pagu, 40),
        method: readNullableId(entry.method, 160),
        fiscalYear,
        status: readNullableId(entry.status, 60),
        sourceUrl,
        fetchedAt,
      });
    }
    return { success: true, data: items };
  },
};

export interface RetentionDecisionView {
  dataset: string;
  action: string;
  effectiveDays: number | null;
  cutoff: string | null;
  overridden: boolean;
  rejectedOverride: string | null;
  reason: string | null;
}

export interface RetentionReportView {
  version: string;
  description: string[];
  actionable: number;
  protectedCount: number;
  decisions: RetentionDecisionView[];
  warnings: string[];
}

export const retentionSchema: PayloadSchema<RetentionReportView> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.decisions) || !Array.isArray(value.warnings)) {
      return { success: false };
    }
    const version = readText(value.version, 40);
    const description = readStringList(value.description, 600, 40);
    const actionable = readCount(value.actionable, 1000);
    const protectedCount = readCount(value.protectedCount, 1_000_000);
    const warnings = readStringList(value.warnings, 300, 40);
    if (
      version === null ||
      description === null ||
      actionable === null ||
      protectedCount === null ||
      warnings === null
    ) {
      return { success: false };
    }
    const decisions: RetentionDecisionView[] = [];
    for (const entry of value.decisions) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const dataset = readText(entry.dataset, 80);
      const action = readText(entry.action, 40);
      const reason = readNullableText(entry.reason, 400);
      const rejectedOverride = readNullableText(entry.rejectedOverride, 300);
      if (
        dataset === null ||
        action === null ||
        reason === undefined ||
        rejectedOverride === undefined
      ) {
        return { success: false };
      }
      decisions.push({
        dataset,
        action,
        effectiveDays: readNullableNumber(entry.effectiveDays) ?? null,
        cutoff: readNullableIso(entry.cutoff),
        overridden: entry.overridden === true,
        rejectedOverride,
        reason,
      });
    }
    return {
      success: true,
      data: {
        version,
        description,
        actionable,
        protectedCount,
        decisions,
        warnings,
      },
    };
  },
};

export interface RetentionRunView {
  startedAt: string;
  finishedAt: string | null;
  rowsRemoved: number;
  triggeredBy: string;
  errorCode: string | null;
}

export const retentionRunListSchema: PayloadSchema<RetentionRunView[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 20);
    if (rows === null) {
      return { success: false };
    }
    const items: RetentionRunView[] = [];
    for (const entry of rows) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const startedAt = readIsoDateTime(entry.startedAt);
      const rowsRemoved = readCount(entry.rowsRemoved, 10_000_000);
      const triggeredBy = readText(entry.triggeredBy, 40);
      if (startedAt === null || rowsRemoved === null || triggeredBy === null) {
        return { success: false };
      }
      items.push({
        startedAt,
        finishedAt: readNullableIso(entry.finishedAt),
        rowsRemoved,
        triggeredBy,
        errorCode: readNullableText(entry.errorCode, 80) ?? null,
      });
    }
    return { success: true, data: items };
  },
};

function readAdminReportRow(value: unknown): AdminReportRow | null {
  if (!isRecord(value)) {
    return null;
  }
  const publicId = readText(value.publicId, 40);
  const moderation = pick(MODERATIONS, value.moderation);
  const stopCode = readText(value.stopCode, 12);
  const stopName = readText(value.stopName, 160);
  const text = readText(value.text, 2000);
  const evidenceLevel = pick(EVIDENCE_LEVELS, value.evidenceLevel);
  const corroborationCount = readCount(value.corroborationCount, 10_000);
  const createdAt = readIsoDateTime(value.createdAt);
  if (
    publicId === null ||
    moderation === null ||
    stopCode === null ||
    stopName === null ||
    text === null ||
    evidenceLevel === null ||
    corroborationCount === null ||
    createdAt === null
  ) {
    return null;
  }
  return {
    publicId,
    category: value.category as AdminReportRow['category'],
    status: value.status as AdminReportRow['status'],
    moderation,
    stopCode,
    stopName,
    institutionName: readNullableText(value.institutionName, 160) ?? null,
    text,
    evidenceLevel,
    corroborationCount,
    createdAt,
  };
}

export const adminReportDetailSchema: PayloadSchema<import('@hadir/contracts').AdminReportDetail> = {
  safeParse(value: unknown) {
    const base = readAdminReportRow(value);
    if (base === null || !isRecord(value)) {
      return { success: false };
    }
    const evidenceScore = readNumber(value.evidenceScore);
    if (evidenceScore === null || evidenceScore < 0 || evidenceScore > 1) {
      return { success: false };
    }
    return {
      success: true,
      data: {
        ...base,
        followUpAt: readNullableIso(value.followUpAt),
        resolvedAt: readNullableIso(value.resolvedAt),
        evidenceScore,
      },
    };
  },
};

export const adminReportQueueSchema: PayloadSchema<AdminReportQueue> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.items)) {
      return { success: false };
    }
    const items: AdminReportRow[] = [];
    for (const entry of value.items) {
      const parsed = readAdminReportRow(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    return { success: true, data: { items, count: items.length } };
  },
};

export const cityListSchema: PayloadSchema<CityList> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 200) {
      return { success: false };
    }
    const items: CityList['items'] = [];
    for (const entry of value.items) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const id = readText(entry.id, 64);
      const code = readText(entry.code, 8);
      const name = readText(entry.name, 120);
      const timezone = readText(entry.timezone, 60);
      if (id === null || code === null || name === null || timezone === null) {
        return { success: false };
      }
      items.push({ id, code, name, timezone });
    }
    return { success: true, data: { items, count: items.length } };
  },
};

export const moderationResultSchema: PayloadSchema<{
  publicId: string;
  moderation: string;
  previousModeration: string;
  mediaUpdated: number;
}> = {
  safeParse(value: unknown) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const publicId = readText(value.publicId, 40);
    const moderation = pick(MODERATIONS, value.moderation);
    const previousModeration = pick(MODERATIONS, value.previousModeration);
    const mediaUpdated = readCount(value.mediaUpdated, 10_000);
    if (publicId === null || moderation === null || previousModeration === null || mediaUpdated === null) {
      return { success: false };
    }
    return { success: true, data: { publicId, moderation, previousModeration, mediaUpdated } };
  },
};

export const resolutionResultSchema: PayloadSchema<{
  publicId: string;
  status: string;
  previousStatus: string;
  outcome: 'verified' | 'disputed' | 'undecided';
  conflicts: { code: string; detail: string }[];
}> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.conflicts)) {
      return { success: false };
    }
    const publicId = readText(value.publicId, 40);
    const status = readText(value.status, 40);
    const previousStatus = readText(value.previousStatus, 40);
    const outcome = pick(['verified', 'disputed', 'undecided'] as const, value.outcome);
    if (publicId === null || status === null || previousStatus === null || outcome === null) {
      return { success: false };
    }
    const conflicts: { code: string; detail: string }[] = [];
    for (const entry of value.conflicts) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const code = readText(entry.code, 60);
      const detail = readText(entry.detail, 300);
      if (code === null || detail === null) {
        return { success: false };
      }
      conflicts.push({ code, detail });
    }
    return { success: true, data: { publicId, status, previousStatus, outcome, conflicts } };
  },
};

export const countResultSchema: PayloadSchema<{ count: number }> = {
  safeParse(value: unknown) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const count = readNumber(value.count);
    if (count === null || count < 0) {
      return { success: false };
    }
    return { success: true, data: { count } };
  },
};
