import {
  designEffect,
  drawClusterIndices,
  groupByCluster,
  mulberry32,
  percentileInterval,
  sampleVariance,
  weightedMean,
  weightedSampleVariance,
  type Interval,
} from './bootstrap';
import { evidenceView, type Direction, type EvidenceLevel } from './evidence';
import { excessThreshold } from './stats';
import {
  buildCauseSpecificCurve,
  summarizeSurvival,
  type SurvivalSummary,
} from './survival';

export type WaitOutcome = 'boarded' | 'abandoned' | 'passed_full' | 'cancelled' | 'timeout';

type AnalyzedOutcome = Exclude<WaitOutcome, 'cancelled'>;

export interface WaitEpisodeInput {
  durationS: number;
  outcome: WaitOutcome | null;
  deviceHash: string;
  day: string;
  hour: number;
  trustWeight: number;
  qualityFlags: readonly string[];
}

export interface WaitEpisodeBucket {
  durationS: number;
  outcome: WaitOutcome | null;
  count: number;
  trustWeight: number;
  day: string;
  hour: number;
  qualityFlags?: readonly string[];
}

export interface WaitPopulation {
  devices: number;
  simulated: boolean;
}

export interface WaitEstimateOptions {
  tauS?: number;
  headwayMinutes?: number | null;
  includeSimulated?: boolean;
  bootstrapIterations?: number;
  seed?: number;
}

export interface WaitConfidenceInterval {
  low: number;
  high: number;
  level: number;
  method: 'cluster-bootstrap';
  iterations: number;
}

export interface WaitEstimate {
  n: number;
  nEffective: number;
  clusters: number;
  days: number;
  devices: number;
  simulated: boolean;
  medianMin: number | null;
  meanMin: number | null;
  rmstMin: number | null;
  p95Min: number | null;
  ewtMin: number | null;
  abandonRate: number | null;
  fullRate: number | null;
  timeToBoardRmstMin: number | null;
  cifAbandon: number | null;
  ci: WaitConfidenceInterval | null;
  thresholdMin: number | null;
  evidence: EvidenceLevel;
  direction: Direction;
  designEffect: number;
  warnings: string[];
  methodVersion: string;
}

interface AnalyzedEpisode {
  durationS: number;
  outcome: AnalyzedOutcome;
  day: string;
  hour: number;
  trustWeight: number;
  weight: number;
}

interface DurationAxis {
  times: readonly number[];
  rankByDuration: ReadonlyMap<number, number>;
}

interface ClusterCounts {
  key: string;
  ranks: Int32Array;
  events: Float64Array;
  censored: Float64Array;
}

interface BootstrapSample {
  rmstS: number;
  p95S: number | null;
  meanS: number;
}

interface EstimateCounters {
  n: number;
  clusters: number;
  designEffectValue: number;
  p95Missing: number;
  iterations: number;
  trustSensitive: boolean;
  lowTrustShare: number;
}

const METHOD_VERSION = 'km-v1';
const DEFAULT_TAU_S = 45 * 60;
const MIN_DURATION_S = 30;
const MIN_N = 15;
const MIN_CLUSTERS = 3;
const STRONG_N = 30;
const STRONG_DAYS = 3;
const STRONG_DEVICES = 10;
const STRONG_CLUSTERS = 10;
const DESIGN_EFFECT_LIMIT = 2;
const DESIGN_EFFECT_N = 45;
const TRUST_FLOOR = 0.6;
const LOW_TRUST_DOMINANT = 0.3;
const TRUST_SENSITIVITY = 0.2;
const P95_UNSTABLE = 0.2;
const CI_LEVEL = 0.9;
const DEFAULT_ITERATIONS = 1_000;
const MIN_ITERATIONS = 50;
const MAX_ITERATIONS = 2_000;
const LEVEL_ORDER: readonly EvidenceLevel[] = [
  'none',
  'indication',
  'strong',
  'field_verified',
];

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function toMinutes(seconds: number): number {
  return round1(seconds / 60);
}

function toMinutesOrNull(seconds: number | null): number | null {
  return seconds === null ? null : toMinutes(seconds);
}

function isAnalyzedOutcome(value: WaitOutcome | null): value is AnalyzedOutcome {
  return value !== null && value !== 'cancelled';
}

