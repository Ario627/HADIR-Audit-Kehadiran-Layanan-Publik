import { qualityBandOf, type QualityBand } from './quality';

export interface ObservationPoint {
  day: string;
  hour: number;
  deviceDay: string;
  stopCode: string;
}

export interface ServiceWindow {
  startHour: number;
  endHour: number;
}

export interface RepresentativenessInput {
  observations: readonly ObservationPoint[];
  universeStops?: number | null;
  serviceWindow?: ServiceWindow;
  minPerHour?: number;
  daySpanDays?: number | null;
}

export interface TemporalCoverage {
  observedHours: readonly number[];
  missingHours: readonly number[];
  coverageRatio: number;
  busiestHour: number | null;
  busiestHourShare: number;
  quietestCoveredHour: number | null;
  quietestHourShare: number;
  imbalanceRatio: number | null;
}

export interface DayCoverage {
  uniqueDays: number;
  weekdayCount: number;
  weekendCount: number;
  weekdayShare: number;
  spanDays: number;
  gapDays: number;
  coverageRatio: number;
}

export interface DeviceConcentration {
  uniqueDeviceDays: number;
  effectiveDeviceDays: number;
  topShare: number;
  topTwoShare: number;
  hhi: number;
  band: 'diffuse' | 'moderate' | 'concentrated' | 'single_device';
}

export interface StopCoverage {
  observed: number;
  universe: number | null;
  ratio: number | null;
}

export interface CoverageWarning {
  code: string;
  detail: string;
}

export interface RepresentativenessReport {
  sample: number;
  temporal: TemporalCoverage;
  days: DayCoverage;
  devices: DeviceConcentration;
  stops: StopCoverage;
  score: number;
  band: QualityBand;
  representativenessLimitedTo: string | null;
  warnings: readonly CoverageWarning[];
}

const DEFAULT_SERVICE_WINDOW: ServiceWindow = Object.freeze({
  startHour: 5,
  endHour: 23,
});
const DEFAULT_MIN_PER_HOUR = 1;
const CONCENTRATED_TOP_SHARE = 0.5;
const MODERATE_HHI = 0.15;
const CONCENTRATED_HHI = 0.25;
const IMBALANCE_ALERT = 5;
const COVERAGE_ALERT = 0.5;
const STOP_RATIO_ALERT = 0.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isValidHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

function parseDay(day: string): Date | null {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWeekend(day: Date): boolean {
  const weekday = day.getUTCDay();
  return weekday === 0 || weekday === 6;
}

function sanitizeHour(hour: number): number {
  return isValidHour(hour) ? hour : 0;
}

function hoursInWindow(window: ServiceWindow): number[] {
  const start = Math.min(23, Math.max(0, Math.trunc(window.startHour)));
  const end = Math.min(23, Math.max(0, Math.trunc(window.endHour)));
  const output: number[] = [];
  for (let hour = 0; hour <= 23; hour += 1) {
    const inWindow = start <= end ? hour >= start && hour <= end : hour >= start || hour <= end;
    if (inWindow) {
      output.push(hour);
    }
  }
  return output;
}

function temporalCoverage(
  counts: readonly number[],
  window: ServiceWindow,
  minPerHour: number,
): TemporalCoverage {
  const expected = hoursInWindow(window);
  const observed: number[] = [];
  const missing: number[] = [];
  let busiest = -1;
  let busyCount = 0;
  let quietest = -1;
  let quietCount = Number.POSITIVE_INFINITY;
  let total = 0;

  for (const hour of expected) {
    const count = counts[hour] ?? 0;
    total += count;
    if (count >= minPerHour) {
      observed.push(hour);
      if (count > busyCount) {
        busyCount = count;
        busiest = hour;
      }
      if (count < quietCount) {
        quietCount = count;
        quietest = hour;
      }
    } else {
      missing.push(hour);
    }
  }

  return {
    observedHours: observed,
    missingHours: missing,
    coverageRatio: expected.length === 0 ? 0 : round3(observed.length / expected.length),
    busiestHour: busiest < 0 ? null : busiest,
    busiestHourShare: total === 0 ? 0 : round3(busyCount / total),
    quietestCoveredHour: quietest < 0 ? null : quietest,
    quietestHourShare:
      total === 0 || quietCount === Number.POSITIVE_INFINITY ? 0 : round3(quietCount / total),
    imbalanceRatio:
      onlyFinite(quietCount) && quietCount > 0 ? round2(busyCount / quietCount) : null,
  };
}

function onlyFinite(value: number): boolean {
  return Number.isFinite(value) && value !== Number.POSITIVE_INFINITY;
}

function dayCoverage(days: readonly string[], declaredSpan: number | null): DayCoverage {
  const parsed = new Map<string, Date>();
  for (const day of days) {
    const date = parseDay(day);
    if (date !== null) {
      parsed.set(day, date);
    }
  }
  let weekdayCount = 0;
  let weekendCount = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const date of parsed.values()) {
    if (isWeekend(date)) {
      weekendCount += 1;
    } else {
      weekdayCount += 1;
    }
    const time = date.getTime();
    if (time < min) {
      min = time;
    }
    if (time > max) {
      max = time;
    }
  }
  const uniqueDays = parsed.size;
  const naturalSpan = uniqueDays === 0 ? 0 : Math.floor((max - min) / 86_400_000) + 1;
  const spanDays = Math.max(naturalSpan, declaredSpan ?? 0);
  return {
    uniqueDays,
    weekdayCount,
    weekendCount,
    weekdayShare: uniqueDays === 0 ? 0 : round3(weekdayCount / uniqueDays),
    spanDays,
    gapDays: Math.max(0, spanDays - uniqueDays),
    coverageRatio: spanDays === 0 ? 0 : round3(uniqueDays / spanDays),
  };
}

