import type { CaseFile, EvidencePack } from '@hadir/contracts';
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

const BANDS = ['very_low', 'low', 'moderate', 'high'] as const;
const DIMENSIONS = ['strength', 'precision', 'coverage', 'reliability', 'corroboration'] as const;
const IMPACTS = ['none', 'minor', 'major', 'service_stopped'] as const;
const BENCHMARK_REASONS = [
  'no_commitment',
  'not_verified',
  'outside_validity',
  'scope_mismatch',
  'missing_headway',
] as const;
const MILESTONES = [
  'submitted',
  'triaged',
  'acknowledged',
  'scheduled',
  'responded',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
  'rejected',
] as const;
const SLA_PHASES = ['acknowledge', 'respond', 'resolve'] as const;
const SLA_STATES = ['not_started', 'pending', 'met', 'overdue', 'met_late'] as const;
const RESPONSE_KINDS = ['initial', 'follow_up', 'closure_claim', 'correction'] as const;
const VERDICTS = ['confirmed', 'refuted', 'inconclusive'] as const;
const METHODS = ['citizen_confirmation', 'field_inspection', 'observation_data', 'panel_review'] as const;
const VERIFIER_KINDS = ['citizen', 'independent_institution', 'platform', 'automatic'] as const;
const OUTCOMES = ['verified', 'disputed', 'undecided'] as const;
const ATTESTATION_STATUSES = [
  'unsigned',
  'verified',
  'signature_mismatch',
  'unsupported_algorithm',
  'payload_mismatch',
  'structural_invalid',
] as const;

function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return allowed.some((entry) => entry === value) ? (value as T) : null;
}

function readUnit(value: unknown): number | null {
  const parsed = readNumber(value);
  if (parsed === null || parsed < 0 || parsed > 1) {
    return null;
  }
  return parsed;
}

function readStringList(value: unknown, maxLength: number, limit: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) {
    return null;
  }
  const out: string[] = [];
  for (const entry of value) {
    const text = readText(entry, maxLength);
    if (text === null) {
      return null;
    }
    out.push(text);
  }
  return out;
}

function readUrlList(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) {
    return null;
  }
  const out: string[] = [];
  for (const entry of value) {
    const text = readText(entry, 500);
    if (text === null) {
      return null;
    }
    out.push(text);
  }
  return out;
}

function readBenchmark(value: unknown): EvidencePack['benchmark'] | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.status === 'unavailable') {
    const reason = pick(BENCHMARK_REASONS, value.reason);
    const message = readText(value.message, 500);
    const considered = readCount(value.considered, 10_000);
    return reason === null || message === null || considered === null
      ? null
      : { status: 'unavailable', reason, message, considered };
  }
  if (value.status !== 'resolved') {
    return null;
  }
  const commitmentId = readText(value.commitmentId, 64);
  const specificity = pick(['stop', 'route'] as const, value.specificity);
  const headwayMin = readNumber(value.headwayMin);
  const idealWaitMin = readNumber(value.idealWaitMin);
  const thresholdMin = readNumber(value.thresholdMin);
  const sourceDocumentUrl = readText(value.sourceDocumentUrl, 500);
  const validFrom = readText(value.validFrom, 32);
  const message = readText(value.message, 500);
  if (
    commitmentId === null ||
    specificity === null ||
    headwayMin === null ||
    idealWaitMin === null ||
    thresholdMin === null ||
    sourceDocumentUrl === null ||
    validFrom === null ||
    message === null
  ) {
    return null;
  }
  return {
    status: 'resolved',
    commitmentId,
    specificity,
    headwayMin,
    idealWaitMin,
    thresholdMin,
    sourceDocumentUrl,
    sourceDocumentVersion: readNullableText(value.sourceDocumentVersion, 80) ?? null,
    validFrom,
    validUntil: readNullableText(value.validUntil, 32) ?? null,
    message,
  };
}

function readQuality(value: unknown): EvidencePack['quality'] | null {
  if (!isRecord(value) || !Array.isArray(value.dimensions) || value.dimensions.length !== 5) {
    return null;
  }
  const dimensions: EvidencePack['quality']['dimensions'][number][] = [];
  for (const entry of value.dimensions) {
    if (!isRecord(entry)) {
      return null;
    }
    const dimension = pick(DIMENSIONS, entry.dimension);
    const score = readUnit(entry.score);
    const band = pick(BANDS, entry.band);
    const reasons = readStringList(entry.reasons, 60, 10);
    if (dimension === null || score === null || band === null || reasons === null) {
      return null;
    }
    dimensions.push({ dimension, score, band, reasons });
  }
  const limiting = pick(DIMENSIONS, value.limiting);
  const band = pick(BANDS, value.band);
  const score = readUnit(value.score);
  const warnings = readStringList(value.warnings, 60, 10);
  if (limiting === null || band === null || score === null || warnings === null) {
    return null;
  }
  return {
    dimensions: dimensions as unknown as EvidencePack['quality']['dimensions'],
    limiting,
    band,
    score,
    fieldVerifiedEligible: value.fieldVerifiedEligible === true,
    warnings,
  };
}