function capLevel(level: EvidenceLevel, ceiling: EvidenceLevel): EvidenceLevel {
  return LEVEL_ORDER.indexOf(level) <= LEVEL_ORDER.indexOf(ceiling) ? level : ceiling;
}

function downgrade(level: EvidenceLevel): EvidenceLevel {
  return LEVEL_ORDER[Math.max(0, LEVEL_ORDER.indexOf(level) - 1)] ?? 'none';
}

function distinctCount(values: Iterable<string>): number {
  return new Set(values).size;
}

function clampIterations(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_ITERATIONS;
  }
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, Math.round(value)));
}

function clusterKeyOf(episode: AnalyzedEpisode): string {
  return `${episode.day}:${episode.hour}`;
}

function toAnalyzed(
  episodes: readonly WaitEpisodeInput[],
  includeSimulated: boolean,
): AnalyzedEpisode[] {
  const output: AnalyzedEpisode[] = [];
  for (const episode of episodes) {
    const analyzed = analyzeOne(
      episode.durationS,
      episode.outcome,
      episode.qualityFlags,
      1,
      episode.trustWeight,
      episode.day,
      episode.hour,
      includeSimulated,
    );
    if (analyzed !== null) {
      output.push(analyzed);
    }
  }
  return output;
}

function fromBuckets(
  buckets: readonly WaitEpisodeBucket[],
  includeSimulated: boolean,
): AnalyzedEpisode[] {
  const output: AnalyzedEpisode[] = [];
  for (const bucket of buckets) {
    if (!Number.isFinite(bucket.count) || bucket.count <= 0) {
      continue;
    }
    const analyzed = analyzeOne(
      bucket.durationS,
      bucket.outcome,
      bucket.qualityFlags ?? [],
      Math.round(bucket.count),
      bucket.trustWeight,
      bucket.day,
      bucket.hour,
      includeSimulated,
    );
    if (analyzed !== null) {
      output.push(analyzed);
    }
  }
  return output;
}

function analyzeOne(
  durationS: number,
  outcome: WaitOutcome | null,
  qualityFlags: readonly string[],
  weight: number,
  trustWeight: number,
  day: string,
  hour: number,
  includeSimulated: boolean,
): AnalyzedEpisode | null {
  if (!isAnalyzedOutcome(outcome)) {
    return null;
  }
  if (!Number.isFinite(durationS) || durationS < MIN_DURATION_S) {
    return null;
  }
  if (!includeSimulated && qualityFlags.includes('simulated')) {
    return null;
  }
  if (qualityFlags.includes('cluster_anomaly')) {
    return null;
  }
  return {
    durationS,
    outcome,
    day,
    hour,
    trustWeight: Number.isFinite(trustWeight) ? trustWeight : 0,
    weight,
  };
}

function buildAxis(episodes: readonly AnalyzedEpisode[], tauS: number): DurationAxis {
  const unique = new Set<number>();
  for (const episode of episodes) {
    unique.add(Math.min(episode.durationS, tauS));
  }
  const times = [...unique].sort((left, right) => left - right);
  const rankByDuration = new Map<number, number>();
  times.forEach((time, index) => rankByDuration.set(time, index));
  return { times, rankByDuration };
}

function experiencedEvent(episode: AnalyzedEpisode, tauS: number): boolean {
  return episode.outcome !== 'timeout' && episode.durationS <= tauS;
}

function boardEvent(episode: AnalyzedEpisode, tauS: number): boolean {
  return episode.outcome === 'boarded' && episode.durationS <= tauS;
}

interface RankCount {
  events: number;
  censored: number;
}

