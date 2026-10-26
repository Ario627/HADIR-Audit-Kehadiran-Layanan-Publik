import type {
  CoveragePeriod,
  CoverageSummary,
  CoverageSummaryItem,
  Methodology,
  QrLanding,
  RouteSummary,
  StopDetail,
  StopSummary,
} from '@hadir/contracts';
import type { PayloadSchema } from './api';
import { isEvidenceLevel } from './evidence';

const MAX_TEXT = 2_048;

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