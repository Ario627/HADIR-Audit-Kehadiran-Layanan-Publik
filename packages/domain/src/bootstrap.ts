export interface ClusterGroup<T> {
  key: string;
  items: readonly T[];
}

export interface Interval {
  low: number;
  high: number;
}

const UINT32_RANGE = 4_294_967_296;
const MULBERRY_INCREMENT = 0x6d2b79f5;

function compareNumber(left: number, right: number): number {
  return left - right;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + MULBERRY_INCREMENT) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function groupByCluster<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): ClusterGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [item]);
      continue;
    }
    bucket.push(item);
  }
  return [...groups].map(([key, list]) => ({ key, items: list }));
}

export function drawClusterIndices(total: number, random: () => number): number[] {
  if (total <= 0) {
    return [];
  }
  const indices: number[] = new Array<number>(total);
  for (let index = 0; index < total; index += 1) {
    indices[index] = Math.min(total - 1, Math.floor(random() * total));
  }
  return indices;
}

export function quantileSorted(
  sorted: readonly number[],
  probability: number,
): number | null {
  if (
    sorted.length === 0 ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1
  ) {
    return null;
  }
  const lowValue = sorted[0];
  if (sorted.length === 1) {
    return lowValue ?? null;
  }
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower];
  const upperValue = sorted[upper];
  if (lowerValue === undefined || upperValue === undefined) {
    return null;
  }
  if (lower === upper) {
    return lowerValue;
  }
  return lowerValue + (position - lower) * (upperValue - lowerValue);
}

export function percentileInterval(
  values: readonly number[],
  level: number,
): Interval | null {
  if (values.length === 0 || !Number.isFinite(level) || level <= 0 || level >= 1) {
    return null;
  }
  const tail = (1 - level) / 2;
  const sorted = [...values].sort(compareNumber);
  const low = quantileSorted(sorted, tail);
  const high = quantileSorted(sorted, 1 - tail);
  if (low === null || high === null) {
    return null;
  }
  return { low, high };
}

export function sampleVariance(values: readonly number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  let mean = 0;
  for (const value of values) {
    mean += value;
  }
  mean /= values.length;
  let sumSquares = 0;
  for (const value of values) {
    const delta = value - mean;
    sumSquares += delta * delta;
  }
  return sumSquares / (values.length - 1);
}

export interface WeightedValue {
  value: number;
  weight: number;
}

export function weightedMean(values: readonly WeightedValue[]): number | null {
  let total = 0;
  let weight = 0;
  for (const item of values) {
    if (!Number.isFinite(item.value) || !Number.isFinite(item.weight) || item.weight <= 0) {
      continue;
    }
    total += item.value * item.weight;
    weight += item.weight;
  }
  return weight === 0 ? null : total / weight;
}

export function weightedSampleVariance(
  values: readonly WeightedValue[],
  mean: number | null,
): number | null {
  if (mean === null) {
    return null;
  }
  let sumSquares = 0;
  let weight = 0;
  for (const item of values) {
    if (!Number.isFinite(item.value) || !Number.isFinite(item.weight) || item.weight <= 0) {
      continue;
    }
    const delta = item.value - mean;
    sumSquares += item.weight * delta * delta;
    weight += item.weight;
  }
  return weight < 2 ? null : sumSquares / (weight - 1);
}

export function designEffect(naive: number | null, clustered: number | null): number {
  if (
    naive === null ||
    clustered === null ||
    !Number.isFinite(naive) ||
    !Number.isFinite(clustered) ||
    naive <= 0
  ) {
    return 1;
  }
  const value = clustered / naive;
  return Number.isFinite(value) && value > 0 ? value : 1;
}