function readRepresentativeness(value: unknown): EvidencePack['representativeness'] | null {
  if (!isRecord(value) || !Array.isArray(value.warnings)) {
    return null;
  }
  const score = readUnit(value.score);
  const band = pick(BANDS, value.band);
  if (score === null || band === null || value.warnings.length > 20) {
    return null;
  }
  const warnings: { code: string; detail: string }[] = [];
  for (const entry of value.warnings) {
    if (!isRecord(entry)) {
      return null;
    }
    const code = readText(entry.code, 60);
    const detail = readText(entry.detail, 300);
    if (code === null || detail === null) {
      return null;
    }
    warnings.push({ code, detail });
  }
  return {
    score,
    band,
    limitedTo: readNullableText(value.limitedTo, 200) ?? null,
    warnings,
  };
}

function readContextEvent(value: unknown): EvidencePack['context']['events'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const kind = readText(value.kind, 40);
  const impact = pick(IMPACTS, value.impact);
  const text = readText(value.text, 1000);
  const sourceUrl = readText(value.sourceUrl, 500);
  if (id === null || kind === null || impact === null || text === null || sourceUrl === null) {
    return null;
  }
  return {
    id,
    kind,
    impact,
    text,
    sourceUrl,
    startsAt: readIsoDateTime(value.startsAt),
    endsAt: readIsoDateTime(value.endsAt),
    stopId: readNullableText(value.stopId, 64) ?? null,
    routeId: readNullableText(value.routeId, 64) ?? null,
    acknowledgedAt: readIsoDateTime(value.acknowledgedAt),
    institutionName: readNullableText(value.institutionName, 160) ?? null,
  };
}

function readContext(value: unknown): EvidencePack['context'] | null {
  if (!isRecord(value) || !Array.isArray(value.events) || !Array.isArray(value.segments)) {
    return null;
  }
  if (value.events.length > 100 || value.segments.length > 100) {
    return null;
  }
  const events: EvidencePack['context']['events'][number][] = [];
  for (const entry of value.events) {
    const parsed = readContextEvent(entry);
    if (parsed === null) {
      return null;
    }
    events.push(parsed);
  }
  const segments: EvidencePack['context']['segments'][number][] = [];
  for (const entry of value.segments) {
    if (!isRecord(entry)) {
      return null;
    }
    const start = readIsoDateTime(entry.start);
    const end = readIsoDateTime(entry.end);
    const impact = pick(IMPACTS, entry.impact);
    const eventIds = readStringList(entry.eventIds, 64, 20);
    if (start === null || end === null || impact === null || eventIds === null) {
      return null;
    }
    segments.push({ start, end, impact, eventIds });
  }
  const caveats = readStringList(value.caveats, 400, 10);
  if (caveats === null) {
    return null;
  }
  return {
    events,
    segments,
    dominantImpact: pick(IMPACTS, value.dominantImpact) ?? null,
    caveats,
  };
}

function readSnapshot(value: unknown): EvidencePack['snapshot'] | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const subjectKind = readText(value.subjectKind, 40);
  const subjectRef = readText(value.subjectRef, 80);
  const methodVersion = readText(value.methodVersion, 40);
  const datasetDigest = readText(value.datasetDigest, 128);
  const outputDigest = readText(value.outputDigest, 128);
  const computedAt = readIsoDateTime(value.computedAt);
  const evidenceLevel = pick(
    ['none', 'indication', 'strong', 'field_verified'] as const,
    value.evidenceLevel,
  );
  const direction = pick(['excess', 'no_excess', 'inconclusive'] as const, value.direction);
  const inputRows = readCount(value.inputRows, 1_000_000);
  const warnings = readStringList(value.warnings, 80, 20);
  if (
    id === null ||
    subjectKind === null ||
    subjectRef === null ||
    methodVersion === null ||
    datasetDigest === null ||
    outputDigest === null ||
    computedAt === null ||
    evidenceLevel === null ||
    direction === null ||
    inputRows === null ||
    warnings === null
  ) {
    return null;
  }
  return {
    id,
    subjectKind,
    subjectRef,
    methodVersion,
    datasetDigest,
    outputDigest,
    inputRows,
    evidenceLevel,
    direction,
    warnings,
    computedAt,
  };
}

