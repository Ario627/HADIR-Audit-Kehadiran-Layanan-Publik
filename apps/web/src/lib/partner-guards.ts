import type {
  AnalyticsBucket,
  PartnerActionResult,
  PartnerAnalytics,
  PartnerProfile,
  PartnerReportDetail,
  ReportListItem,
  ReportStatus,
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
  toReportDetail,
  toReportListItem,
} from './guards';

export interface PartnerInbox {
  items: ReportListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface OtpIssue {
  expiresInSeconds: number;
  resendInSeconds: number;
}

const MAX_MEDIA = 9;
const ROLES = new Set(['viewer', 'responder', 'admin']);
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MEDIA_STATUSES = new Set(['pending', 'approved', 'rejected']);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

function toProfile(value: unknown): PartnerProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const userId = readText(value.userId, 36);
  const displayName = readText(value.displayName, 120);
  const institutionId = readText(value.institutionId, 36);
  const institutionName = readText(value.institutionName, 160);
  const expiresAt = readIsoDateTime(value.expiresAt);
  const createdAt = readIsoDateTime(value.createdAt);
  if (
    userId === null ||
    displayName === null ||
    institutionId === null ||
    institutionName === null ||
    expiresAt === null ||
    createdAt === null
  ) {
    return null;
  }
  if (typeof value.role !== 'string' || !ROLES.has(value.role)) {
    return null;
  }
  return {
    userId,
    displayName,
    institutionId,
    institutionName,
    role: value.role as PartnerProfile['role'],
    expiresAt,
    createdAt,
  };
}

function toMedia(value: unknown): PartnerReportDetail['media'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const mediaId = readText(value.mediaId, 36);
  const width = readNullableNumber(value.width);
  const height = readNullableNumber(value.height);
  const url = readNullableText(value.url, 500);
  if (mediaId === null || width === undefined || height === undefined || url === undefined) {
    return null;
  }
  if (typeof value.mime !== 'string' || !MIME_TYPES.has(value.mime)) {
    return null;
  }
  if (typeof value.status !== 'string' || !MEDIA_STATUSES.has(value.status)) {
    return null;
  }
  if (width !== null && width <= 0) {
    return null;
  }
  if (height !== null && height <= 0) {
    return null;
  }
  return {
    mediaId,
    mime: value.mime as PartnerReportDetail['media'][number]['mime'],
    width,
    height,
    status: value.status as PartnerReportDetail['media'][number]['status'],
    url,
  };
}

function toPartnerReport(value: unknown): PartnerReportDetail | null {
  const base = toReportDetail(value);
  if (base === null || !isRecord(value) || !Array.isArray(value.media)) {
    return null;
  }
  const followUpAt = readNullableText(value.followUpAt, 40);
  if (followUpAt === undefined) {
    return null;
  }
  if (followUpAt !== null && Number.isNaN(Date.parse(followUpAt))) {
    return null;
  }
  if (value.media.length > MAX_MEDIA) {
    return null;
  }
  const media: PartnerReportDetail['media'] = [];
  for (const entry of value.media) {
    const item = toMedia(entry);
    if (item === null) {
      return null;
    }
    media.push(item);
  }
  return { ...base, followUpAt, media };
}

function toInbox(value: unknown): PartnerInbox | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  if (value.items.length > 100) {
    return null;
  }
  const items: ReportListItem[] = [];
  for (const entry of value.items) {
    const item = toReportListItem(entry);
    if (item === null) {
      return null;
    }
    items.push(item);
  }
  const cursor = value.nextCursor;
  const nextCursor =
    typeof cursor === 'string' && cursor.length <= 512 && CURSOR_PATTERN.test(cursor) ? cursor : null;
  if (cursor !== null && cursor !== undefined && nextCursor === null) {
    return null;
  }
  return { items, nextCursor, hasMore: value.hasMore === true };
}

function toBucket(value: unknown): AnalyticsBucket | null {
  if (!isRecord(value)) {
    return null;
  }
  const key = readText(value.key, 40);
  if (key === null) {
    return null;
  }
  if (typeof value.suppressed !== 'boolean') {
    return null;
  }
  const count = value.count === null ? null : readCount(value.count, 10_000_000);
  if (value.count !== null && count === null) {
    return null;
  }
  return { key, count, suppressed: value.suppressed };
}

