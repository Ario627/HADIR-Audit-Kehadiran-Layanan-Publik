import type {
  ClosureResult,
  CorroborateResult,
  CoveragePeriod,
  CoverageSummary,
  CoverageSummaryItem,
  CreateReportResult,
  Direction,
  Estimate,
  Methodology,
  QrLanding,
  ReportDetail,
  ReportListItem,
  RouteDetail,
  RouteStopList,
  RouteSummary,
  Runway,
  RunwayEvent,
  StopDetail,
  StopSummary,
  TriageEvidence,
  TriageResult,
  UploadTicket,
} from '@hadir/contracts';
import type { PayloadSchema } from './api';
import { isEvidenceLevel } from './evidence';
import { readPublicId } from './report';
import type { TriageActionKind } from './triage';

const MAX_TEXT = 2_048;
const MAX_WARNINGS = 20;
const MAX_RUNWAY_EVENTS = 200;
const DIRECTIONS: readonly Direction[] = ['excess', 'no_excess', 'inconclusive'];
const ROUTE_MODES = new Set(['brt', 'non_brt', 'feeder', 'other']);
const ROUTE_STATUSES = new Set(['active', 'suspended', 'stopped', 'planned']);
const STOP_STATUSES = new Set(['active', 'inactive', 'moved', 'planned']);
const RUNWAY_STATUSES = new Set(['funded', 'pending', 'stopped', 'unknown']);
const URGENCY_BANDS = new Set(['expired', 'critical', 'warning', 'watch', 'none']);
const TRIAGE_ACTIONS = new Set<string>([
  'join',
  'monitor',
  'send_elsewhere',
  'measure',
  'send_anyway',
  'open_radar',
]);
const TRIAGE_VERDICTS = new Set([
  'join',
  'already_planned',
  'wrong_authority',
  'service_not_running',
  'data_supports',
  'data_insufficient',
  'new_report',
]);
const TIERS = new Set(['T1', 'T2', 'T3', 'T4']);
const CONNECTOR_STATES = new Set(['ok', 'unavailable', 'not_configured']);
const REPORT_CATEGORIES = new Set([
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
const REPORT_STATUSES = new Set([
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
const MODERATIONS = new Set(['pending', 'approved', 'rejected', 'quarantined']);
const REPORT_ACTORS = new Set(['citizen', 'partner', 'system', 'moderator']);
const RUNWAY_EVENT_KINDS = new Set([
  'announced',
  'budget_decided',
  'funded',
  'suspended',
  'resumed',
  'stopped',
  'corrected',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > maxLength ? null : trimmed;
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readCount(value: unknown, max: number): number | null {
  const parsed = readNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0 || parsed > max) {
    return null;
  }
  return parsed;
}

export function readNullableText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) {
    return null;
  }
  const parsed = readText(value, maxLength);
  return parsed === null ? undefined : parsed;
}

export function readNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return readNumber(value) ?? undefined;
}

export function readIsoDateTime(value: unknown): string | null {
  const text = readText(value, 40);
  if (text === null || Number.isNaN(Date.parse(text))) {
    return null;
  }
  return text;
}

function readPeriod(value: unknown): CoveragePeriod | null {
  return value === '7d' || value === '30d' ? value : null;
}

function readDirection(value: unknown): Direction | null {
  return DIRECTIONS.some((direction) => direction === value) ? (value as Direction) : null;
}

function readOptionalCount(value: unknown, max: number): number | null | undefined {
  if (value === null) {
    return null;
  }
  return readCount(value, max) ?? undefined;
}

function readOptionalNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return readNumber(value) ?? undefined;
}

function toRouteSummary(value: unknown): RouteSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const code = readText(value.code, 12);
  const name = readText(value.name, 120);
  const promise = readNullableNumber(value.promisedHeadwayPeakMin);
  const source = readNullableText(value.headwaySourceUrl, MAX_TEXT);
  if (id === null || code === null || name === null) {
    return null;
  }
  if (promise === undefined || source === undefined) {
    return null;
  }
  return { id, code, name, promisedHeadwayPeakMin: promise, headwaySourceUrl: source };
}

