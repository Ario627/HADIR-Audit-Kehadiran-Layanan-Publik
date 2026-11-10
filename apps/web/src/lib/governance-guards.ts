import type {
  AppealView,
  CitySlaOverrideView,
  Commitment,
  HolidayView,
  InstitutionScorecard,
  InstitutionScorecardList,
  PanelCandidates,
  PanelView,
  SlaBreachItem,
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
const SCORECARD_STATES = ['insufficient', 'provisional', 'published'] as const;
const BANDS = ['very_low', 'low', 'moderate', 'high'] as const;
const PANEL_ROLES = ['observer', 'verifier'] as const;
const PANEL_STATUSES = ['invited', 'active', 'declined', 'revoked'] as const;
const COMMITMENT_STATUSES = ['draft', 'verified', 'superseded', 'revoked'] as const;
const COMMITMENT_KINDS = ['headway', 'span', 'reliability', 'other'] as const;
const DAY_SCOPES = ['all', 'weekday', 'weekend', 'holiday'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
const SLA_PHASES = ['acknowledge', 'respond', 'resolve'] as const;
const REFUSALS = [
  'self',
  'different_city',
  'already_active',
  'revoked_recently',
  'unknown_city',
] as const;

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
  const decisionDue = readIsoDateTime(value.decisionDue);
  const decisionLabel = readText(value.decisionLabel, 80);
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
    decisionDue === null ||
    decisionLabel === null ||
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
    decisionDue,
    decisionOverdue: value.decisionOverdue === true,
    decisionLabel,
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
  const claimantInstitutionId = readNullableId(value.claimantInstitutionId, 64);
  const claimantInstitutionName = readText(value.claimantInstitutionName, 160);
  const summary = readText(value.summary, 300);
  if (
    publicId === null ||
    cityId === null ||
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

function readNullableId(value: unknown, max: number): string | null {
  return value === null ? null : (readText(value, max) ?? null);
}

function readAnchorDate(value: unknown): string | null {
  const text = readText(value, 10);
  return text !== null && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(text) ? text : null;
}

function readItems(value: unknown, max: number): unknown[] | null {
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > max) {
    return null;
  }
  return value.items;
}

export const slaBreachListSchema: PayloadSchema<SlaBreachItem[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 200);
    if (rows === null) {
      return { success: false };
    }
    const items: SlaBreachItem[] = [];
    for (const entry of rows) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const publicId = readText(entry.publicId, 40);
      const category = readText(entry.category, 40);
      const status = readText(entry.status, 40);
      const priority = pick(PRIORITIES, entry.priority);
      const phase = pick(SLA_PHASES, entry.phase);
      const dueAt = readIsoDateTime(entry.dueAt);
      const hoursLate = readNumber(entry.hoursLate);
      const escalation = readCount(entry.escalation, 3);
      if (
        publicId === null ||
        category === null ||
        status === null ||
        priority === null ||
        phase === null ||
        dueAt === null ||
        hoursLate === null ||
        escalation === null
      ) {
        return { success: false };
      }
      items.push({
        publicId,
        category,
        status,
        institutionName: readNullableText(entry.institutionName, 160) ?? null,
        priority,
        phase,
        dueAt,
        hoursLate,
        escalation,
      });
    }
    return { success: true, data: items };
  },
};

export const citySlaSchema: PayloadSchema<CitySlaOverrideView> = {
  safeParse(value: unknown) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const cityId = readText(value.cityId, 64);
    const cityName = readText(value.cityName, 120);
    const priority = pick(PRIORITIES, value.priority);
    const acknowledgeHours = readNumber(value.acknowledgeHours);
    const respondHours = readNumber(value.respondHours);
    const resolveHours = readNumber(value.resolveHours);
    const sourceUrl = readText(value.sourceUrl, 500);
    if (
      cityId === null ||
      cityName === null ||
      priority === null ||
      acknowledgeHours === null ||
      respondHours === null ||
      resolveHours === null ||
      sourceUrl === null
    ) {
      return { success: false };
    }
    return {
      success: true,
      data: {
        cityId,
        cityName,
        priority,
        acknowledgeHours,
        respondHours,
        resolveHours,
        sourceUrl,
        note: readNullableText(value.note, 500) ?? null,
      },
    };
  },
};

export const citySlaListSchema: PayloadSchema<CitySlaOverrideView[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 20);
    if (rows === null) {
      return { success: false };
    }
    const items: CitySlaOverrideView[] = [];
    for (const entry of rows) {
      const parsed = citySlaSchema.safeParse(entry);
      if (!parsed.success) {
        return { success: false };
      }
      items.push(parsed.data);
    }
    return { success: true, data: items };
  },
};