function deviceConcentration(
  shares: readonly number[],
  uniqueDeviceDays: number,
): DeviceConcentration {
  if (uniqueDeviceDays === 0) {
    return {
      uniqueDeviceDays: 0,
      effectiveDeviceDays: 0,
      topShare: 0,
      topTwoShare: 0,
      hhi: 0,
      band: 'diffuse',
    };
  }
  const sorted = [...shares].sort((left, right) => right - left);
  const hhi = round3(sorted.reduce((sum, share) => sum + share * share, 0));
  const topShare = round3(sorted[0] ?? 0);
  const topTwoShare = round3((sorted[0] ?? 0) + (sorted[1] ?? 0));
  const band: DeviceConcentration['band'] =
    uniqueDeviceDays === 1
      ? 'single_device'
      : topShare >= CONCENTRATED_TOP_SHARE || hhi >= CONCENTRATED_HHI
        ? 'concentrated'
        : hhi >= MODERATE_HHI
          ? 'moderate'
          : 'diffuse';
  return {
    uniqueDeviceDays,
    effectiveDeviceDays: hhi === 0 ? 0 : round2(1 / hhi),
    topShare,
    topTwoShare,
    hhi,
    band,
  };
}

function stopCoverage(observed: number, universe: number | null | undefined): StopCoverage {
  const total =
    universe === undefined || universe === null || universe <= 0 ? null : universe;
  return {
    observed,
    universe: total,
    ratio: total === null ? null : round3(clamp01(observed / total)),
  };
}

function scoreOf(
  sample: number,
  temporal: TemporalCoverage,
  days: DayCoverage,
  devices: DeviceConcentration,
  stops: StopCoverage,
): number {
  if (sample === 0) {
    return 0;
  }
  const temporalScore = temporal.coverageRatio;
  const dayScore = 0.6 * days.coverageRatio + 0.4 * (days.weekendCount > 0 ? 1 : 0.4);
  const deviceScore =
    devices.band === 'diffuse'
      ? 1
      : devices.band === 'moderate'
        ? 0.7
        : devices.band === 'concentrated'
          ? 0.35
          : 0.15;
  if (stops.ratio === null) {
    return round2(0.45 * temporalScore + 0.35 * dayScore + 0.2 * deviceScore);
  }
  return round2(
    0.35 * temporalScore + 0.27 * dayScore + 0.18 * deviceScore + 0.2 * stops.ratio,
  );
}

function limitedTo(
  temporal: TemporalCoverage,
  days: DayCoverage,
  devices: DeviceConcentration,
): string | null {
  if (days.uniqueDays === 1) {
    return 'satu hari pengamatan';
  }
  if (devices.band === 'single_device') {
    return 'satu identitas perangkat-harian';
  }
  if (temporal.observedHours.length > 0 && temporal.observedHours.length <= 3) {
    const first = temporal.observedHours[0]!;
    const last = temporal.observedHours[temporal.observedHours.length - 1]!;
    return `jam ${String(first).padStart(2, '0')}.00-${String(last).padStart(2, '0')}.59`;
  }
  if (days.weekendCount === 0 && days.weekdayCount > 0) {
    return 'hari kerja saja';
  }
  return null;
}

