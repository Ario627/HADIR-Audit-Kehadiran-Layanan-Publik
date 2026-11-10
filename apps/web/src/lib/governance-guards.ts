import type {
  AppealView,
  InstitutionScorecard,
  InstitutionScorecardList,
  PanelView,
  ResponseAttestation,
} from '@hadir/contracts';
import type { PayloadSchema } from './api';
import {
  isRecord,
  readCount,
  readIsoDateTime,
  readNullableText,
  readNumber,
  readText,
} from './guards';

const APPEAL_GROUNDS = ['rejection', 'resolution', 'moderation', 'service'] as const;
const APPEAL_STATUSES = [
  'submitted',
  'inadmissible',
  'admitted',
  'upheld',
  'overturned',
] as const;
const ATTESTATION_STATUSES = [
  'unsigned',
  'verified',
  'signature_mismatch',
  'unsupported_algorithm',
  'payload_mismatch',
  'structural_invalid',
] as const;
const SCORECARD_STATES = ['insufficient', 'provisional', 'published'] as const;
const BANDS = ['very_low', 'low', 'moderate', 'high'] as const;
const PANEL_ROLES = ['observer', 'verifier'] as const;
const PANEL_STATUSES = ['invited', 'active', 'declined', 'revoked'] as const;

function pick<T extends string>(
  allowed: readonly T[],
  value: unknown,
): T | null {
  return allowed.some((entry) => entry === value) ? (value as T) : null;
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

function toAttestation(value: unknown): ResponseAttestation | null {
  if (!isRecord(value)) {
    return null;
  }
  const status = pick(ATTESTATION_STATUSES, value.status);
  const message = readText(value.message, 400);
  if (status === null || message === null) {
    return null;
  }
  return {
    signed: value.signed === true,
    status,
    bodyDigest: readNullableText(value.bodyDigest, 64) ?? null,
    signingKeyId: readNullableText(value.signingKeyId, 64) ?? null,
    keyFingerprint: readNullableText(value.keyFingerprint, 20) ?? null,
    algorithm: readNullableText(value.algorithm, 40) ?? null,
    signedAt: readIsoDateTime(value.signedAt),
    message,
  };
}

export function toAppealView(value: unknown): AppealView | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const publicId = readText(value.publicId, 40);
  const grounds = pick(APPEAL_GROUNDS, value.grounds);
  const groundsLabel = readText(value.groundsLabel, 80);
  const status = pick(APPEAL_STATUSES, value.status);
  const statement = readText(value.statement, 2000);
  const evidenceUrls = readStringList(value.evidenceUrls, 500, 5);
  const windowDeadline = readIsoDateTime(value.windowDeadline);
  const createdAt = readIsoDateTime(value.createdAt);
  const summary = readText(value.summary, 300);
  if (
    id === null ||
    publicId === null ||
    grounds === null ||
    groundsLabel === null ||
    status === null ||
    statement === null ||
    evidenceUrls === null ||
    windowDeadline === null ||
    createdAt === null ||
    summary === null
  ) {
    return null;
  }
  return {
    id,
    publicId,
    grounds,
    groundsLabel,
    status,
    statement,
    evidenceUrls,
    decisionNote: readNullableText(value.decisionNote, 1000) ?? null,
    outcomeTransition: readNullableText(value.outcomeTransition, 40) ?? null,
    decidedAt: readIsoDateTime(value.decidedAt),
    windowDeadline,
    windowOpen: value.windowOpen === true,
    createdAt,
    summary,
  };
}

export const appealListSchema: PayloadSchema<AppealView[]> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.items)) {
      return { success: false };
    }
    const items: AppealView[] = [];
    for (const entry of value.items) {
      const parsed = toAppealView(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    return { success: true, data: items };
  },
};

export const appealSchema: PayloadSchema<AppealView> = {
  safeParse(value: unknown) {
    const parsed = toAppealView(value);
    return parsed === null ? { success: false } : { success: true, data: parsed };
  },
};

export function toPanelView(value: unknown): PanelView | null {
  if (!isRecord(value)) {
    return null;
  }
  const publicId = readText(value.publicId, 40);
  const cityId = readText(value.cityId, 64);
  const claimantInstitutionId = readText(value.claimantInstitutionId, 64);
  const claimantInstitutionName = readText(value.claimantInstitutionName, 160);
  const summary = readText(value.summary, 300);
  if (
    publicId === null ||
    cityId === null ||
    claimantInstitutionId === null ||
    claimantInstitutionName === null ||
    summary === null
  ) {
    return null;
  }
  if (!isRecord(value.quorum) || !Array.isArray(value.grants)) {
    return null;
  }
  const required = readCount(value.quorum.required, 100);
  const present = readCount(value.quorum.present, 100);
  const missing = readCount(value.quorum.missing, 100);
  if (required === null || present === null || missing === null) {
    return null;
  }
  const grants: PanelView['grants'] = [];
  for (const entry of value.grants) {
    if (!isRecord(entry)) {
      return null;
    }
    const id = readText(entry.id, 64);
    const institutionId = readText(entry.institutionId, 64);
    const institutionName = readText(entry.institutionName, 160);
    const role = pick(PANEL_ROLES, entry.role);
    const status = pick(PANEL_STATUSES, entry.status);
    const createdAt = readIsoDateTime(entry.createdAt);
    if (
      id === null ||
      institutionId === null ||
      institutionName === null ||
      role === null ||
      status === null ||
      createdAt === null
    ) {
      return null;
    }
    grants.push({
      id,
      institutionId,
      institutionName,
      role,
      status,
      isOwnInstitution: entry.isOwnInstitution === true,
      createdAt,
      decidedAt: readIsoDateTime(entry.decidedAt),
      revokedAt: readIsoDateTime(entry.revokedAt),
    });
  }
  const strength = pick(['weak', 'adequate', 'strong'], value.strength);
  if (strength === null) {
    return null;
  }
  const caveats = readStringList(value.caveats, 300, 10);
  if (caveats === null) {
    return null;
  }
  return {
    publicId,
    cityId,
    claimantInstitutionId,
    claimantInstitutionName,
    grants,
    quorum: { required, present, missing, met: value.quorum.met === true },
    strength,
    canVerify: value.canVerify === true,
    caveats,
    summary,
  };
}

