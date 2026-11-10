export interface ArrivalObservation {
  vehicleId: string;
  observedAtS: number;
}

export interface HeadwayOptions {
  scheduledHeadwayMin?: number | null;
  maxPlausibleGapMin?: number;
  minGaps?: number;
  bunchingShare?: number;
  gapOutShare?: number;
}

export type HeadwayAvailability = 'ok' | 'no_arrivals' | 'too_few_gaps' | 'no_schedule';

export type ReliabilityGrade = 'regular' | 'moderate' | 'irregular' | 'bunched';

export interface HeadwayReliability {
  available: boolean;
  reason: HeadwayAvailability;
  arrivals: number;
  gaps: number;
  excludedGaps: number;
  meanHeadwayMin: number | null;
  sdHeadwayMin: number | null;
  cv: number | null;
  medianHeadwayMin: number | null;
  p90HeadwayMin: number | null;
  expectedWaitMin: number | null;
  scheduledHeadwayMin: number | null;
  scheduledExpectedWaitMin: number | null;
  excessWaitMin: number | null;
  excessRatio: number | null;
  bunchingShare: number | null;
  gapOutShare: number | null;
  grade: ReliabilityGrade | null;
  warnings: readonly string[];
}

const DEFAULT_MAX_GAP_MIN = 180;
const DEFAULT_MIN_GAPS = 8;
const DEFAULT_BUNCHING_SHARE = 0.3;
const DEFAULT_GAP_OUT_SHARE = 0.2;
const CV_REGULAR = 0.2;
const CV_MODERATE = 0.4;
const CV_IRREGULAR = 0.6;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total / values.length;
}

function sampleSd(values: readonly number[], average: number | null): number | null {
  if (average === null || values.length < 2) {
    return null;
  }
  let sum = 0;
  for (const value of values) {
    const delta = value - average;
    sum += delta * delta;
  }
  return Math.sqrt(sum / (values.length - 1));
}

function quantileSorted(sorted: readonly number[], probability: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  const position = Math.min(1, Math.max(0, probability));
  const rank = Math.ceil(position * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? null;
}

function gradeOf(cv: number | null): ReliabilityGrade | null {
  if (cv === null || !Number.isFinite(cv)) {
    return null;
  }
  if (cv <= CV_REGULAR) {
    return 'regular';
  }
  if (cv <= CV_MODERATE) {
    return 'moderate';
  }
  if (cv <= CV_IRREGULAR) {
    return 'irregular';
  }
  return 'bunched';
}

function emptyResult(
  reason: HeadwayAvailability,
  arrivals: number,
  warnings: readonly string[],
  scheduledHeadwayMin: number | null,
): HeadwayReliability {
  return {
    available: false,
    reason,
    arrivals,
    gaps: 0,
    excludedGaps: 0,
    meanHeadwayMin: null,
    sdHeadwayMin: null,
    cv: null,
    medianHeadwayMin: null,
    p90HeadwayMin: null,
    expectedWaitMin: null,
    scheduledHeadwayMin,
    scheduledExpectedWaitMin:
      scheduledHeadwayMin === null ? null : round1(scheduledHeadwayMin / 2),
    excessWaitMin: null,
    excessRatio: null,
    bunchingShare: null,
    gapOutShare: null,
    grade: null,
    warnings,
  };
}

export function dedupeArrivals(
  arrivals: readonly ArrivalObservation[],
): ArrivalObservation[] {
  const seen = new Set<number>();
  const output: ArrivalObservation[] = [];
  for (const arrival of [...arrivals].sort(
    (left, right) => left.observedAtS - right.observedAtS,
  )) {
    if (!Number.isFinite(arrival.observedAtS) || seen.has(arrival.observedAtS)) {
      continue;
    }
    seen.add(arrival.observedAtS);
    output.push(arrival);
  }
  return output;
}

export function headwayGapsSeconds(
  arrivals: readonly ArrivalObservation[],
  maxPlausibleGapS: number,
): { gaps: number[]; excluded: number } {
  const ordered = dedupeArrivals(arrivals);
  const gaps: number[] = [];
  let excluded = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    const previous = ordered[index - 1]!;
    const gap = current.observedAtS - previous.observedAtS;
    if (!Number.isFinite(gap) || gap <= 0) {
      continue;
    }
    if (gap > maxPlausibleGapS) {
      excluded += 1;
      continue;
    }
    gaps.push(gap);
  }
  return { gaps, excluded };
}

