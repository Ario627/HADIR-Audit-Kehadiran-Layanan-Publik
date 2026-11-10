import { describe, expect, it } from 'vitest';
import {
  analyzeHeadway,
  compareEwtEstimands,
  dedupeArrivals,
  expectedWaitFromHeadway,
  headwayGapsSeconds,
  type ArrivalObservation,
} from './headway';

function arrivals(everyMin: number, count: number): ArrivalObservation[] {
  return Array.from({ length: count }, (_value, index) => ({
    vehicleId: `v${index}`,
    observedAtS: index * everyMin * 60,
  }));
}

function gapsFrom(minutes: readonly number[]): ArrivalObservation[] {
  const output: ArrivalObservation[] = [{ vehicleId: 'v0', observedAtS: 0 }];
  let clock = 0;
  for (let index = 0; index < minutes.length; index += 1) {
    clock += minutes[index]! * 60;
    output.push({ vehicleId: `v${index + 1}`, observedAtS: clock });
  }
  return output;
}

describe('dedupeArrivals', () => {
  it('sorts by time and drops duplicates', () => {
    const result = dedupeArrivals([
      { vehicleId: 'b', observedAtS: 120 },
      { vehicleId: 'a', observedAtS: 0 },
      { vehicleId: 'c', observedAtS: 120 },
    ]);
    expect(result.map((entry) => entry.observedAtS)).toEqual([0, 120]);
  });

  it('drops non finite timestamps', () => {
    const result = dedupeArrivals([
      { vehicleId: 'a', observedAtS: Number.NaN },
      { vehicleId: 'b', observedAtS: 10 },
    ]);
    expect(result).toHaveLength(1);
  });
});

describe('headwayGapsSeconds', () => {
  it('returns consecutive differences', () => {
    const { gaps, excluded } = headwayGapsSeconds(arrivals(10, 4), 3_600);
    expect(gaps).toEqual([600, 600, 600]);
    expect(excluded).toBe(0);
  });

  it('excludes implausible gaps instead of letting them dominate', () => {
    const { gaps, excluded } = headwayGapsSeconds(
      [
        { vehicleId: 'a', observedAtS: 0 },
        { vehicleId: 'b', observedAtS: 600 },
        { vehicleId: 'c', observedAtS: 600 + 5 * 3_600 },
        { vehicleId: 'd', observedAtS: 600 + 5 * 3_600 + 600 },
      ],
      3_600,
    );
    expect(gaps).toEqual([600, 600]);
    expect(excluded).toBe(1);
  });
});

describe('analyzeHeadway availability', () => {
  it('refuses to invent a headway from a single arrival', () => {
    const result = analyzeHeadway(arrivals(10, 1));
    expect(result.available).toBe(false);
    expect(result.reason).toBe('no_arrivals');
    expect(result.expectedWaitMin).toBeNull();
    expect(result.warnings).toContain('no_arrivals');
  });

  it('refuses when there are too few gaps', () => {
    const result = analyzeHeadway(arrivals(10, 4));
    expect(result.available).toBe(false);
    expect(result.reason).toBe('too_few_gaps');
    expect(result.gaps).toBe(0);
  });

  it('marks a missing schedule instead of assuming one', () => {
    const result = analyzeHeadway(arrivals(10, 12));
    expect(result.available).toBe(true);
    expect(result.reason).toBe('no_schedule');
    expect(result.scheduledHeadwayMin).toBeNull();
    expect(result.excessWaitMin).toBeNull();
    expect(result.warnings).toContain('no_schedule');
  });
});