export const panelSchema: PayloadSchema<PanelView> = {
  safeParse(value: unknown) {
    const parsed = toPanelView(value);
    return parsed === null ? { success: false } : { success: true, data: parsed };
  },
};

function toDimension(value: unknown): InstitutionScorecard['dimensions'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const dimension = pick(
    ['responsiveness', 'timeliness', 'resolutionIntegrity', 'appealFairness'],
    value.dimension,
  );
  const band = pick(BANDS, value.band);
  const label = readText(value.label, 120);
  const numerator = readCount(value.numerator, 100_000);
  const denominator = readCount(value.denominator, 100_000);
  if (
    dimension === null ||
    band === null ||
    label === null ||
    numerator === null ||
    denominator === null
  ) {
    return null;
  }
  const raw = value.value;
  const score = raw === null ? null : readNumber(raw);
  if (raw !== null && score === null) {
    return null;
  }
  return {
    dimension,
    value: score === null ? null : Math.min(1, Math.max(0, score)),
    band,
    numerator,
    denominator,
    label,
  };
}

export function toScorecard(value: unknown): InstitutionScorecard | null {
  if (!isRecord(value)) {
    return null;
  }
  const institutionId = readText(value.institutionId, 64);
  const institutionName = readText(value.institutionName, 160);
  const state = pick(SCORECARD_STATES, value.state);
  const band = pick(BANDS, value.band);
  const summary = readText(value.summary, 400);
  const windowDays = readCount(value.windowDays, 365);
  if (
    institutionId === null ||
    institutionName === null ||
    state === null ||
    band === null ||
    summary === null ||
    windowDays === null
  ) {
    return null;
  }
  if (!Array.isArray(value.dimensions) || value.dimensions.length !== 4) {
    return null;
  }
  const dimensions: InstitutionScorecard['dimensions'][number][] = [];
  for (const entry of value.dimensions) {
    const parsed = toDimension(entry);
    if (parsed === null) {
      return null;
    }
    dimensions.push(parsed);
  }
  if (!isRecord(value.sample)) {
    return null;
  }
  const reportsReceived = readCount(value.sample.reportsReceived, 1_000_000);
  const slaTracked = readCount(value.sample.slaTracked, 1_000_000);
  const appealsDecided = readCount(value.sample.appealsDecided, 1_000_000);
  if (reportsReceived === null || slaTracked === null || appealsDecided === null) {
    return null;
  }
  const warnings = readStringList(value.warnings, 300, 10);
  const caveats = readStringList(value.caveats, 400, 10);
  if (warnings === null || caveats === null) {
    return null;
  }
  const rawOverall = value.overall;
  const overall = rawOverall === null ? null : readNumber(rawOverall);
  if (rawOverall !== null && overall === null) {
    return null;
  }
  const rankRaw = value.rank;
  const rank = rankRaw === null ? null : readCount(rankRaw, 1000);
  if (rankRaw !== null && rank === null) {
    return null;
  }
  return {
    institutionId,
    institutionName,
    cityId: readNullableText(value.cityId, 64) ?? null,
    cityName: readNullableText(value.cityName, 120) ?? null,
    windowDays,
    state,
    overall: overall === null ? null : Math.min(1, Math.max(0, overall)),
    band,
    rank,
    dimensions: dimensions as InstitutionScorecard['dimensions'],
    sample: { reportsReceived, slaTracked, appealsDecided },
    warnings,
    summary,
    caveats,
  };
}

export const scorecardSchema: PayloadSchema<InstitutionScorecard> = {
  safeParse(value: unknown) {
    const parsed = toScorecard(value);
    return parsed === null ? { success: false } : { success: true, data: parsed };
  },
};

export const scorecardListSchema: PayloadSchema<InstitutionScorecardList> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.items)) {
      return { success: false };
    }
    const items: InstitutionScorecard[] = [];
    for (const entry of value.items) {
      const parsed = toScorecard(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    const generatedAt = readIsoDateTime(value.generatedAt);
    const caveats = readStringList(value.caveats, 400, 10);
    if (generatedAt === null || caveats === null) {
      return { success: false };
    }
    return {
      success: true,
      data: {
        items,
        cityId: readNullableText(value.cityId, 64) ?? null,
        generatedAt,
        caveats,
      },
    };
  },
};
