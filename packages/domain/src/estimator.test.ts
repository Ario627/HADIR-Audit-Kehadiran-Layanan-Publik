import { describe, expect, it } from 'vitest';
import {
  estimateWait,
  estimateWaitBuckets,
  type WaitEpisodeBucket,
  type WaitEpisodeInput,
} from './estimator';

function episode(overrides: Partial<WaitEpisodeInput> = {}): WaitEpisodeInput {
  return {
    durationS: 1_200,
    outcome: 'boarded',
    deviceHash: 'device-a',
    day: '2026-10-20',
    hour: 7,
    trustWeight: 0.85,
    qualityFlags: [],
    ...overrides,
  };
}

function buildCohort(count: number, durationS: number): WaitEpisodeInput[] {
  return Array.from({ length: count }, (_, index) =>
    episode({
      durationS,
      deviceHash: `device-${index % 12}`,
      day: `2026-10-${(20 + (index % 5)).toString()}`,
      hour: 6 + (index % 4),
      outcome: 'boarded',
    }),
  );
}

describe('estimateWait filtering', () => {
  it('returns an empty profile without data', () => {
    const estimate = estimateWait([]);
    expect(estimate).toMatchObject({
      n: 0,
      nEffective: 0,
      evidence: 'none',
      direction: 'inconclusive',
      medianMin: null,
      rmstMin: null,
      ci: null,
      methodVersion: 'km-v1',
    });
    expect(estimate.warnings).toContain('no_data');
  });

  it('excludes cancelled, short, and simulated episodes', () => {
    const estimate = estimateWait(
      [
        episode({ outcome: 'cancelled' }),
        episode({ durationS: 10 }),
        episode({ qualityFlags: ['simulated'] }),
        episode({ durationS: 900 }),
      ],
      { bootstrapIterations: 50 },
    );
    expect(estimate.n).toBe(1);
  });

  it('includes simulated episodes only when explicitly allowed', () => {
    const estimate = estimateWait(
      [episode({ qualityFlags: ['simulated'] }), episode({ qualityFlags: ['simulated'] })],
      { includeSimulated: true, bootstrapIterations: 50 },
    );
    expect(estimate.n).toBe(2);
  });

  it('excludes cluster anomalies from the main analysis', () => {
    const estimate = estimateWait(
      [episode(), episode({ qualityFlags: ['cluster_anomaly'] })],
      { bootstrapIterations: 50 },
    );
    expect(estimate.n).toBe(1);
  });
});

describe('estimateWaitBuckets', () => {
  function toBuckets(episodes: readonly WaitEpisodeInput[]): WaitEpisodeBucket[] {
    const store = new Map<string, WaitEpisodeBucket>();
    for (const episode of episodes) {
      const trustWeight = episode.trustWeight >= 0.6 ? 0.9 : 0.5;
      const key = [
        episode.day,
        episode.hour,
        episode.durationS,
        episode.outcome,
        trustWeight,
      ].join('|');
      const existing = store.get(key);
      if (existing === undefined) {
        store.set(key, {
          durationS: episode.durationS,
          outcome: episode.outcome,
          count: 1,
          trustWeight,
          day: episode.day,
          hour: episode.hour,
        });
        continue;
      }
      existing.count += 1;
    }
    return [...store.values()];
  }

  it('matches the episode path when devices and days are supplied', () => {
    const episodes = buildCohort(40, 1_200);
    const fromEpisodes = estimateWait(episodes, {
      headwayMinutes: 15,
      bootstrapIterations: 100,
      seed: 11,
    });
    const fromAggregates = estimateWaitBuckets(
      toBuckets(episodes),
      { devices: 12, simulated: false },
      { headwayMinutes: 15, bootstrapIterations: 100, seed: 11 },
    );

    expect(fromAggregates.n).toBe(fromEpisodes.n);
    expect(fromAggregates.clusters).toBe(fromEpisodes.clusters);
    expect(fromAggregates.days).toBe(fromEpisodes.days);
    expect(fromAggregates.devices).toBe(fromEpisodes.devices);
    expect(fromAggregates.rmstMin).toBe(fromEpisodes.rmstMin);
    expect(fromAggregates.p95Min).toBe(fromEpisodes.p95Min);
    expect(fromAggregates.ci).toEqual(fromEpisodes.ci);
    expect(fromAggregates.evidence).toBe(fromEpisodes.evidence);
    expect(fromAggregates.direction).toBe(fromEpisodes.direction);
  });

  it('reports the simulated flag from the population descriptor', () => {
    const buckets: WaitEpisodeBucket[] = [
      {
        durationS: 900,
        outcome: 'boarded',
        count: 20,
        trustWeight: 0.9,
        day: '2026-10-20',
        hour: 7,
      },
    ];
    const estimate = estimateWaitBuckets(buckets, { devices: 20, simulated: true }, {
      includeSimulated: true,
      bootstrapIterations: 50,
    });
    expect(estimate.simulated).toBe(true);
    expect(estimate.n).toBe(20);
  });

  it('ignores buckets with non-positive counts', () => {
    const estimate = estimateWaitBuckets(
      [
        {
          durationS: 900,
          outcome: 'boarded',
          count: 0,
          trustWeight: 0.9,
          day: '2026-10-20',
          hour: 7,
        },
      ],
      { devices: 0, simulated: false },
      { bootstrapIterations: 50 },
    );
    expect(estimate.n).toBe(0);
    expect(estimate.warnings).toContain('no_data');
  });
});