function buildWarnings(input: {
  temporal: TemporalCoverage;
  days: DayCoverage;
  devices: DeviceConcentration;
  stops: StopCoverage;
  sample: number;
}): CoverageWarning[] {
  const warnings: CoverageWarning[] = [];
  if (input.sample === 0) {
    warnings.push({ code: 'no_observations', detail: 'Belum ada observasi untuk dianalisis.' });
    return warnings;
  }
  if (input.days.uniqueDays === 1) {
    warnings.push({
      code: 'single_day',
      detail: 'Semua observasi berasal dari satu hari, sehingga variasi antarhari belum terukur.',
    });
  }
  if (input.days.weekendCount === 0) {
    warnings.push({
      code: 'weekend_missing',
      detail: 'Belum ada observasi pada akhir pekan; pola hari kerja tidak boleh digeneralisasi.',
    });
  }
  if (input.days.gapDays > 0 && input.days.uniqueDays > 1) {
    warnings.push({
      code: 'day_gap',
      detail: `Ada ${input.days.gapDays} hari tanpa observasi di dalam rentang pengamatan.`,
    });
  }
  if (input.temporal.observedHours.length <= 3 && input.temporal.observedHours.length > 0) {
    warnings.push({
      code: 'narrow_time_window',
      detail: 'Observasi hanya mencakup sebagian kecil jam layanan.',
    });
  }
  if (
    input.temporal.observedHours.length <
    hoursInWindow(DEFAULT_SERVICE_WINDOW).length * COVERAGE_ALERT
  ) {
    warnings.push({
      code: 'hour_coverage_low',
      detail: 'Cakupan jam layanan masih di bawah separuh jendela yang diasumsikan.',
    });
  }
  if (
    input.temporal.imbalanceRatio !== null &&
    input.temporal.imbalanceRatio >= IMBALANCE_ALERT
  ) {
    warnings.push({
      code: 'hour_imbalance',
      detail: `Jam tersibuk menerima ${input.temporal.imbalanceRatio}x observasi dibanding jam tersepi.`,
    });
  }
  if (input.devices.band === 'single_device') {
    warnings.push({
      code: 'single_device',
      detail: 'Semua observasi berasal dari satu identitas perangkat-harian.',
    });
  } else if (input.devices.band === 'concentrated') {
    warnings.push({
      code: 'device_concentrated',
      detail: `Satu identitas perangkat-harian menyumbang ${Math.round(input.devices.topShare * 100)}% observasi.`,
    });
  }
  if (input.stops.ratio !== null && input.stops.ratio < STOP_RATIO_ALERT) {
    warnings.push({
      code: 'stop_coverage_low',
      detail: 'Hanya sebagian kecil halte pada cakupan yang memiliki observasi.',
    });
  }
  if (input.stops.universe === null) {
    warnings.push({
      code: 'universe_unknown',
      detail: 'Jumlah halte pembanding tidak diketahui, sehingga rasio cakupan tidak dihitung.',
    });
  }
  return warnings;
}

export function analyzeRepresentativeness(
  input: RepresentativenessInput,
): RepresentativenessReport {
  const window = input.serviceWindow ?? DEFAULT_SERVICE_WINDOW;
  const minPerHour = input.minPerHour ?? DEFAULT_MIN_PER_HOUR;
  const counts: number[] = Array.from({ length: 24 }, () => 0);
  const daySet = new Set<string>();
  const perDevice = new Map<string, number>();
  const perStop = new Set<string>();
  let sample = 0;

  for (const observation of input.observations) {
    const hour = sanitizeHour(observation.hour);
    counts[hour] = (counts[hour] ?? 0) + 1;
    sample += 1;
    const day = parseDay(observation.day);
    if (day !== null) {
      daySet.add(observation.day);
    }
    perDevice.set(observation.deviceDay, (perDevice.get(observation.deviceDay) ?? 0) + 1);
    if (observation.stopCode.length > 0) {
      perStop.add(observation.stopCode);
    }
  }

  const shares = sample === 0 ? [] : [...perDevice.values()].map((count) => count / sample);
  const temporal = temporalCoverage(counts, window, minPerHour);
  const days = dayCoverage([...daySet], input.daySpanDays ?? null);
  const devices = deviceConcentration(shares, perDevice.size);
  const stops = stopCoverage(perStop.size, input.universeStops ?? null);
  const score = scoreOf(sample, temporal, days, devices, stops);

  return {
    sample,
    temporal,
    days,
    devices,
    stops,
    score,
    band: qualityBandOf(score),
    representativenessLimitedTo: limitedTo(temporal, days, devices),
    warnings: buildWarnings({ temporal, days, devices, stops, sample }),
  };
}

export function describeRepresentativeness(report: RepresentativenessReport): string[] {
  if (report.sample === 0) {
    return ['Belum ada observasi; belum ada yang bisa disimpulkan.'];
  }
  const lines: string[] = [];
  if (report.representativenessLimitedTo !== null) {
    lines.push(
      `Data hanya mewakili ${report.representativenessLimitedTo}, bukan keseluruhan jadwal layanan.`,
    );
  } else {
    lines.push('Sebaran hari dan jam cukup lebar untuk klaim pada jendela yang diamati.');
  }
  for (const warning of report.warnings) {
    if (warning.code === 'universe_unknown') {
      continue;
    }
    lines.push(warning.detail);
  }
  return lines;
}

export function serviceWindowHours(
  window: ServiceWindow = DEFAULT_SERVICE_WINDOW,
): readonly number[] {
  return hoursInWindow(window);
}