function toAnalytics(value: unknown): PartnerAnalytics | null {
  if (!isRecord(value) || !isRecord(value.window)) {
    return null;
  }
  if (!Array.isArray(value.byStatus) || !Array.isArray(value.byCategory)) {
    return null;
  }
  const start = readIsoDateTime(value.window.start);
  const end = readIsoDateTime(value.window.end);
  const days = readCount(value.window.days, 3_650);
  const generatedAt = readIsoDateTime(value.generatedAt);
  const kThreshold = readCount(value.kThreshold, 1_000);
  if (start === null || end === null || days === null || days < 1) {
    return null;
  }
  if (generatedAt === null || kThreshold === null || kThreshold < 1) {
    return null;
  }
  const totalReports = value.totalReports === null ? null : readCount(value.totalReports, 10_000_000);
  if (value.totalReports !== null && totalReports === null) {
    return null;
  }
  if (typeof value.totalSuppressed !== 'boolean') {
    return null;
  }

  const buckets = (raw: readonly unknown[]): AnalyticsBucket[] | null => {
    if (raw.length > 20) {
      return null;
    }
    const list: AnalyticsBucket[] = [];
    for (const entry of raw) {
      const bucket = toBucket(entry);
      if (bucket === null) {
        return null;
      }
      list.push(bucket);
    }
    return list;
  };

  const byStatus = buckets(value.byStatus);
  const byCategory = buckets(value.byCategory);
  if (byStatus === null || byCategory === null) {
    return null;
  }

  const rate = (raw: unknown): number | null | undefined => {
    if (raw === null) {
      return null;
    }
    const parsed = readNumber(raw);
    if (parsed === null || parsed < 0 || parsed > 1) {
      return undefined;
    }
    return parsed;
  };

  const claimedResolvedRate = rate(value.claimedResolvedRate);
  const disputedRate = rate(value.disputedRate);
  const corroborationRate = rate(value.corroborationRate);
  const medianFirstResponseHours = readNullableNumber(value.medianFirstResponseHours);
  const medianResolutionHours = readNullableNumber(value.medianResolutionHours);
  if (
    claimedResolvedRate === undefined ||
    disputedRate === undefined ||
    corroborationRate === undefined ||
    medianFirstResponseHours === undefined ||
    medianResolutionHours === undefined
  ) {
    return null;
  }

  return {
    window: { start, end, days },
    totalReports,
    totalSuppressed: value.totalSuppressed,
    byStatus,
    byCategory,
    medianFirstResponseHours,
    medianResolutionHours,
    claimedResolvedRate,
    disputedRate,
    corroborationRate,
    kThreshold,
    generatedAt,
  };
}

function toActionResult(value: unknown): PartnerActionResult | null {
  if (!isRecord(value)) {
    return null;
  }
  const publicId = readText(value.publicId, 40);
  const scheduledFor = readNullableText(value.scheduledFor, 40);
  if (publicId === null || publicId.length < 6 || scheduledFor === undefined) {
    return null;
  }
  if (scheduledFor !== null && Number.isNaN(Date.parse(scheduledFor))) {
    return null;
  }
  if (typeof value.simulated !== 'boolean') {
    return null;
  }
  const status = value.status;
  const previousStatus = value.previousStatus;
  if (typeof status !== 'string' || typeof previousStatus !== 'string') {
    return null;
  }
  return {
    publicId,
    status: status as ReportStatus,
    previousStatus: previousStatus as ReportStatus,
    scheduledFor,
    simulated: value.simulated,
  };
}

function toOtpIssue(value: unknown): OtpIssue | null {
  if (!isRecord(value)) {
    return null;
  }
  const expiresInSeconds = readCount(value.expiresInSeconds, 86_400);
  const resendInSeconds = readCount(value.resendInSeconds, 86_400);
  if (expiresInSeconds === null || resendInSeconds === null) {
    return null;
  }
  if (expiresInSeconds < 30 || resendInSeconds < 1) {
    return null;
  }
  return { expiresInSeconds, resendInSeconds };
}

export const partnerProfileSchema: PayloadSchema<PartnerProfile> = {
  safeParse(value) {
    const profile = toProfile(value);
    return profile === null ? { success: false } : { success: true, data: profile };
  },
};

export const partnerInboxSchema: PayloadSchema<PartnerInbox> = {
  safeParse(value) {
    const inbox = toInbox(value);
    return inbox === null ? { success: false } : { success: true, data: inbox };
  },
};

export const partnerReportSchema: PayloadSchema<PartnerReportDetail> = {
  safeParse(value) {
    const report = toPartnerReport(value);
    return report === null ? { success: false } : { success: true, data: report };
  },
};

export const partnerAnalyticsSchema: PayloadSchema<PartnerAnalytics> = {
  safeParse(value) {
    const analytics = toAnalytics(value);
    return analytics === null ? { success: false } : { success: true, data: analytics };
  },
};