function toStopSummary(value: unknown): StopSummary | null {
  if (!isRecord(value) || !Array.isArray(value.routes) || !isRecord(value.location)) {
    return null;
  }
  const id = readText(value.id, 64);
  const code = readText(value.code, 12);
  const name = readText(value.name, 160);
  const status = value.status;
  const isDemo = value.isDemo;
  const lat = readNumber(value.location.lat);
  const lon = readNumber(value.location.lon);
  if (id === null || code === null || name === null) {
    return null;
  }
  if (status !== 'active' && status !== 'inactive' && status !== 'moved' && status !== 'planned') {
    return null;
  }
  if (typeof isDemo !== 'boolean') {
    return null;
  }
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }
  const routes: RouteSummary[] = [];
  for (const entry of value.routes) {
    const route = toRouteSummary(entry);
    if (route === null) {
      return null;
    }
    routes.push(route);
  }
  return { id, code, name, location: { lat, lon }, status, isDemo, routes };
}

function toStopDetail(value: unknown): StopDetail | null {
  const summary = toStopSummary(value);
  if (summary === null || !isRecord(value)) {
    return null;
  }
  const description = readNullableText(value.description, 500);
  const geofenceRadiusM = readCount(value.geofenceRadiusM, 500);
  const createdAt = readIsoDateTime(value.createdAt);
  if (description === undefined || geofenceRadiusM === null || geofenceRadiusM < 50) {
    return null;
  }
  if (createdAt === null) {
    return null;
  }
  return { ...summary, description, geofenceRadiusM, createdAt };
}

export const stopDetailSchema: PayloadSchema<StopDetail> = {
  safeParse(value) {
    const stop = toStopDetail(value);
    return stop === null ? { success: false } : { success: true, data: stop };
  },
};

export const qrLandingSchema: PayloadSchema<QrLanding> = {
  safeParse(value) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const stop = toStopDetail(value.stop);
    const qr = isRecord(value.qr) ? value.qr : null;
    const privacy = isRecord(value.privacy) ? value.privacy : null;
    if (stop === null || qr === null || privacy === null) {
      return { success: false };
    }
    if (typeof qr.valid !== 'boolean' || privacy.locationUsed !== false) {
      return { success: false };
    }
    const epoch = readNullableText(qr.epoch, 16);
    const keyId = readNullableText(qr.keyId, 16);
    if (epoch === undefined || keyId === undefined) {
      return { success: false };
    }
    return {
      success: true,
      data: { stop, qr: { valid: qr.valid, epoch, keyId }, privacy: { locationUsed: false } },
    };
  },
};

function toCoverageItem(value: unknown): CoverageSummaryItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const stopId = readText(value.stopId, 64);
  const stopCode = readText(value.stopCode, 12);
  const stopName = readText(value.stopName, 160);
  const n = readCount(value.n, 1_000_000);
  const devices = readCount(value.devices, 1_000_000);
  const days = readCount(value.days, 3_650);
  const clusters = readCount(value.clusters, 1_000_000);
  const hoursCovered = readCount(value.hoursCovered, 24);
  const level = isEvidenceLevel(value.level) ? value.level : null;
  if (stopId === null || stopCode === null || stopName === null) {
    return null;
  }
  if (n === null || devices === null || days === null || clusters === null || hoursCovered === null) {
    return null;
  }
  if (level === null) {
    return null;
  }
  return { stopId, stopCode, stopName, n, devices, days, clusters, hoursCovered, level };
}

function toMethodologyStep(value: unknown): Methodology['steps'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const order = readCount(value.order, 100);
  const title = readText(value.title, 120);
  const detail = readText(value.detail, 600);
  if (order === null || order < 1 || title === null || detail === null) {
    return null;
  }
  return { order, title, detail };
}

export const stopListSchema: PayloadSchema<StopSummary[]> = {
  safeParse(value) {
    if (!Array.isArray(value)) {
      return { success: false };
    }
    const items: StopSummary[] = [];
    for (const entry of value) {
      const stop = toStopSummary(entry);
      if (stop === null) {
        return { success: false };
      }
      items.push(stop);
    }
    return { success: true, data: items };
  },
};

export const coverageSummarySchema: PayloadSchema<CoverageSummary> = {
  safeParse(value) {
    if (!isRecord(value) || !Array.isArray(value.stops)) {
      return { success: false };
    }
    const period = readPeriod(value.period);
    if (period === null) {
      return { success: false };
    }
    const stops: CoverageSummaryItem[] = [];
    for (const entry of value.stops) {
      const item = toCoverageItem(entry);
      if (item === null) {
        return { success: false };
      }
      stops.push(item);
    }
    return { success: true, data: { period, stops } };
  },
};