describe('estimateWait evidence', () => {
  it('awards strong evidence only when every criterion holds', () => {
    const estimate = estimateWait(buildCohort(40, 1_200), {
      headwayMinutes: 15,
      bootstrapIterations: 100,
    });
    expect(estimate).toMatchObject({
      n: 40,
      days: 5,
      devices: 12,
      clusters: 20,
      rmstMin: 20,
      medianMin: 20,
      p95Min: 20,
      thresholdMin: 9.375,
      evidence: 'strong',
      direction: 'excess',
    });
    expect(estimate.ci).toMatchObject({ low: 20, high: 20, level: 0.9 });
    expect(estimate.ewtMin).toBe(12.5);
    expect(estimate.warnings).toEqual([]);
  });

  it('refuses positive evidence when the interval sits below the threshold', () => {
    const estimate = estimateWait(buildCohort(30, 180), {
      headwayMinutes: 15,
      bootstrapIterations: 100,
    });
    expect(estimate.direction).toBe('no_excess');
    expect(estimate.evidence).toBe('none');
  });

  it('caps evidence at indication when the headway promise is unknown', () => {
    const estimate = estimateWait(buildCohort(40, 1_200), { bootstrapIterations: 100 });
    expect(estimate.thresholdMin).toBeNull();
    expect(estimate.evidence).toBe('indication');
    expect(estimate.direction).toBe('inconclusive');
  });
});

describe('estimateWait survival mechanics', () => {
  it('treats timeouts as censored and reports competing incidence', () => {
    const estimate = estimateWait(
      [
        episode({ durationS: 600, outcome: 'boarded' }),
        episode({ durationS: 1_200, outcome: 'abandoned' }),
        episode({ durationS: 2_700, outcome: 'timeout' }),
      ],
      { headwayMinutes: 15, bootstrapIterations: 50 },
    );
    expect(estimate).toMatchObject({
      n: 3,
      clusters: 1,
      rmstMin: 25,
      medianMin: 20,
      p95Min: null,
      abandonRate: 0.33,
      cifAbandon: 0.33,
      evidence: 'none',
    });
    expect(estimate.warnings).toContain('small_n');
    expect(estimate.warnings).toContain('small_cluster_count');
    expect(estimate.warnings).toContain('p95_unstable');
  });

  it('censors boardings that exceed tau', () => {
    const estimate = estimateWait([episode({ durationS: 3_000 })], {
      headwayMinutes: 15,
      bootstrapIterations: 50,
    });
    expect(estimate.rmstMin).toBe(45);
    expect(estimate.medianMin).toBeNull();
    expect(estimate.p95Min).toBeNull();
  });

  it('is deterministic for a fixed seed', () => {
    const cohort = buildCohort(36, 1_500).map((item, index) => ({
      ...item,
      durationS: 900 + index * 60,
    }));
    const first = estimateWait(cohort, { headwayMinutes: 15, seed: 7, bootstrapIterations: 100 });
    const second = estimateWait(cohort, { headwayMinutes: 15, seed: 7, bootstrapIterations: 100 });
    expect(first.ci).toEqual(second.ci);
    expect(first.designEffect).toEqual(second.designEffect);
  });

  it('flags trust sensitivity when low-trust episodes shift the estimate', () => {
    const trusted = buildCohort(30, 1_200);
    const untrusted = buildCohort(20, 2_400).map((item) => ({
      ...item,
      trustWeight: 0.45,
    }));
    const estimate = estimateWait([...trusted, ...untrusted], {
      headwayMinutes: 15,
      bootstrapIterations: 100,
    });
    expect(estimate.warnings).toContain('trust_sensitive');
    expect(estimate.warnings).toContain('low_trust_dominant');
  });
});