function buildClusterCounts(
  episodes: readonly AnalyzedEpisode[],
  tauS: number,
  eventOf: (episode: AnalyzedEpisode, tauS: number) => boolean,
  axis: DurationAxis,
): ClusterCounts[] {
  return groupByCluster(episodes, clusterKeyOf).map((group) => {
    const bucket = new Map<number, RankCount>();
    for (const episode of group.items) {
      const rank = axis.rankByDuration.get(Math.min(episode.durationS, tauS));
      if (rank === undefined) {
        continue;
      }
      const isEvent = eventOf(episode, tauS);
      const entry = bucket.get(rank);
      const weight = episode.weight;
      if (entry === undefined) {
        bucket.set(rank, {
          events: isEvent ? weight : 0,
          censored: isEvent ? 0 : weight,
        });
        continue;
      }
      if (isEvent) {
        entry.events += weight;
      } else {
        entry.censored += weight;
      }
    }
    const ordered = [...bucket].sort((left, right) => left[0] - right[0]);
    return {
      key: group.key,
      ranks: Int32Array.from(ordered, ([rank]) => rank),
      events: Float64Array.from(ordered, ([, entry]) => entry.events),
      censored: Float64Array.from(ordered, ([, entry]) => entry.censored),
    };
  });
}

function accumulateCluster(
  cluster: ClusterCounts,
  events: Float64Array,
  censored: Float64Array,
): void {
  for (let position = 0; position < cluster.ranks.length; position += 1) {
    const rank = cluster.ranks[position];
    if (rank === undefined) {
      continue;
    }
    events[rank] = (events[rank] ?? 0) + (cluster.events[position] ?? 0);
    censored[rank] = (censored[rank] ?? 0) + (cluster.censored[position] ?? 0);
  }
}

function accumulateAll(
  clusters: readonly ClusterCounts[],
  indices: readonly number[],
  events: Float64Array,
  censored: Float64Array,
): void {
  for (const index of indices) {
    const cluster = clusters[index];
    if (cluster === undefined) {
      continue;
    }
    accumulateCluster(cluster, events, censored);
  }
}

function summarizeAxis(
  axis: DurationAxis,
  events: Float64Array,
  censored: Float64Array,
  tauS: number,
): SurvivalSummary {
  return summarizeSurvival(axis.times, events, censored, tauS);
}

function bootstrapSamples(
  clusters: readonly ClusterCounts[],
  axis: DurationAxis,
  tauS: number,
  iterations: number,
  seed: number,
): BootstrapSample[] {
  const random = mulberry32(seed);
  const events = new Float64Array(axis.times.length);
  const censored = new Float64Array(axis.times.length);
  const samples: BootstrapSample[] = [];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    events.fill(0);
    censored.fill(0);
    accumulateAll(clusters, drawClusterIndices(clusters.length, random), events, censored);
    const summary = summarizeAxis(axis, events, censored, tauS);
    samples.push({
      rmstS: summary.rmstS,
      p95S: summary.p95S,
      meanS: summary.meanS,
    });
  }
  return samples;
}

function buildInterval(
  samples: readonly BootstrapSample[],
  iterations: number,
): WaitConfidenceInterval | null {
  const interval: Interval | null = percentileInterval(
    samples.map((sample) => sample.rmstS),
    CI_LEVEL,
  );
  if (interval === null) {
    return null;
  }
  return {
    low: toMinutes(interval.low),
    high: toMinutes(interval.high),
    level: CI_LEVEL,
    method: 'cluster-bootstrap',
    iterations,
  };
}

function survivalFor(
  episodes: readonly AnalyzedEpisode[],
  tauS: number,
  eventOf: (episode: AnalyzedEpisode, tauS: number) => boolean,
): SurvivalSummary | null {
  if (episodes.length === 0) {
    return null;
  }
  const axis = buildAxis(episodes, tauS);
  const events = new Float64Array(axis.times.length);
  const censored = new Float64Array(axis.times.length);
  for (const episode of episodes) {
    const rank = axis.rankByDuration.get(Math.min(episode.durationS, tauS));
    if (rank === undefined) {
      continue;
    }
    if (eventOf(episode, tauS)) {
      events[rank] = (events[rank] ?? 0) + episode.weight;
    } else {
      censored[rank] = (censored[rank] ?? 0) + episode.weight;
    }
  }
  return summarizeAxis(axis, events, censored, tauS);
}

function totalWeight(episodes: readonly AnalyzedEpisode[]): number {
  let total = 0;
  for (const episode of episodes) {
    total += episode.weight;
  }
  return total;
}