export const methodologySchema: PayloadSchema<Methodology> = {
  safeParse(value) {
    if (!isRecord(value) || !Array.isArray(value.steps) || !Array.isArray(value.limitations)) {
      return { success: false };
    }
    const methodVersion = readText(value.methodVersion, 40);
    const updatedAt = readText(value.updatedAt, 40);
    const primaryEstimand = readText(value.primaryEstimand, 240);
    const secondaryEstimand = readText(value.secondaryEstimand, 240);
    const clusterUnit = readText(value.clusterUnit, 120);
    const clusterRationale = readText(value.clusterRationale, 600);
    const generatedAt = readText(value.generatedAt, 40);
    if (
      methodVersion === null ||
      updatedAt === null ||
      primaryEstimand === null ||
      secondaryEstimand === null ||
      clusterUnit === null ||
      clusterRationale === null ||
      generatedAt === null
    ) {
      return { success: false };
    }
    if (!isRecord(value.thresholds)) {
      return { success: false };
    }
    const excessMultiplier = readNumber(value.thresholds.excessMultiplier);
    const idealWaitFormula = readText(value.thresholds.idealWaitFormula, 120);
    if (excessMultiplier === null || idealWaitFormula === null) {
      return { success: false };
    }
    const steps: Methodology['steps'] = [];
    for (const entry of value.steps) {
      const step = toMethodologyStep(entry);
      if (step === null) {
        return { success: false };
      }
      steps.push(step);
    }
    const limitations: string[] = [];
    for (const entry of value.limitations) {
      const limitation = readText(entry, 400);
      if (limitation === null) {
        return { success: false };
      }
      limitations.push(limitation);
    }
    if (steps.length === 0 || limitations.length === 0) {
      return { success: false };
    }
    return {
      success: true,
      data: {
        methodVersion,
        updatedAt,
        primaryEstimand,
        secondaryEstimand,
        steps,
        clusterUnit,
        clusterRationale,
        thresholds: { excessMultiplier, idealWaitFormula },
        limitations,
        generatedAt,
      },
    };
  },
};

function toEstimateMetrics(value: unknown): Estimate['metrics'] | null {
  if (!isRecord(value)) {
    return null;
  }
  const n = readCount(value.n, 1_000_000);
  const nEffective = readOptionalNumber(value.nEffective);
  const medianMin = readOptionalNumber(value.medianMin);
  const meanMin = readOptionalNumber(value.meanMin);
  const rmstMin = readOptionalNumber(value.rmstMin);
  const p95Min = readOptionalNumber(value.p95Min);
  const ewtMin = readOptionalNumber(value.ewtMin);
  const abandonRate = readOptionalNumber(value.abandonRate);
  const fullRate = readOptionalNumber(value.fullRate);
  const cifAbandon = readOptionalNumber(value.cifAbandon);
  const timeToBoardRmstMin = readOptionalNumber(value.timeToBoardRmstMin);

  if (n === null) {
    return null;
  }
  const optionalNumbers = [
    nEffective,
    medianMin,
    meanMin,
    rmstMin,
    p95Min,
    ewtMin,
    abandonRate,
    fullRate,
    cifAbandon,
    timeToBoardRmstMin,
  ];
  if (optionalNumbers.some((entry) => entry === undefined)) {
    return null;
  }
  for (const rate of [abandonRate, fullRate, cifAbandon]) {
    if (rate !== null && rate !== undefined && (rate < 0 || rate > 1)) {
      return null;
    }
  }

  let ci: Estimate['metrics']['ci'] = null;
  if (value.ci !== null) {
    if (!isRecord(value.ci)) {
      return null;
    }
    const low = readNumber(value.ci.low);
    const high = readNumber(value.ci.high);
    const level = readNumber(value.ci.level);
    const method = readText(value.ci.method, 80);
    if (low === null || high === null || level === null || method === null) {
      return null;
    }
    if (level <= 0 || level >= 1 || low > high) {
      return null;
    }
    ci = { low, high, level, method };
  }

  return {
    n,
    nEffective: nEffective ?? null,
    medianMin: medianMin ?? null,
    meanMin: meanMin ?? null,
    rmstMin: rmstMin ?? null,
    p95Min: p95Min ?? null,
    ewtMin: ewtMin ?? null,
    abandonRate: abandonRate ?? null,
    fullRate: fullRate ?? null,
    cifAbandon: cifAbandon ?? null,
    timeToBoardRmstMin: timeToBoardRmstMin ?? null,
    ci,
  };
}

