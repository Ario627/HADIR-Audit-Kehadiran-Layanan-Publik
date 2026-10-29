export interface SurvivalSample {
  durationS: number;
  event: boolean;
}

export interface DurationCount {
  durationS: number;
  events: number;
  censored: number;
}

export interface SurvivalPoint {
  timeS: number;
  atRisk: number;
  events: number;
  censored: number;
  survival: number;
}

export interface SurvivalCurve {
  points: readonly SurvivalPoint[];
  tauS: number;
  total: number;
  events: number;
  censored: number;
}

export interface SurvivalSummary {
  rmstS: number;
  p95S: number | null;
  medianS: number | null;
  meanS: number;
  total: number;
  events: number;
  censored: number;
}

export interface CauseSample {
  durationS: number;
  cause: string | null;
}

export interface CauseSpecificCurve {
  curve: SurvivalCurve;
  incidence: Readonly<Record<string, number>>;
}

interface CauseBucket {
  durationS: number;
  totalEvents: number;
  censored: number;
  counts: Map<string, number>;
}

const MEDIAN_LEVEL = 0.5;
const P95_LEVEL = 0.05;

function clampDuration(durationS: number, tauS: number): number {
  if (!Number.isFinite(durationS) || durationS <= 0) {
    return 0;
  }
  return Math.min(durationS, tauS);
}

function sortCounts(counts: Iterable<DurationCount>): DurationCount[] {
  return [...counts].sort((left, right) => left.durationS - right.durationS);
}

function mergeInto(store: Map<number, DurationCount>, item: DurationCount): void {
  const bucket = store.get(item.durationS);
  if (bucket === undefined) {
    store.set(item.durationS, {
      durationS: item.durationS,
      events: item.events,
      censored: item.censored,
    });
    return;
  }
  bucket.events += item.events;
  bucket.censored += item.censored;
}

export function clampCounts(
  counts: readonly DurationCount[],
  tauS: number,
): DurationCount[] {
  const merged = new Map<number, DurationCount>();
  for (const item of counts) {
    mergeInto(merged, {
      durationS: clampDuration(item.durationS, tauS),
      events: Math.max(0, item.events),
      censored: Math.max(0, item.censored),
    });
  }
  return sortCounts(merged.values());
}

export function summarizeSurvival(
  times: readonly number[],
  events: ArrayLike<number>,
  censored: ArrayLike<number>,
  tauS: number,
): SurvivalSummary {
  let atRisk = 0;
  for (let index = 0; index < times.length; index += 1) {
    atRisk += (events[index] ?? 0) + (censored[index] ?? 0);
  }

  let survival = 1;
  let area = 0;
  let previousTime = 0;
  let medianS: number | null = null;
  let p95S: number | null = null;
  let totalEvents = 0;
  let totalCensored = 0;
  let weighted = 0;

  for (let index = 0; index < times.length; index += 1) {
    const time = times[index];
    if (time === undefined || time > tauS) {
      continue;
    }
    const eventCount = events[index] ?? 0;
    const censoredCount = censored[index] ?? 0;
    const count = eventCount + censoredCount;
    if (count === 0) {
      continue;
    }

    weighted += time * count;
    if (time > previousTime) {
      area += survival * (time - previousTime);
      previousTime = time;
    }
    if (atRisk > 0 && eventCount > 0) {
      survival = survival * (1 - eventCount / atRisk);
    }
    if (medianS === null && survival <= MEDIAN_LEVEL) {
      medianS = time;
    }
    if (p95S === null && survival <= P95_LEVEL) {
      p95S = time;
    }
    totalEvents += eventCount;
    totalCensored += censoredCount;
    atRisk -= count;
  }

  if (tauS > previousTime) {
    area += survival * (tauS - previousTime);
  }

  const total = totalEvents + totalCensored;
  return {
    rmstS: area,
    p95S,
    medianS,
    meanS: total === 0 ? 0 : weighted / total,
    total,
    events: totalEvents,
    censored: totalCensored,
  };
}