export const evidencePackSchema: PayloadSchema<EvidencePack> = {
  safeParse(value: unknown) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const stopId = readText(value.stopId, 64);
    const stopCode = readText(value.stopCode, 12);
    const stopName = readText(value.stopName, 160);
    const generatedAt = readIsoDateTime(value.generatedAt);
    const dayScope = pick(['weekday', 'weekend', 'holiday'] as const, value.dayScope);
    const benchmark = readBenchmark(value.benchmark);
    const quality = readQuality(value.quality);
    const representativeness = readRepresentativeness(value.representativeness);
    const context = readContext(value.context);
    const disclaimer = readText(value.disclaimer, 600);
    if (
      stopId === null ||
      stopCode === null ||
      stopName === null ||
      generatedAt === null ||
      dayScope === null ||
      benchmark === null ||
      quality === null ||
      representativeness === null ||
      context === null ||
      disclaimer === null
    ) {
      return { success: false };
    }
    return {
      success: true,
      data: {
        stopId,
        stopCode,
        stopName,
        generatedAt,
        dayScope,
        holidayName: readNullableText(value.holidayName, 120) ?? null,
        benchmark,
        quality,
        representativeness,
        context,
        provenance: isRecord(value.provenance)
          ? (value.provenance as unknown as EvidencePack['provenance'])
          : null,
        snapshot: readSnapshot(value.snapshot),
        disclaimer,
      },
    };
  },
};

function readMilestoneEntry(value: unknown): CaseFile['milestones']['entries'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const key = pick(MILESTONES, value.key);
  const at = readIsoDateTime(value.at);
  const actorType = pick(['citizen', 'partner', 'admin', 'system'] as const, value.actorType);
  const label = readText(value.label, 80);
  if (key === null || at === null || actorType === null || label === null) {
    return null;
  }
  return { key, at, actorType, label, terminal: value.terminal === true };
}

function readMilestones(value: unknown): CaseFile['milestones'] | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return null;
  }
  const entries: CaseFile['milestones']['entries'][number][] = [];
  for (const entry of value.entries) {
    const parsed = readMilestoneEntry(entry);
    if (parsed === null) {
      return null;
    }
    entries.push(parsed);
  }
  const progress = readUnit(value.progress);
  const gaps = Array.isArray(value.gaps)
    ? value.gaps.map((entry) => pick(MILESTONES, entry)).filter((entry) => entry !== null)
    : null;
  const caveats = readStringList(value.caveats, 300, 10);
  if (progress === null || gaps === null || caveats === null) {
    return null;
  }
  return {
    entries,
    current: pick(MILESTONES, value.current) ?? null,
    next: pick(MILESTONES, value.next) ?? null,
    progress,
    terminal: pick(['resolved', 'disputed', 'rejected'] as const, value.terminal) ?? null,
    pendingInfoRequest: value.pendingInfoRequest === true,
    gaps,
    caveats,
  };
}

function readSlaPhase(value: unknown): NonNullable<CaseFile['sla']>['phases'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const phase = pick(SLA_PHASES, value.phase);
  const state = pick(SLA_STATES, value.state);
  const dueAt = readIsoDateTime(value.dueAt);
  if (phase === null || state === null || dueAt === null) {
    return null;
  }
  return {
    phase,
    dueAt,
    metAt: readIsoDateTime(value.metAt),
    state,
    lateByHours: readNullableNumber(value.lateByHours) ?? null,
    remainingHours: readNullableNumber(value.remainingHours) ?? null,
  };
}

function readSla(value: unknown): CaseFile['sla'] {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.targets) || !Array.isArray(value.phases)) {
    return null;
  }
  if (value.phases.length !== 3) {
    return null;
  }
  const phases: NonNullable<CaseFile['sla']>['phases'] = [];
  for (const entry of value.phases) {
    const parsed = readSlaPhase(entry);
    if (parsed === null) {
      return null;
    }
    phases.push(parsed);
  }
  const policyVersion = readText(value.policyVersion, 40);
  const priority = pick(['low', 'normal', 'high', 'critical'] as const, value.priority);
  const acknowledgeHours = readNumber(value.targets.acknowledgeHours);
  const respondHours = readNumber(value.targets.respondHours);
  const resolveHours = readNumber(value.targets.resolveHours);
  const escalation = readCount(value.escalation, 3);
  const summary = readText(value.summary, 300);
  if (
    policyVersion === null ||
    priority === null ||
    acknowledgeHours === null ||
    respondHours === null ||
    resolveHours === null ||
    escalation === null ||
    summary === null
  ) {
    return null;
  }
  return {
    policyVersion,
    priority,
    targets: { acknowledgeHours, respondHours, resolveHours },
    phases: phases as unknown as NonNullable<CaseFile['sla']>['phases'],
    breached: value.breached === true,
    escalation,
    summary,
  };
}