function toEstimate(value: unknown): Estimate | null {
  if (!isRecord(value) || !isRecord(value.window) || !isRecord(value.sample)) {
    return null;
  }
  const stopId = readText(value.stopId, 64);
  const stopCode = readText(value.stopCode, 12);
  const routeId = readNullableText(value.routeId, 64);
  const label = readPeriod(value.window.label);
  const start = readIsoDateTime(value.window.start);
  const end = readIsoDateTime(value.window.end);
  const metrics = toEstimateMetrics(value.metrics);
  const evidence = isEvidenceLevel(value.evidence) ? value.evidence : null;
  const direction = readDirection(value.direction);
  const message = readText(value.message, 1_000);
  const computedAt = readIsoDateTime(value.computedAt);
  const methodVersion = readText(value.methodVersion, 40);

  if (stopId === null || stopCode === null || routeId === undefined) {
    return null;
  }
  if (label === null || start === null || end === null || metrics === null) {
    return null;
  }
  if (evidence === null || direction === null || message === null) {
    return null;
  }
  if (computedAt === null || methodVersion === null) {
    return null;
  }
  if (typeof value.simulated !== 'boolean') {
    return null;
  }
  if (!Array.isArray(value.warnings) || value.warnings.length > MAX_WARNINGS) {
    return null;
  }
  const warnings: string[] = [];
  for (const entry of value.warnings) {
    const text = readText(entry, 80);
    if (text === null) {
      return null;
    }
    warnings.push(text);
  }

  const days = readCount(value.sample.days, 3_650);
  const devices = readCount(value.sample.devices, 1_000_000);
  const clusters = readCount(value.sample.clusters, 1_000_000);
  const designEffect = readNumber(value.sample.designEffect);
  const thresholdMin = readOptionalNumber(value.sample.thresholdMin);
  if (days === null || devices === null || clusters === null || designEffect === null) {
    return null;
  }
  if (thresholdMin === undefined) {
    return null;
  }

  let promise: Estimate['promise'] = null;
  if (value.promise !== null) {
    if (!isRecord(value.promise)) {
      return null;
    }
    const headwayMin = readNumber(value.promise.headwayMin);
    const source = readText(value.promise.source, 120);
    const sourceUrl = readNullableText(value.promise.sourceUrl, MAX_TEXT);
    if (headwayMin === null || headwayMin <= 0 || source === null || sourceUrl === undefined) {
      return null;
    }
    promise = { headwayMin, source, sourceUrl };
  }

  return {
    stopId,
    stopCode,
    routeId,
    window: { start, end, label },
    metrics,
    promise,
    evidence,
    direction,
    message,
    warnings,
    simulated: value.simulated,
    sample: { days, devices, clusters, designEffect, thresholdMin },
    computedAt,
    methodVersion,
  };
}

export const estimateSchema: PayloadSchema<Estimate> = {
  safeParse(value) {
    const estimate = toEstimate(value);
    return estimate === null ? { success: false } : { success: true, data: estimate };
  },
};

function toRouteDetail(value: unknown): RouteDetail | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const code = readText(value.code, 12);
  const name = readText(value.name, 120);
  const peak = readOptionalCount(value.promisedHeadwayPeakMin, 600);
  const off = readOptionalCount(value.promisedHeadwayOffMin, 600);
  const sourceUrl = readNullableText(value.headwaySourceUrl, MAX_TEXT);
  const validFrom = readNullableText(value.headwayValidFrom, 10);
  const validTo = readNullableText(value.headwayValidTo, 10);
  const stopCount = readCount(value.stopCount, 5_000);

  if (id === null || code === null || name === null) {
    return null;
  }
  if (peak === undefined || off === undefined || sourceUrl === undefined) {
    return null;
  }
  if (validFrom === undefined || validTo === undefined || stopCount === null) {
    return null;
  }
  if ((peak !== null && peak < 1) || (off !== null && off < 1)) {
    return null;
  }
  if (typeof value.mode !== 'string' || !ROUTE_MODES.has(value.mode)) {
    return null;
  }
  if (typeof value.status !== 'string' || !ROUTE_STATUSES.has(value.status)) {
    return null;
  }
  return {
    id,
    code,
    name,
    mode: value.mode as RouteDetail['mode'],
    status: value.status as RouteDetail['status'],
    promisedHeadwayPeakMin: peak,
    promisedHeadwayOffMin: off,
    headwaySourceUrl: sourceUrl,
    headwayValidFrom: validFrom,
    headwayValidTo: validTo,
    stopCount,
  };
}