function trustSensitivity(
  episodes: readonly AnalyzedEpisode[],
  tauS: number,
  baselineS: number | null,
): boolean {
  if (baselineS === null || baselineS <= 0) {
    return false;
  }
  const trusted = episodes.filter((episode) => episode.trustWeight >= TRUST_FLOOR);
  const trustedWeight = totalWeight(trusted);
  const allWeight = totalWeight(episodes);
  if (trustedWeight === 0 || trustedWeight === allWeight) {
    return false;
  }
  const summary = survivalFor(trusted, tauS, experiencedEvent);
  if (summary === null) {
    return false;
  }
  return Math.abs(summary.rmstS - baselineS) / baselineS > TRUST_SENSITIVITY;
}

function lowTrustShare(episodes: readonly AnalyzedEpisode[]): number {
  const allWeight = totalWeight(episodes);
  if (allWeight === 0) {
    return 0;
  }
  const low = episodes.filter((episode) => episode.trustWeight < TRUST_FLOOR);
  return totalWeight(low) / allWeight;
}

function collectWarnings(counters: EstimateCounters): string[] {
  const warnings: string[] = [];
  if (counters.n === 0) {
    warnings.push('no_data');
    return warnings;
  }
  if (counters.n < MIN_N) {
    warnings.push('small_n');
  }
  if (counters.clusters < MIN_CLUSTERS) {
    warnings.push('small_cluster_count');
  }
  if (counters.designEffectValue > DESIGN_EFFECT_LIMIT) {
    warnings.push('clustered_data');
  }
  if (counters.iterations > 0 && counters.p95Missing / counters.iterations > P95_UNSTABLE) {
    warnings.push('p95_unstable');
  }
  if (counters.trustSensitive) {
    warnings.push('trust_sensitive');
  }
  if (counters.lowTrustShare > LOW_TRUST_DOMINANT) {
    warnings.push('low_trust_dominant');
  }
  return warnings;
}

function adjustEvidence(
  base: EvidenceLevel,
  input: {
    thresholdKnown: boolean;
    p95Reached: boolean;
    designEffectValue: number;
    n: number;
    nEffective: number;
    trustSensitive: boolean;
  },
): EvidenceLevel {
  let evidence = base;
  if (!input.thresholdKnown) {
    evidence = capLevel(evidence, 'indication');
  }
  if (!input.p95Reached) {
    evidence = capLevel(evidence, 'indication');
  }
  if (
    input.designEffectValue > DESIGN_EFFECT_LIMIT &&
    !(input.n >= DESIGN_EFFECT_N || input.nEffective >= STRONG_N)
  ) {
    evidence = downgrade(evidence);
  }
  if (input.trustSensitive) {
    evidence = downgrade(evidence);
  }
  return evidence;
}

export function estimateWait(
  episodes: readonly WaitEpisodeInput[],
  options: WaitEstimateOptions = {},
): WaitEstimate {
  const includeSimulated = options.includeSimulated ?? false;
  const analyzed = toAnalyzed(episodes, includeSimulated);
  const devices = new Set<string>();
  let simulated = false;
  for (const episode of episodes) {
    devices.add(episode.deviceHash);
    if (episode.qualityFlags.includes('simulated')) {
      simulated = true;
    }
  }
  return estimateCore(analyzed, { devices: devices.size, simulated }, options);
}

export function estimateWaitBuckets(
  buckets: readonly WaitEpisodeBucket[],
  population: WaitPopulation,
  options: WaitEstimateOptions = {},
): WaitEstimate {
  const includeSimulated = options.includeSimulated ?? false;
  return estimateCore(fromBuckets(buckets, includeSimulated), population, options);
}