describe('analyzeHeadway mathematics', () => {
  it('returns zero variance and half headway for a perfectly regular service', () => {
    const result = analyzeHeadway(arrivals(10, 12), { scheduledHeadwayMin: 10 });
    expect(result.available).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.meanHeadwayMin).toBe(10);
    expect(result.sdHeadwayMin).toBe(0);
    expect(result.cv).toBe(0);
    expect(result.expectedWaitMin).toBe(5);
    expect(result.scheduledExpectedWaitMin).toBe(5);
    expect(result.excessWaitMin).toBe(0);
    expect(result.grade).toBe('regular');
  });

  it('raises the expected wait as headway variability grows', () => {
    const regular = analyzeHeadway(arrivals(10, 12));
    const irregular = analyzeHeadway(gapsFrom([5, 15, 5, 15, 5, 15, 5, 15]));
    expect(irregular.cv).toBeGreaterThan(regular.cv ?? 0);
    expect(irregular.expectedWaitMin!).toBeGreaterThan(regular.expectedWaitMin!);
  });

  it('matches the documented E(W) = E(H)/2 * (1 + CV^2) formula', () => {
    const result = analyzeHeadway(gapsFrom([5, 15, 5, 15, 5, 15, 5, 15]));
    const mean = result.meanHeadwayMin!;
    const cv = result.cv!;
    const expected = (mean / 2) * (1 + cv * cv);
    expect(result.expectedWaitMin).toBeCloseTo(Math.round(expected * 10) / 10, 1);
  });

  it('computes the coefficient of variation from the sample standard deviation', () => {
    const result = analyzeHeadway(gapsFrom([5, 15, 5, 15, 5, 15, 5, 15]));
    expect(result.meanHeadwayMin).toBe(10);
    expect(result.sdHeadwayMin).toBeCloseTo(5.3, 1);
    expect(result.cv).toBeCloseTo(0.535, 2);
  });

  it('classifies reliability grades from the coefficient of variation', () => {
    expect(analyzeHeadway(arrivals(10, 12)).grade).toBe('regular');
    expect(analyzeHeadway(gapsFrom([7, 13, 7, 13, 7, 13, 7, 13])).grade).toBe('moderate');
    expect(analyzeHeadway(gapsFrom([5, 15, 5, 15, 5, 15, 5, 15])).grade).toBe('irregular');
    expect(analyzeHeadway(gapsFrom([1, 1, 1, 1, 1, 1, 1, 60])).grade).toBe('bunched');
  });

  it('reports excess wait relative to the scheduled wait', () => {
    const result = analyzeHeadway(gapsFrom([5, 15, 5, 15, 5, 15, 5, 15]), {
      scheduledHeadwayMin: 10,
    });
    expect(result.scheduledExpectedWaitMin).toBe(5);
    expect(result.excessWaitMin).toBeGreaterThan(0);
    expect(result.excessRatio).toBeGreaterThan(1.25);
    expect(result.warnings).toContain('excess_wait_above_schedule');
  });

  it('stays silent about excess when the observed service beats the schedule', () => {
    const result = analyzeHeadway(arrivals(4, 12), { scheduledHeadwayMin: 20 });
    expect(result.excessWaitMin!).toBeLessThan(0);
    expect(result.warnings).not.toContain('excess_wait_above_schedule');
  });

  it('computes median and p90 headway', () => {
    const result = analyzeHeadway(gapsFrom([5, 15, 5, 15, 5, 15, 5, 15]));
    expect(result.medianHeadwayMin).toBe(5);
    expect(result.p90HeadwayMin).toBe(15);
  });
});

describe('analyzeHeadway bunching detection', () => {
  it('flags a bunched service where many gaps are far below the mean', () => {
    const result = analyzeHeadway(gapsFrom([1, 1, 1, 1, 1, 1, 1, 30]));
    expect(result.bunchingShare!).toBeGreaterThan(0.5);
    expect(result.warnings).toContain('bunching_detected');
    expect(result.warnings).toContain('bunching_suspected');
  });

  it('flags a gap out where a long hole dominates', () => {
    const result = analyzeHeadway(gapsFrom([4, 4, 4, 4, 4, 4, 4, 60]), {
      gapOutShare: 0.1,
    });
    expect(result.gapOutShare!).toBeGreaterThan(0.1);
    expect(result.warnings).toContain('gap_out_detected');
  });

  it('keeps a regular service free of bunching warnings', () => {
    const result = analyzeHeadway(arrivals(10, 12));
    expect(result.bunchingShare).toBe(0);
    expect(result.gapOutShare).toBe(0);
    expect(result.warnings).not.toContain('bunching_detected');
    expect(result.warnings).not.toContain('gap_out_detected');
  });

  it('reports how many implausible gaps were excluded', () => {
    const result = analyzeHeadway(
      [
        ...arrivals(10, 10),
        { vehicleId: 'late', observedAtS: 9 * 60 + 10 * 3_600 },
      ],
      { maxPlausibleGapMin: 60 },
    );
    expect(result.excludedGaps).toBe(1);
    expect(result.warnings).toContain('outliers_excluded');
  });
});

describe('expectedWaitFromHeadway', () => {
  it('implements the variability correction', () => {
    expect(expectedWaitFromHeadway(10, 0)).toBe(5);
    expect(expectedWaitFromHeadway(10, 0.5)).toBe(6.3);
    expect(expectedWaitFromHeadway(10, 1)).toBe(10);
  });

  it('returns null for unusable input', () => {
    expect(expectedWaitFromHeadway(null, 0.2)).toBeNull();
    expect(expectedWaitFromHeadway(10, null)).toBeNull();
    expect(expectedWaitFromHeadway(0, 0.2)).toBeNull();
  });
});

describe('compareEwtEstimands', () => {
  it('never claims the two EWT definitions are interchangeable', () => {
    const headway = analyzeHeadway(arrivals(10, 12), { scheduledHeadwayMin: 10 });
    const comparison = compareEwtEstimands(12, headway);
    expect(comparison.comparable).toBe(false);
    expect(comparison.differenceMin).toBe(-7);
    expect(comparison.note).toContain('tidak boleh');
  });

  it('returns null when one side is missing', () => {
    const headway = analyzeHeadway(arrivals(10, 2));
    const comparison = compareEwtEstimands(null, headway);
    expect(comparison.headwayEwtMin).toBeNull();
    expect(comparison.differenceMin).toBeNull();
  });
});