function toRouteStop(value: unknown): RouteStopList['stops'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const stopId = readText(value.stopId, 64);
  const stopCode = readText(value.stopCode, 12);
  const stopName = readText(value.stopName, 160);
  const direction = readCount(value.direction, 1);
  const seq = readCount(value.seq, 10_000);

  if (stopId === null || stopCode === null || stopName === null) {
    return null;
  }
  if (direction === null || seq === null) {
    return null;
  }
  if (typeof value.status !== 'string' || !STOP_STATUSES.has(value.status)) {
    return null;
  }
  return {
    stopId,
    stopCode,
    stopName,
    direction,
    seq,
    status: value.status as RouteStopList['stops'][number]['status'],
  };
}

export const routeStopListSchema: PayloadSchema<RouteStopList> = {
  safeParse(value) {
    if (!isRecord(value) || !Array.isArray(value.stops)) {
      return { success: false };
    }
    const route = toRouteDetail(value.route);
    if (route === null) {
      return { success: false };
    }
    const stops: RouteStopList['stops'] = [];
    for (const entry of value.stops) {
      const stop = toRouteStop(entry);
      if (stop === null) {
        return { success: false };
      }
      stops.push(stop);
    }
    return { success: true, data: { route, stops } };
  },
};

function toRunwayEvent(value: unknown): RunwayEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const seq = readCount(value.seq, 1_000_000);
  const note = readText(value.note, 500);
  const sourceUrl = readText(value.sourceUrl, MAX_TEXT);
  const occurredAt = readIsoDateTime(value.occurredAt);
  if (seq === null || seq < 1 || note === null || sourceUrl === null || occurredAt === null) {
    return null;
  }
  if (typeof value.kind !== 'string' || !RUNWAY_EVENT_KINDS.has(value.kind)) {
    return null;
  }
  return { seq, kind: value.kind as RunwayEvent['kind'], note, sourceUrl, occurredAt };
}

function toRunway(value: unknown): Runway | null {
  if (!isRecord(value) || !Array.isArray(value.events) || !Array.isArray(value.sanctions)) {
    return null;
  }
  const routeId = readText(value.routeId, 64);
  const routeCode = readText(value.routeCode, 12);
  const routeName = readText(value.routeName, 120);
  const fundedUntil = readNullableText(value.fundedUntil, 10);
  const daysRemaining = readOptionalNumber(value.daysRemaining);
  const sourceUrl = readNullableText(value.sourceUrl, MAX_TEXT);
  const decisionDoc = readNullableText(value.decisionDoc, 500);
  const decisionDate = readNullableText(value.decisionDate, 10);
  const note = readNullableText(value.note, 500);
  const disclaimer = readText(value.disclaimer, 300);
  const computedAt = readIsoDateTime(value.computedAt);

  if (routeId === null || routeCode === null || routeName === null) {
    return null;
  }
  if (fundedUntil === undefined || sourceUrl === undefined || decisionDoc === undefined) {
    return null;
  }
  if (decisionDate === undefined || note === undefined) {
    return null;
  }
  if (daysRemaining === undefined || disclaimer === null || computedAt === null) {
    return null;
  }
  if (typeof value.status !== 'string' || !RUNWAY_STATUSES.has(value.status)) {
    return null;
  }
  if (typeof value.urgency !== 'string' || !URGENCY_BANDS.has(value.urgency)) {
    return null;
  }
  if (typeof value.simulated !== 'boolean') {
    return null;
  }
  if (value.sanctions.length > 5 || value.events.length > MAX_RUNWAY_EVENTS) {
    return null;
  }
  const sanctions: string[] = [];
  for (const entry of value.sanctions) {
    const text = readText(entry, 200);
    if (text === null) {
      return null;
    }
    sanctions.push(text);
  }
  const events: RunwayEvent[] = [];
  for (const entry of value.events) {
    const event = toRunwayEvent(entry);
    if (event === null) {
      return null;
    }
    events.push(event);
  }

  return {
    routeId,
    routeCode,
    routeName,
    status: value.status as Runway['status'],
    urgency: value.urgency as Runway['urgency'],
    fundedUntil,
    daysRemaining: daysRemaining ?? null,
    sourceUrl,
    decisionDoc,
    decisionDate,
    note,
    sanctions,
    events,
    disclaimer,
    simulated: value.simulated,
    computedAt,
  };
}

