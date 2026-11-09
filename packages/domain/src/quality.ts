export type QualityDimension =
  | 'strength'
  | 'precision'
  | 'coverage'
  | 'reliability'
  | 'corroboration';

export type QualityBand = 'very_low' | 'low' | 'moderate' | 'high';

export interface QualityInput {
  n: number;
  clusters: number;
  days: number;
  hours: number;
  deviceDays: number;
  ciLow: number | null;
  ciHigh: number | null;
  threshold: number | null;
  designEffect: number;
  lowTrustShare: number;
  sourceAgeDays: number | null;
  corroborationCount: number;
  fieldVerified: boolean;
}

export interface QualityDimensionResult {
  dimension: QualityDimension;
  score: number;
  band: QualityBand;
  reasons: readonly string[];
}

export interface QualityBreakdown {
  dimensions: readonly QualityDimensionResult[];
  limiting: QualityDimension;
  band: QualityBand;
  score: number;
  fieldVerifiedEligible: boolean;
  warnings: readonly string[];
}

const STRONG_N = 30;
const STRONG_CLUSTERS = 10;
const STRONG_DAYS = 7;
const STRONG_HOURS = 12;
const STRONG_DEVICE_DAYS = 10;
const CI_WIDTH_SHARE = 0.8;
const DESIGN_EFFECT_LIMIT = 2;
const MODERATE_TRUST_SHARE = 0.3;
const CORROBORATION_TARGET = 3;

const BAND_ORDER: readonly QualityBand[] = ['very_low', 'low', 'moderate', 'high'];
const DIMENSION_ORDER: readonly QualityDimension[] = [
  'strength',
  'precision',
  'coverage',
  'reliability',
  'corroboration',
];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function saturate(value: number, target: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(target) || target <= 0) {
    return 0;
  }
  return clamp01(value / target);
}

export function qualityBandOf(score: number): QualityBand {
  if (!Number.isFinite(score) || score < 0.25) {
    return 'very_low';
  }
  if (score < 0.5) {
    return 'low';
  }
  if (score < 0.75) {
    return 'moderate';
  }
  return 'high';
}

function worstBand(left: QualityBand, right: QualityBand): QualityBand {
  return BAND_ORDER.indexOf(left) <= BAND_ORDER.indexOf(right) ? left : right;
}

function freshnessFactor(ageDays: number | null): { factor: number; reason: string } {
  if (ageDays === null) {
    return { factor: 0.6, reason: 'source_age_unknown' };
  }
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return { factor: 0.6, reason: 'source_age_unknown' };
  }
  if (ageDays <= 7) {
    return { factor: 1, reason: 'source_fresh' };
  }
  if (ageDays <= 30) {
    return { factor: 0.8, reason: 'source_aging' };
  }
  if (ageDays <= 90) {
    return { factor: 0.5, reason: 'source_stale' };
  }
  return { factor: 0.2, reason: 'source_expired' };
}

function strengthResult(input: QualityInput): QualityDimensionResult {
  const countScore = saturate(input.n, STRONG_N);
  const clusterScore = saturate(input.clusters, STRONG_CLUSTERS);
  const score = round2(0.6 * countScore + 0.4 * clusterScore);
  const reasons: string[] = [];
  if (input.n < 15) {
    reasons.push('n_below_minimum');
  } else if (input.n < STRONG_N) {
    reasons.push('n_below_strong');
  }
  if (input.clusters < 3) {
    reasons.push('clusters_below_minimum');
  } else if (input.clusters < STRONG_CLUSTERS) {
    reasons.push('clusters_below_strong');
  }
  if (reasons.length === 0) {
    reasons.push('count_and_clusters_sufficient');
  }
  return { dimension: 'strength', score, band: qualityBandOf(score), reasons };
}

function precisionResult(input: QualityInput): QualityDimensionResult {
  const reasons: string[] = [];
  if (input.threshold === null || !Number.isFinite(input.threshold) || input.threshold <= 0) {
    return {
      dimension: 'precision',
      score: 0,
      band: 'very_low',
      reasons: ['threshold_unknown'],
    };
  }
  if (
    input.ciLow === null ||
    input.ciHigh === null ||
    !Number.isFinite(input.ciLow) ||
    !Number.isFinite(input.ciHigh) ||
    input.ciHigh < input.ciLow
  ) {
    return {
      dimension: 'precision',
      score: 0,
      band: 'very_low',
      reasons: ['interval_missing'],
    };
  }
  const width = input.ciHigh - input.ciLow;
  const allowed = input.threshold * CI_WIDTH_SHARE;
  const widthScore = clamp01(1 - width / allowed);
  const effect =
    Number.isFinite(input.designEffect) && input.designEffect > 0
      ? Math.max(1, input.designEffect)
      : 1;
  const effectPenalty = effect > DESIGN_EFFECT_LIMIT ? DESIGN_EFFECT_LIMIT / effect : 1;
  const score = round2(widthScore * effectPenalty);
  if (width / input.threshold > CI_WIDTH_SHARE) {
    reasons.push('interval_wide');
  }
  if (effect > DESIGN_EFFECT_LIMIT) {
    reasons.push('design_effect_high');
  }
  if (reasons.length === 0) {
    reasons.push('interval_narrow');
  }
  return { dimension: 'precision', score, band: qualityBandOf(score), reasons };
}