export function analyzeHeadway(
  arrivals: readonly ArrivalObservation[],
  options: HeadwayOptions = {},
): HeadwayReliability {
  const scheduled =
    options.scheduledHeadwayMin !== undefined &&
    options.scheduledHeadwayMin !== null &&
    Number.isFinite(options.scheduledHeadwayMin) &&
    options.scheduledHeadwayMin > 0
      ? options.scheduledHeadwayMin
      : null;
  const maxGapS = Math.max(1, (options.maxPlausibleGapMin ?? DEFAULT_MAX_GAP_MIN) * 60);
  const minGaps = options.minGaps ?? DEFAULT_MIN_GAPS;

  const ordered = dedupeArrivals(arrivals);
  if (ordered.length < 2) {
    return emptyResult('no_arrivals', ordered.length, ['no_arrivals'], scheduled);
  }

  const { gaps: gapsS, excluded } = headwayGapsSeconds(ordered, maxGapS);
  if (gapsS.length < minGaps) {
    return emptyResult(
      'too_few_gaps',
      ordered.length,
      ['too_few_gaps', ...(excluded > 0 ? ['outliers_excluded'] : [])],
      scheduled,
    );
  }

  const gapsMin = gapsS.map((gap) => gap / 60);
  const average = mean(gapsMin);
  const sd = sampleSd(gapsMin, average);
  const cv = average === null || average <= 0 || sd === null ? null : sd / average;
  const sorted = [...gapsMin].sort((left, right) => left - right);
  const expectedWait = average === null || cv === null ? null : (average / 2) * (1 + cv * cv);
  const scheduledWait = scheduled === null ? null : scheduled / 2;
  const excessWait =
    expectedWait === null || scheduledWait === null ? null : expectedWait - scheduledWait;
  const excessRatio =
    expectedWait === null || scheduledWait === null || scheduledWait <= 0
      ? null
      : expectedWait / scheduledWait;

  const bunchThreshold = (average ?? 0) * 0.5;
  const gapOutThreshold = (average ?? 0) * 2;
  const bunchingCount = gapsMin.filter((gap) => gap < bunchThreshold).length;
  const gapOutCount = gapsMin.filter((gap) => gap > gapOutThreshold).length;
  const bunchingShare = gapsMin.length === 0 ? null : round3(bunchingCount / gapsMin.length);
  const gapOutShare = gapsMin.length === 0 ? null : round3(gapOutCount / gapsMin.length);
  const grade = gradeOf(cv);

  const warnings: string[] = [];
  if (excluded > 0) {
    warnings.push('outliers_excluded');
  }
  if (scheduled === null) {
    warnings.push('no_schedule');
  }
  if (grade === 'irregular' || grade === 'bunched') {
    warnings.push('bunching_suspected');
  }
  if (
    bunchingShare !== null &&
    bunchingShare >= (options.bunchingShare ?? DEFAULT_BUNCHING_SHARE)
  ) {
    warnings.push('bunching_detected');
  }
  if (gapOutShare !== null && gapOutShare >= (options.gapOutShare ?? DEFAULT_GAP_OUT_SHARE)) {
    warnings.push('gap_out_detected');
  }
  if (excessRatio !== null && excessRatio >= 1.25) {
    warnings.push('excess_wait_above_schedule');
  }

  return {
    available: true,
    reason: scheduled === null ? 'no_schedule' : 'ok',
    arrivals: ordered.length,
    gaps: gapsMin.length,
    excludedGaps: excluded,
    meanHeadwayMin: average === null ? null : round1(average),
    sdHeadwayMin: sd === null ? null : round1(sd),
    cv: cv === null ? null : round3(cv),
    medianHeadwayMin: round1(quantileSorted(sorted, 0.5) ?? 0),
    p90HeadwayMin: round1(quantileSorted(sorted, 0.9) ?? 0),
    expectedWaitMin: expectedWait === null ? null : round1(expectedWait),
    scheduledHeadwayMin: scheduled,
    scheduledExpectedWaitMin: scheduledWait === null ? null : round1(scheduledWait),
    excessWaitMin: excessWait === null ? null : round1(excessWait),
    excessRatio: excessRatio === null ? null : round3(excessRatio),
    bunchingShare,
    gapOutShare,
    grade,
    warnings,
  };
}

export function expectedWaitFromHeadway(
  meanHeadwayMin: number | null,
  cv: number | null,
): number | null {
  if (
    meanHeadwayMin === null ||
    cv === null ||
    !Number.isFinite(meanHeadwayMin) ||
    !Number.isFinite(cv) ||
    meanHeadwayMin <= 0
  ) {
    return null;
  }
  return round1((meanHeadwayMin / 2) * (1 + cv * cv));
}

export interface EwtComparison {
  rmstEwtMin: number | null;
  headwayEwtMin: number | null;
  differenceMin: number | null;
  comparable: false;
  note: string;
}

export function compareEwtEstimands(
  rmstEwtMin: number | null,
  headway: HeadwayReliability,
): EwtComparison {
  const headwayEwtMin = headway.available ? headway.expectedWaitMin : null;
  const differenceMin =
    rmstEwtMin === null || headwayEwtMin === null ? null : round1(headwayEwtMin - rmstEwtMin);
  return {
    rmstEwtMin,
    headwayEwtMin,
    differenceMin,
    comparable: false,
    note:
      'EWT berbasis RMST mengukur pengalaman penunggu yang teramati; EWT berbasis headway mengukur harapan tunggu teoretis dari kedatangan kendaraan. Keduanya menjawab pertanyaan berbeda dan tidak boleh dijumlahkan atau saling ditukar.',
  };
}