export const runwaySchema: PayloadSchema<Runway> = {
  safeParse(value) {
    const runway = toRunway(value);
    return runway === null ? { success: false } : { success: true, data: runway };
  },
};

export const runwayListSchema: PayloadSchema<Runway[]> = {
  safeParse(value) {
    if (!Array.isArray(value)) {
      return { success: false };
    }
    const items: Runway[] = [];
    for (const entry of value) {
      const runway = toRunway(entry);
      if (runway === null) {
        return { success: false };
      }
      items.push(runway);
    }
    return { success: true, data: items };
  },
};

export const runwayEventsSchema: PayloadSchema<RunwayEvent[]> = {
  safeParse(value) {
    if (!Array.isArray(value) || value.length > MAX_RUNWAY_EVENTS) {
      return { success: false };
    }
    const events: RunwayEvent[] = [];
    for (const entry of value) {
      const event = toRunwayEvent(entry);
      if (event === null) {
        return { success: false };
      }
      events.push(event);
    }
    return { success: true, data: events };
  },
};

function toTriageAction(value: unknown): TriageResult['actions'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const label = readText(value.label, 80);
  if (label === null || typeof value.kind !== 'string' || !TRIAGE_ACTIONS.has(value.kind)) {
    return null;
  }
  return { kind: value.kind as TriageActionKind, label };
}

function toTriageEvidence(value: unknown): TriageEvidence | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 80);
  const claim = readText(value.claim, 300);
  const sourceUrl = readNullableText(value.sourceUrl, MAX_TEXT);
  const retrievedAt = readIsoDateTime(value.retrievedAt);
  const label = readText(value.label, 80);
  const matchScore = readOptionalNumber(value.matchScore);
  const targetPublicId = value.targetPublicId === null ? null : readPublicId(value.targetPublicId);
  if (id === null || claim === null || retrievedAt === null || label === null) {
    return null;
  }
  if (sourceUrl === undefined || matchScore === undefined) {
    return null;
  }
  if (value.targetPublicId != null && targetPublicId === null) {
    return null;
  }
  if (typeof value.tier !== 'string' || !TIERS.has(value.tier)) {
    return null;
  }
  if (matchScore !== null && (matchScore < 0 || matchScore > 1)) {
    return null;
  }
  return {
    id,
    claim,
    tier: value.tier as TriageEvidence['tier'],
    sourceUrl,
    retrievedAt,
    matchScore,
    label,
    targetPublicId,
  };
}

function toConnectors(value: unknown): TriageResult['connectors'] | null {
  if (!isRecord(value)) {
    return null;
  }
  const output: TriageResult['connectors'] = {};
  for (const [name, state] of Object.entries(value)) {
    if (name.length === 0 || name.length > 40) {
      return null;
    }
    if (typeof state !== 'string' || !CONNECTOR_STATES.has(state)) {
      return null;
    }
    output[name] = state as 'ok' | 'unavailable' | 'not_configured';
  }
  return output;
}

function toTriageResult(value: unknown): TriageResult | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.actions) ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.reasons)
  ) {
    return null;
  }
  const sessionId = readText(value.sessionId, 64);
  const headline = readText(value.headline, 200);
  const body = readText(value.body, 1_000);
  const rulesVersion = readText(value.rulesVersion, 40);
  const latencyMs = readCount(value.latencyMs, 600_000);
  const connectors = toConnectors(value.connectors);
  if (sessionId === null || headline === null || body === null) {
    return null;
  }
  if (rulesVersion === null || latencyMs === null || connectors === null) {
    return null;
  }
  if (typeof value.verdict !== 'string' || !TRIAGE_VERDICTS.has(value.verdict)) {
    return null;
  }
  if (typeof value.requiresConfirmation !== 'boolean') {
    return null;
  }

  const actions: TriageResult['actions'] = [];
  for (const entry of value.actions) {
    const action = toTriageAction(entry);
    if (action === null) {
      return null;
    }
    actions.push(action);
  }
  if (actions.length === 0) {
    return null;
  }

  const evidence: TriageEvidence[] = [];
  for (const entry of value.evidence) {
    const item = toTriageEvidence(entry);
    if (item === null) {
      return null;
    }
    evidence.push(item);
  }
  if (evidence.length > 20) {
    return null;
  }

  const reasons: string[] = [];
  for (const entry of value.reasons) {
    const text = readText(entry, 300);
    if (text === null) {
      return null;
    }
    reasons.push(text);
  }

  return {
    sessionId,
    verdict: value.verdict as TriageResult['verdict'],
    headline,
    body,
    actions,
    evidence,
    connectors,
    rulesVersion,
    latencyMs,
    reasons,
    requiresConfirmation: value.requiresConfirmation,
  };
}