function coverageResult(input: QualityInput): QualityDimensionResult {
  const dayScore = saturate(input.days, STRONG_DAYS);
  const hourScore = saturate(input.hours, STRONG_HOURS);
  const deviceScore = saturate(input.deviceDays, STRONG_DEVICE_DAYS);
  const score = round2(0.45 * dayScore + 0.35 * hourScore + 0.2 * deviceScore);
  const reasons: string[] = [];
  if (input.days < 3) {
    reasons.push('days_below_minimum');
  } else if (input.days < STRONG_DAYS) {
    reasons.push('days_below_strong');
  }
  if (input.hours < 3) {
    reasons.push('hours_narrow');
  } else if (input.hours < STRONG_HOURS) {
    reasons.push('hours_partial');
  }
  if (input.deviceDays < 3) {
    reasons.push('device_days_few');
  }
  if (reasons.length === 0) {
    reasons.push('coverage_broad');
  }
  return { dimension: 'coverage', score, band: qualityBandOf(score), reasons };
}

function reliabilityResult(input: QualityInput): QualityDimensionResult {
  const trustShare = clamp01(input.lowTrustShare);
  const trustScore = 1 - Math.min(1, trustShare / MODERATE_TRUST_SHARE);
  const freshness = freshnessFactor(input.sourceAgeDays);
  const score = round2(clamp01(trustScore) * freshness.factor);
  const reasons: string[] = [freshness.reason];
  if (trustShare >= 0.5) {
    reasons.push('low_trust_dominant');
  } else if (trustShare > 0) {
    reasons.push('low_trust_present');
  } else {
    reasons.push('trust_uniform');
  }
  return { dimension: 'reliability', score, band: qualityBandOf(score), reasons };
}

function corroborationResult(input: QualityInput): QualityDimensionResult {
  const raw = saturate(input.corroborationCount, CORROBORATION_TARGET);
  const score = round2(input.fieldVerified ? Math.max(raw, 0.75) : raw);
  const reasons: string[] = [];
  if (input.fieldVerified) {
    reasons.push('field_verified');
  }
  if (input.corroborationCount === 0) {
    reasons.push('no_independent_confirmation');
  } else if (input.corroborationCount < CORROBORATION_TARGET) {
    reasons.push('partial_independent_confirmation');
  } else {
    reasons.push('independent_confirmation_present');
  }
  return { dimension: 'corroboration', score, band: qualityBandOf(score), reasons };
}

function limitingDimension(
  dimensions: readonly QualityDimensionResult[],
): QualityDimensionResult {
  let worst = dimensions[0]!;
  for (const entry of dimensions) {
    if (entry.score < worst.score) {
      worst = entry;
    }
  }
  return worst;
}

export function qualityBreakdown(input: QualityInput): QualityBreakdown {
  const dimensions = [
    strengthResult(input),
    precisionResult(input),
    coverageResult(input),
    reliabilityResult(input),
    corroborationResult(input),
  ];
  const limiting = limitingDimension(dimensions);
  const score = round2(limiting.score);
  const band = qualityBandOf(score);
  const fieldVerifiedEligible =
    input.fieldVerified && score >= 0.5 && dimensions[0]!.band !== 'very_low';

  const warnings: string[] = [];
  if (limiting.dimension === 'precision' && limiting.reasons.includes('threshold_unknown')) {
    warnings.push('benchmark_unavailable');
  }
  if (limiting.dimension === 'precision' && limiting.reasons.includes('interval_missing')) {
    warnings.push('interval_missing');
  }
  if (limiting.band === 'very_low') {
    warnings.push(`limited_by_${limiting.dimension}`);
  }
  if (input.fieldVerified && !fieldVerifiedEligible) {
    warnings.push('field_verification_not_applicable');
  }
  if (dimensions[2]!.score < 0.35) {
    warnings.push('coverage_narrow');
  }

  return {
    dimensions,
    limiting: limiting.dimension,
    band,
    score,
    fieldVerifiedEligible,
    warnings,
  };
}

export function describeQuality(breakdown: QualityBreakdown): string[] {
  const labels: Readonly<Record<QualityDimension, string>> = {
    strength: 'kekuatan bukti',
    precision: 'ketepatan statistik',
    coverage: 'cakupan data',
    reliability: 'keandalan sumber',
    corroboration: 'konfirmasi independen',
  };
  const bands: Readonly<Record<QualityBand, string>> = {
    very_low: 'sangat rendah',
    low: 'rendah',
    moderate: 'sedang',
    high: 'tinggi',
  };
  return breakdown.dimensions.map(
    (entry) => `${labels[entry.dimension]}: ${bands[entry.band]} (${entry.score.toFixed(2)})`,
  );
}

export function qualityDimensions(): readonly QualityDimension[] {
  return DIMENSION_ORDER;
}

export function strongestBand(bands: readonly QualityBand[]): QualityBand {
  let best: QualityBand = 'very_low';
  for (const band of bands) {
    if (BAND_ORDER.indexOf(band) > BAND_ORDER.indexOf(best)) {
      best = band;
    }
  }
  return best;
}

export function weakestBand(bands: readonly QualityBand[]): QualityBand {
  return bands.reduce<QualityBand>((carry, band) => worstBand(carry, band), 'high');
}