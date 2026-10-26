import { describe, expect, it } from 'vitest';
import {
  buildCauseSpecificCurve,
  buildSurvivalCurve,
  buildSurvivalCurveFromCounts,
  restrictedMeanSurvivalTime,
  survivalTimeAt,
} from './survival';

describe('buildSurvivalCurve', () => {
  const sample = [
    { durationS: 600, event: true },
    { durationS: 1_200, event: true },
    { durationS: 1_800, event: false },
  ];

  it('applies the Kaplan-Meier product limit with risk sets before each time', () => {
    const curve = buildSurvivalCurve(sample, 2_400);
    expect(curve.points.map((point) => point.atRisk)).toEqual([3, 2, 1]);
    expect(curve.points[0]?.survival).toBeCloseTo(2 / 3, 10);
    expect(curve.points[1]?.survival).toBeCloseTo(1 / 3, 10);
    expect(curve.points[2]?.survival).toBeCloseTo(1 / 3, 10);
    expect(curve.total).toBe(3);
    expect(curve.events).toBe(2);
    expect(curve.censored).toBe(1);
  });

  it('integrates the step function up to tau', () => {
    const curve = buildSurvivalCurve(sample, 2_400);
    expect(restrictedMeanSurvivalTime(curve)).toBeCloseTo(1_400, 6);
  });

  it('returns the first time survival drops to the requested level', () => {
    const curve = buildSurvivalCurve(sample, 2_400);
    expect(survivalTimeAt(curve, 0.5)).toBe(1_200);
    expect(survivalTimeAt(curve, 0.05)).toBeNull();
  });

  it('keeps censored-only data at full survival', () => {
    const curve = buildSurvivalCurve(
      [
        { durationS: 600, event: false },
        { durationS: 600, event: false },
      ],
      2_400,
    );
    expect(restrictedMeanSurvivalTime(curve)).toBeCloseTo(2_400, 6);
    expect(survivalTimeAt(curve, 0.5)).toBeNull();
  });

  it('handles ties in a single time bucket', () => {
    const curve = buildSurvivalCurve(
      [
        { durationS: 600, event: true },
        { durationS: 600, event: true },
      ],
      2_400,
    );
    expect(curve.points).toHaveLength(1);
    expect(curve.points[0]?.survival).toBe(0);
    expect(restrictedMeanSurvivalTime(curve)).toBeCloseTo(600, 6);
  });

  it('merges duplicate durations supplied as counts', () => {
    const curve = buildSurvivalCurveFromCounts(
      [
        { durationS: 600, events: 1, censored: 0 },
        { durationS: 600, events: 0, censored: 2 },
      ],
      2_400,
    );
    expect(curve.points).toHaveLength(1);
    expect(curve.points[0]?.atRisk).toBe(3);
    expect(curve.points[0]?.events).toBe(1);
    expect(curve.points[0]?.censored).toBe(2);
  });

  it('clamps durations that exceed tau', () => {
    const curve = buildSurvivalCurve([{ durationS: 9_000, event: false }], 2_700);
    expect(curve.points[0]?.timeS).toBe(2_700);
  });
});

describe('buildCauseSpecificCurve', () => {
  it('accumulates Aalen-Johansen incidence with competing risks', () => {
    const { curve, incidence } = buildCauseSpecificCurve(
      [
        { durationS: 600, cause: 'boarded' },
        { durationS: 1_200, cause: 'abandoned' },
        { durationS: 1_800, cause: null },
      ],
      2_400,
    );
    expect(incidence.boarded).toBeCloseTo(1 / 3, 10);
    expect(incidence.abandoned).toBeCloseTo(1 / 3, 10);
    const last = curve.points[curve.points.length - 1];
    const residual = 1 - (incidence.boarded ?? 0) - (incidence.abandoned ?? 0);
    expect(residual).toBeCloseTo(last?.survival ?? 1 / 3, 10);
  });

  it('reports zero incidence when every episode is censored', () => {
    const { incidence } = buildCauseSpecificCurve(
      [
        { durationS: 600, cause: null },
        { durationS: 900, cause: null },
      ],
      2_400,
    );
    expect(incidence).toEqual({});
  });
});