export const triageResultSchema: PayloadSchema<TriageResult> = {
  safeParse(value) {
    const result = toTriageResult(value);
    return result === null ? { success: false } : { success: true, data: result };
  },
};
function toReportListItem(value: unknown): ReportListItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const publicId = readText(value.publicId, 40);
  const stopCode = readText(value.stopCode, 12);
  const stopName = readText(value.stopName, 160);
  const corroborationCount = readCount(value.corroborationCount, 1_000_000);
  const createdAt = readIsoDateTime(value.createdAt);

  if (publicId === null || publicId.length < 6) {
    return null;
  }
  if (stopCode === null || stopName === null || createdAt === null) {
    return null;
  }
  if (corroborationCount === null) {
    return null;
  }
  if (typeof value.category !== 'string' || !REPORT_CATEGORIES.has(value.category)) {
    return null;
  }
  if (typeof value.status !== 'string' || !REPORT_STATUSES.has(value.status)) {
    return null;
  }
  if (!isEvidenceLevel(value.evidenceLevel)) {
    return null;
  }
  return {
    publicId,
    category: value.category as ReportListItem['category'],
    status: value.status as ReportListItem['status'],
    stopCode,
    stopName,
    corroborationCount,
    evidenceLevel: value.evidenceLevel,
    createdAt,
  };
}

export const reportListSchema: PayloadSchema<ReportListItem[]> = {
  safeParse(value) {
    if (!Array.isArray(value) || value.length > 100) {
      return { success: false };
    }
    const items: ReportListItem[] = [];
    for (const entry of value) {
      const item = toReportListItem(entry);
      if (item === null) {
        return { success: false };
      }
      items.push(item);
    }
    return { success: true, data: items };
  },
};

function toReportEvent(value: unknown): ReportDetail['events'][number] | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = readText(value.kind, 40);
  const createdAt = readIsoDateTime(value.createdAt);
  if (kind === null || createdAt === null) {
    return null;
  }
  if (typeof value.actorType !== 'string' || !REPORT_ACTORS.has(value.actorType)) {
    return null;
  }
  const note = readNullableText(value.note, 500);
  if (note === undefined) {
    return null;
  }
  return { kind, actorType: value.actorType as ReportDetail['events'][number]['actorType'], note, createdAt };
}

function toReportDetail(value: unknown): ReportDetail | null {
  if (!isRecord(value) || !Array.isArray(value.events)) {
    return null;
  }
  const publicId = readText(value.publicId, 40);
  const stopCode = readText(value.stopCode, 12);
  const stopName = readText(value.stopName, 160);
  const text = readText(value.text, 2_000);
  const authorityName = readNullableText(value.authorityName, 160);
  const corroborationCount = readCount(value.corroborationCount, 1_000_000);
  const evidenceScore = readNumber(value.evidenceScore);
  const createdAt = readIsoDateTime(value.createdAt);
  const resolvedAtRaw = value.resolvedAt;
  const resolvedAt =
    resolvedAtRaw === null || resolvedAtRaw === undefined ? null : readIsoDateTime(resolvedAtRaw);

  if (publicId === null || publicId.length < 6) {
    return null;
  }
  if (stopCode === null || stopName === null || text === null) {
    return null;
  }
  if (authorityName === undefined || corroborationCount === null || evidenceScore === null) {
    return null;
  }
  if (evidenceScore < 0 || evidenceScore > 1) {
    return null;
  }
  if (createdAt === null) {
    return null;
  }
  if (resolvedAtRaw !== null && resolvedAtRaw !== undefined && resolvedAt === null) {
    return null;
  }
  if (typeof value.category !== 'string' || !REPORT_CATEGORIES.has(value.category)) {
    return null;
  }
  if (typeof value.status !== 'string' || !REPORT_STATUSES.has(value.status)) {
    return null;
  }
  if (typeof value.moderation !== 'string' || !MODERATIONS.has(value.moderation)) {
    return null;
  }
  if (!isEvidenceLevel(value.evidenceLevel)) {
    return null;
  }

  const events: ReportDetail['events'] = [];
  for (const entry of value.events) {
    const event = toReportEvent(entry);
    if (event === null) {
      return null;
    }
    events.push(event);
  }
  if (events.length > 200) {
    return null;
  }

  return {
    publicId,
    category: value.category as ReportDetail['category'],
    status: value.status as ReportDetail['status'],
    stopCode,
    stopName,
    corroborationCount,
    evidenceLevel: value.evidenceLevel,
    createdAt,
    moderation: value.moderation as ReportDetail['moderation'],
    text,
    authorityName,
    evidenceScore,
    resolvedAt,
    events,
  };
}