export function buildSurvivalCurveFromCounts(
  counts: readonly DurationCount[],
  tauS: number,
): SurvivalCurve {
  const sorted = clampCounts(counts, tauS);
  const points: SurvivalPoint[] = [];
  let atRisk = sorted.reduce((sum, item) => sum + item.events + item.censored, 0);
  let survival = 1;
  let events = 0;
  let censored = 0;

  for (const item of sorted) {
    const before = atRisk;
    if (before > 0 && item.events > 0) {
      survival = survival * (1 - item.events / before);
    }
    events += item.events;
    censored += item.censored;
    atRisk = before - item.events - item.censored;
    points.push({
      timeS: item.durationS,
      atRisk: before,
      events: item.events,
      censored: item.censored,
      survival,
    });
  }

  return { points, tauS, total: events + censored, events, censored };
}

export function buildSurvivalCurve(
  sample: readonly SurvivalSample[],
  tauS: number,
): SurvivalCurve {
  const store = new Map<number, DurationCount>();
  for (const item of sample) {
    if (!Number.isFinite(item.durationS) || item.durationS < 0) {
      continue;
    }
    mergeInto(store, {
      durationS: clampDuration(item.durationS, tauS),
      events: item.event ? 1 : 0,
      censored: item.event ? 0 : 1,
    });
  }
  return buildSurvivalCurveFromCounts(sortCounts(store.values()), tauS);
}

export function restrictedMeanSurvivalTime(
  curve: SurvivalCurve,
  tauS: number = curve.tauS,
): number {
  let area = 0;
  let previousTime = 0;
  let previousSurvival = 1;

  for (const point of curve.points) {
    if (point.timeS > tauS) {
      break;
    }
    if (point.timeS > previousTime) {
      area += previousSurvival * (point.timeS - previousTime);
      previousTime = point.timeS;
    }
    previousSurvival = point.survival;
  }

  if (tauS > previousTime) {
    area += previousSurvival * (tauS - previousTime);
  }
  return area;
}

export function survivalTimeAt(
  curve: SurvivalCurve,
  level: number,
  tauS: number = curve.tauS,
): number | null {
  if (!Number.isFinite(level) || level < 0 || level > 1) {
    return null;
  }
  for (const point of curve.points) {
    if (point.timeS > tauS) {
      break;
    }
    if (point.survival <= level) {
      return point.timeS;
    }
  }
  return null;
}

export function buildCauseSpecificCurve(
  sample: readonly CauseSample[],
  tauS: number,
): CauseSpecificCurve {
  const buckets = new Map<number, CauseBucket>();

  for (const item of sample) {
    if (!Number.isFinite(item.durationS) || item.durationS < 0) {
      continue;
    }
    const durationS = clampDuration(item.durationS, tauS);
    const bucket = buckets.get(durationS);
    if (bucket === undefined) {
      const counts = new Map<string, number>();
      if (item.cause !== null) {
        counts.set(item.cause, 1);
      }
      buckets.set(durationS, {
        durationS,
        totalEvents: item.cause === null ? 0 : 1,
        censored: item.cause === null ? 1 : 0,
        counts,
      });
      continue;
    }
    if (item.cause === null) {
      bucket.censored += 1;
      continue;
    }
    bucket.totalEvents += 1;
    bucket.counts.set(item.cause, (bucket.counts.get(item.cause) ?? 0) + 1);
  }

  const ordered = [...buckets.values()].sort(
    (left, right) => left.durationS - right.durationS,
  );
  const points: SurvivalPoint[] = [];
  const incidence = new Map<string, number>();
  let atRisk = ordered.reduce((sum, item) => sum + item.totalEvents + item.censored, 0);
  let survival = 1;
  let events = 0;
  let censored = 0;

  for (const bucket of ordered) {
    const before = atRisk;
    const survivalBefore = survival;
    if (before > 0) {
      for (const [cause, count] of bucket.counts) {
        incidence.set(cause, (incidence.get(cause) ?? 0) + survivalBefore * (count / before));
      }
      if (bucket.totalEvents > 0) {
        survival = survivalBefore * (1 - bucket.totalEvents / before);
      }
    }
    events += bucket.totalEvents;
    censored += bucket.censored;
    atRisk = before - bucket.totalEvents - bucket.censored;
    points.push({
      timeS: bucket.durationS,
      atRisk: before,
      events: bucket.totalEvents,
      censored: bucket.censored,
      survival,
    });
  }

  return {
    curve: { points, tauS, total: events + censored, events, censored },
    incidence: Object.fromEntries(incidence),
  };
}