export const partnerActionResultSchema: PayloadSchema<PartnerActionResult> = {
  safeParse(value) {
    const result = toActionResult(value);
    return result === null ? { success: false } : { success: true, data: result };
  },
};

export const partnerOtpIssueSchema: PayloadSchema<OtpIssue> = {
  safeParse(value) {
    const issue = toOtpIssue(value);
    return issue === null ? { success: false } : { success: true, data: issue };
  },
};

export interface PartnerPasskey {
  id: string;
  deviceType: string | null;
  lastUsedAt: string | null;
}

export interface PartnerSessionInfo {
  createdAt: string;
}

export interface PasskeyChallenge {
  challengeId: string;
  options: Record<string, unknown>;
}

const MAX_PASSKEYS = 20;
const DEVICE_TYPES = new Set(['singleDevice', 'multiDevice']);
const BASE64URL = /^[A-Za-z0-9_-]{8,512}={0,2}$/;
const MAX_OPTIONS_KEYS = 40;

function toPasskey(value: unknown): PartnerPasskey | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 36);
  if (id === null) {
    return null;
  }
  const deviceType = readNullableText(value.deviceType, 40);
  const lastUsedAt = readNullableText(value.lastUsedAt, 40);
  if (deviceType === undefined || lastUsedAt === undefined) {
    return null;
  }
  if (deviceType !== null && !DEVICE_TYPES.has(deviceType)) {
    return null;
  }
  if (lastUsedAt !== null && Number.isNaN(Date.parse(lastUsedAt))) {
    return null;
  }
  return { id, deviceType, lastUsedAt };
}

function toPasskeyList(value: unknown): PartnerPasskey[] | null {
  if (!isRecord(value) || !Array.isArray(value.passkeys)) {
    return null;
  }
  if (value.passkeys.length > MAX_PASSKEYS) {
    return null;
  }
  const list: PartnerPasskey[] = [];
  for (const entry of value.passkeys) {
    const item = toPasskey(entry);
    if (item === null) {
      return null;
    }
    list.push(item);
  }
  return list;
}

function toChallenge(value: unknown): PasskeyChallenge | null {
  if (!isRecord(value)) {
    return null;
  }
  const challengeId = readText(value.challengeId, 64);
  if (challengeId === null) {
    return null;
  }
  const options = value.options;
  if (!isRecord(options)) {
    return null;
  }
  const keys = Object.keys(options);
  if (keys.length === 0 || keys.length > MAX_OPTIONS_KEYS) {
    return null;
  }
  const challenge = options.challenge;
  if (typeof challenge !== 'string' || !BASE64URL.test(challenge)) {
    return null;
  }
  const rp = options.rp;
  if (!isRecord(rp) || typeof rp.id !== 'string' || rp.id.length === 0) {
    return null;
  }
  return { challengeId, options };
}

export const partnerPasskeyListSchema: PayloadSchema<PartnerPasskey[]> = {
  safeParse(value) {
    const list = toPasskeyList(value);
    return list === null ? { success: false } : { success: true, data: list };
  },
};

export const passkeyChallengeSchema: PayloadSchema<PasskeyChallenge> = {
  safeParse(value) {
    const challenge = toChallenge(value);
    return challenge === null ? { success: false } : { success: true, data: challenge };
  },
};

export const partnerSessionInfoSchema: PayloadSchema<PartnerSessionInfo> = {
  safeParse(value) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const createdAt = readIsoDateTime(value.createdAt);
    return createdAt === null
      ? { success: false }
      : { success: true, data: { createdAt } };
  },
};

export const passkeyRegisteredSchema: PayloadSchema<{ registered: boolean }> = {
  safeParse(value) {
    return isRecord(value) && value.registered === true
      ? { success: true, data: { registered: true } }
      : { success: false };
  },
};

export const passwordChangedSchema: PayloadSchema<{
  changed: boolean;
  revokedSessions: number;
}> = {
  safeParse(value) {
    if (!isRecord(value) || value.changed !== true) {
      return { success: false };
    }
    const revokedSessions = readCount(value.revokedSessions, 10_000);
    return revokedSessions === null
      ? { success: false }
      : { success: true, data: { changed: true, revokedSessions } };
  },
};

export const sessionsRevokedSchema: PayloadSchema<{ revoked: number }> = {
  safeParse(value) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const revoked = readCount(value.revoked, 10_000);
    return revoked === null ? { success: false } : { success: true, data: { revoked } };
  },
};