export const reportDetailSchema: PayloadSchema<ReportDetail> = {
  safeParse(value) {
    const report = toReportDetail(value);
    return report === null ? { success: false } : { success: true, data: report };
  },
};

export const createReportResultSchema: PayloadSchema<CreateReportResult> = {
  safeParse(value) {
    if (!isRecord(value) || !Array.isArray(value.warnings)) {
      return { success: false };
    }
    const report = toReportDetail(value.report);
    if (report === null || value.warnings.length > 10) {
      return { success: false };
    }
    const warnings: string[] = [];
    for (const entry of value.warnings) {
      const text = readText(entry, 80);
      if (text === null) {
        return { success: false };
      }
      warnings.push(text);
    }
    return { success: true, data: { report, warnings } };
  },
};

export const corroborateResultSchema: PayloadSchema<CorroborateResult> = {
  safeParse(value) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const count = readCount(value.corroborationCount, 1_000_000);
    if (count === null || typeof value.alreadyCounted !== 'boolean') {
      return { success: false };
    }
    return { success: true, data: { corroborationCount: count, alreadyCounted: value.alreadyCounted } };
  },
};

export const closureResultSchema: PayloadSchema<ClosureResult> = {
  safeParse(value) {
    if (!isRecord(value)) {
      return { success: false };
    }
    if (typeof value.status !== 'string' || !REPORT_STATUSES.has(value.status)) {
      return { success: false };
    }
    if (typeof value.recorded !== 'boolean') {
      return { success: false };
    }
    return { success: true, data: { status: value.status as ClosureResult['status'], recorded: value.recorded } };
  },
};
function toUploadTicket(value: unknown): UploadTicket | null {
  if (!isRecord(value)) {
    return null;
  }
  const uploadId = readText(value.uploadId, 64);
  const url = readText(value.url, 200);
  const expiresAt = readIsoDateTime(value.expiresAt);
  if (uploadId === null || url === null || expiresAt === null) {
    return null;
  }
  if (value.method !== 'PUT') {
    return null;
  }
  if (!url.startsWith('/v1/uploads/')) {
    return null;
  }
  if (!isRecord(value.headers)) {
    return null;
  }
  const headers: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value.headers)) {
    const text = readText(entry, 256);
    if (name.length === 0 || name.length > 64 || text === null) {
      return null;
    }
    headers[name.toLowerCase()] = text;
  }
  if (headers['x-upload-token'] === undefined) {
    return null;
  }
  return { uploadId, url, method: 'PUT', headers, expiresAt };
}

export const uploadTicketSchema: PayloadSchema<UploadTicket> = {
  safeParse(value) {
    const ticket = toUploadTicket(value);
    return ticket === null ? { success: false } : { success: true, data: ticket };
  },
};

export interface StoredUpload {
  uploadId: string;
  mime: string;
  width: number;
  height: number;
}

function toStoredUpload(value: unknown): StoredUpload | null {
  if (!isRecord(value)) {
    return null;
  }
  const uploadId = readText(value.uploadId, 64);
  const mime = readText(value.mime, 40);
  const width = readCount(value.width, 20_000);
  const height = readCount(value.height, 20_000);
  if (uploadId === null || mime === null) {
    return null;
  }
  if (width === null || height === null) {
    return null;
  }
  return { uploadId, mime, width, height };
}

export const storedUploadSchema: PayloadSchema<StoredUpload> = {
  safeParse(value) {
    const stored = toStoredUpload(value);
    return stored === null ? { success: false } : { success: true, data: stored };
  },
};