function estimateCore(
  analyzed: readonly AnalyzedEpisode[],
  population: WaitPopulation,
  options: WaitEstimateOptions,
): WaitEstimate {
  const tauS = options.tauS ?? DEFAULT_TAU_S;
  const headwayMinutes = options.headwayMinutes ?? null;
  const iterations = clampIterations(options.bootstrapIterations);
  const seed = options.seed ?? 1;

  const n = totalWeight(analyzed);
  const axis = buildAxis(analyzed, tauS);
  const clusters = buildClusterCounts(analyzed, tauS, experiencedEvent, axis);
  const experienced = survivalFor(analyzed, tauS, experiencedEvent);
  const boarded = survivalFor(analyzed, tauS, boardEvent);
  const clustersCount = clusters.length;
  const days = distinctCount(analyzed.map((episode) => episode.day));

  const rmstS = experienced?.rmstS ?? null;
  const thresholdMin = excessThreshold(headwayMinutes);
  const samples =
    axis.times.length === 0
      ? []
      : bootstrapSamples(clusters, axis, tauS, iterations, seed);
  const ci = samples.length === 0 ? null : buildInterval(samples, iterations);

  const weighted = analyzed.map((episode) => ({
    value: episode.durationS,
    weight: episode.weight,
  }));
  const mean = weightedMean(weighted);
  const naiveVariance =
    mean === null ? null : (weightedSampleVariance(weighted, mean) ?? 0) / Math.max(1, n);
  const clusteredVariance = sampleVariance(samples.map((sample) => sample.meanS));
  const designEffectValue = designEffect(naiveVariance, clusteredVariance);
  const nEffective = n === 0 ? 0 : round1(n / Math.max(1, designEffectValue));
  const sensitive = trustSensitivity(analyzed, tauS, rmstS);

  const view = evidenceView({
    n,
    days,
    devices: population.devices,
    clusters: clustersCount,
    ciLow: ci?.low ?? null,
    ciHigh: ci?.high ?? null,
    threshold: thresholdMin,
    fieldVerified: false,
  });

  const evidence = adjustEvidence(view.evidence, {
    thresholdKnown: thresholdMin !== null,
    p95Reached: experienced?.p95S !== null && experienced?.p95S !== undefined,
    designEffectValue,
    n,
    nEffective,
    trustSensitive: sensitive,
  });

  const causeCurve = buildCauseSpecificCurve(
    analyzed.map((episode) => ({
      durationS: episode.durationS,
      cause: episode.outcome === 'timeout' ? null : episode.outcome,
    })),
    tauS,
  );
  let abandoned = 0;
  let full = 0;
  for (const episode of analyzed) {
    if (episode.outcome === 'passed_full') {
      full += episode.weight;
    }
    if (episode.outcome === 'abandoned' || episode.outcome === 'passed_full') {
      abandoned += episode.weight;
    }
  }
  const p95Missing = samples.filter((sample) => sample.p95S === null).length;
  const lowTrust = lowTrustShare(analyzed);
  const cifAbandonS =
    (causeCurve.incidence.abandoned ?? 0) + (causeCurve.incidence.passed_full ?? 0);

  return {
    n,
    nEffective,
    clusters: clustersCount,
    days,
    devices: population.devices,
    simulated: population.simulated,
    medianMin: toMinutesOrNull(experienced?.medianS ?? null),
    meanMin: toMinutesOrNull(mean),
    rmstMin: toMinutesOrNull(rmstS),
    p95Min: toMinutesOrNull(experienced?.p95S ?? null),
    ewtMin:
      rmstS === null || headwayMinutes === null
        ? null
        : round1(toMinutes(rmstS) - headwayMinutes / 2),
    abandonRate: n === 0 ? null : Math.round((abandoned / n) * 100) / 100,
    fullRate: n === 0 ? null : Math.round((full / n) * 100) / 100,
    timeToBoardRmstMin: toMinutesOrNull(boarded?.rmstS ?? null),
    cifAbandon: n === 0 ? null : Math.round(cifAbandonS * 100) / 100,
    ci,
    thresholdMin,
    evidence,
    direction: view.direction,
    designEffect: Math.round(designEffectValue * 100) / 100,
    warnings: collectWarnings({
      n,
      clusters: clustersCount,
      designEffectValue,
      p95Missing,
      iterations: samples.length,
      trustSensitive: sensitive,
      lowTrustShare: lowTrust,
    }),
    methodVersion: METHOD_VERSION,
  };
}

export const estimatorCriteria = Object.freeze({
  methodVersion: METHOD_VERSION,
  minN: MIN_N,
  minClusters: MIN_CLUSTERS,
  strongN: STRONG_N,
  strongDays: STRONG_DAYS,
  strongDevices: STRONG_DEVICES,
  strongClusters: STRONG_CLUSTERS,
  designEffectLimit: DESIGN_EFFECT_LIMIT,
  tauS: DEFAULT_TAU_S,
  ciLevel: CI_LEVEL,
});