function readAttestation(value: unknown): CaseFile['responses'][number]['attestation'] {
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

function readResponse(value: unknown): CaseFile['responses'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const kind = pick(RESPONSE_KINDS, value.kind);
  const body = readText(value.body, 4000);
  const evidenceUrls = readUrlList(value.evidenceUrls, 5);
  const institutionId = readText(value.institutionId, 64);
  const institutionName = readText(value.institutionName, 160);
  const publishedAt = readIsoDateTime(value.publishedAt);
  if (
    id === null ||
    kind === null ||
    body === null ||
    evidenceUrls === null ||
    institutionId === null ||
    institutionName === null ||
    publishedAt === null
  ) {
    return null;
  }
  return {
    id,
    kind,
    body,
    evidenceUrls,
    institutionId,
    institutionName,
    authorDisplayName: readNullableText(value.authorDisplayName, 120) ?? null,
    correctsResponseId: readNullableText(value.correctsResponseId, 64) ?? null,
    publishedAt,
    attestation: readAttestation(value.attestation),
  };
}

function readVerification(value: unknown): CaseFile['verifications'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const method = pick(METHODS, value.method);
  const verdict = pick(VERDICTS, value.verdict);
  const verifierKind = pick(VERIFIER_KINDS, value.verifierKind);
  const verifierLabel = readText(value.verifierLabel, 160);
  const verifiedAt = readIsoDateTime(value.verifiedAt);
  const evidenceUrls = readUrlList(value.evidenceUrls, 5);
  if (
    id === null ||
    method === null ||
    verdict === null ||
    verifierKind === null ||
    verifierLabel === null ||
    verifiedAt === null ||
    evidenceUrls === null
  ) {
    return null;
  }
  return {
    id,
    method,
    verdict,
    verifierKind,
    verifierLabel,
    note: readNullableText(value.note, 400) ?? null,
    evidenceUrls,
    verifiedAt,
  };
}

function readResolution(value: unknown): CaseFile['resolution'] | null {
  if (!isRecord(value) || !Array.isArray(value.conflicts) || !Array.isArray(value.cautions)) {
    return null;
  }
  const outcome = pick(OUTCOMES, value.outcome);
  const reason = readText(value.reason, 400);
  const supporting = readCount(value.supporting, 1000);
  const refuting = readCount(value.refuting, 1000);
  const inconclusive = readCount(value.inconclusive, 1000);
  if (
    outcome === null ||
    reason === null ||
    supporting === null ||
    refuting === null ||
    inconclusive === null
  ) {
    return null;
  }
  const conflicts: { code: string; detail: string }[] = [];
  for (const entry of value.conflicts) {
    if (!isRecord(entry)) {
      return null;
    }
    const code = readText(entry.code, 60);
    const detail = readText(entry.detail, 300);
    if (code === null || detail === null) {
      return null;
    }
    conflicts.push({ code, detail });
  }
  const cautions = readStringList(value.cautions, 400, 10);
  if (cautions === null) {
    return null;
  }
  return { outcome, reason, supporting, refuting, inconclusive, conflicts, cautions };
}

export const caseFileSchema: PayloadSchema<CaseFile> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.responses) || !Array.isArray(value.verifications)) {
      return { success: false };
    }
    const publicId = readText(value.publicId, 40);
    const status = readText(value.status, 40);
    const category = readText(value.category, 40);
    const createdAt = readIsoDateTime(value.createdAt);
    const milestones = readMilestones(value.milestones);
    const resolution = readResolution(value.resolution);
    const caveats = readStringList(value.caveats, 400, 10);
    if (
      publicId === null ||
      status === null ||
      category === null ||
      createdAt === null ||
      milestones === null ||
      resolution === null ||
      caveats === null
    ) {
      return { success: false };
    }
    const responses: CaseFile['responses'][number][] = [];
    for (const entry of value.responses) {
      const parsed = readResponse(entry);
      if (parsed === null) {
        return { success: false };
      }
      responses.push(parsed);
    }
    const verifications: CaseFile['verifications'][number][] = [];
    for (const entry of value.verifications) {
      const parsed = readVerification(entry);
      if (parsed === null) {
        return { success: false };
      }
      verifications.push(parsed);
    }
    return {
      success: true,
      data: {
        publicId,
        status,
        category,
        createdAt,
        milestones,
        sla: readSla(value.sla),
        responses,
        verifications,
        resolution,
        caveats,
      },
    };
  },
};