function toCommitment(value: unknown): Commitment | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const institutionName = readText(value.institutionName, 160);
  const sourceDocumentUrl = readText(value.sourceDocumentUrl, 500);
  const status = pick(COMMITMENT_STATUSES, value.status);
  const kind = pick(COMMITMENT_KINDS, value.kind);
  const dayScope = pick(DAY_SCOPES, value.dayScope);
  const validFrom = readAnchorDate(value.validFrom);
  if (
    id === null ||
    institutionName === null ||
    sourceDocumentUrl === null ||
    status === null ||
    kind === null ||
    dayScope === null ||
    validFrom === null
  ) {
    return null;
  }
  return {
    id,
    routeId: readNullableId(value.routeId, 64),
    stopId: readNullableId(value.stopId, 64),
    kind,
    dayScope,
    headwayMin: readNumber(value.headwayMin),
    spanStart: readNullableText(value.spanStart, 16) ?? null,
    spanEnd: readNullableText(value.spanEnd, 16) ?? null,
    sourceDocumentUrl,
    sourceDocumentTitle: readNullableText(value.sourceDocumentTitle, 200) ?? null,
    sourceDocumentVersion: readNullableText(value.sourceDocumentVersion, 80) ?? null,
    validFrom,
    validUntil: readAnchorDate(value.validUntil),
    status,
    verifiedAt: entry2Iso(value.verifiedAt),
    institutionName,
  };
}

function entry2Iso(value: unknown): string | null {
  return value === null ? null : readIsoDateTime(value);
}

export const commitmentSchema: PayloadSchema<Commitment> = {
  safeParse(value: unknown) {
    const parsed = toCommitment(value);
    return parsed === null ? { success: false } : { success: true, data: parsed };
  },
};

export const commitmentListSchema: PayloadSchema<Commitment[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 100);
    if (rows === null) {
      return { success: false };
    }
    const items: Commitment[] = [];
    for (const entry of rows) {
      const parsed = toCommitment(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    return { success: true, data: items };
  },
};

function toHoliday(value: unknown): HolidayView | null {
  if (!isRecord(value)) {
    return null;
  }
  const date = readAnchorDate(value.date);
  const name = readText(value.name, 120);
  const scope = value.scope === 'national' || value.scope === 'city' ? value.scope : null;
  const sourceUrl = readText(value.sourceUrl, 500);
  if (date === null || name === null || scope === null || sourceUrl === null) {
    return null;
  }
  return { date, name, scope, cityId: readNullableId(value.cityId, 64), sourceUrl };
}

export const holidaySchema: PayloadSchema<HolidayView> = {
  safeParse(value: unknown) {
    const parsed = toHoliday(value);
    return parsed === null ? { success: false } : { success: true, data: parsed };
  },
};

export const holidayListSchema: PayloadSchema<HolidayView[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 400);
    if (rows === null) {
      return { success: false };
    }
    const items: HolidayView[] = [];
    for (const entry of rows) {
      const parsed = toHoliday(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    return { success: true, data: items };
  },
};

export const panelCandidatesSchema: PayloadSchema<PanelCandidates> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.candidates) || value.candidates.length > 100) {
      return { success: false };
    }
    const publicId = readText(value.publicId, 40);
    if (publicId === null) {
      return { success: false };
    }
    const candidates: PanelCandidates['candidates'] = [];
    for (const entry of value.candidates) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const institutionId = readText(entry.institutionId, 64);
      const displayName = readText(entry.displayName, 160);
      const role = pick(PANEL_ROLES, entry.role);
      const reason = readText(entry.reason, 300);
      if (institutionId === null || displayName === null || role === null || reason === null) {
        return { success: false };
      }
      const refusal = entry.refusal === null ? null : pick(REFUSALS, entry.refusal);
      if (entry.refusal !== null && refusal === null) {
        return { success: false };
      }
      candidates.push({
        institutionId,
        displayName,
        eligible: entry.eligible === true,
        role,
        refusal,
        reason,
      });
    }
    return {
      success: true,
      data: { publicId, cityId: readNullableId(value.cityId, 64), candidates },
    };
  },
};

export interface CommitmentChangeView {
  validFrom: string;
  validUntil: string | null;
  headwayMin: number | null;
  sourceDocumentUrl: string;
  sourceDocumentVersion: string | null;
  supersededBy: string | null;
  days: number | null;
}

export const commitmentHistorySchema: PayloadSchema<CommitmentChangeView[]> = {
  safeParse(value: unknown) {
    const rows = readItems(value, 50);
    if (rows === null) {
      return { success: false };
    }
    const items: CommitmentChangeView[] = [];
    for (const entry of rows) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const validFrom = readAnchorDate(entry.validFrom);
      const sourceDocumentUrl = readText(entry.sourceDocumentUrl, 500);
      if (validFrom === null || sourceDocumentUrl === null) {
        return { success: false };
      }
      items.push({
        validFrom,
        validUntil: readAnchorDate(entry.validUntil),
        headwayMin: readNumber(entry.headwayMin),
        sourceDocumentUrl,
        sourceDocumentVersion: readNullableText(entry.sourceDocumentVersion, 80) ?? null,
        supersededBy: readNullableId(entry.supersededBy, 64),
        days: readCount(entry.days, 100_000),
      });
    }
    return { success: true, data: items };
  },
};
