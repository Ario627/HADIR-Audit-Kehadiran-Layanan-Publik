import { describe, expect, it } from 'vitest';
import {
  SCENARIOS,
  evaluateAllScenarios,
  evaluateScenario,
  findScenario,
} from './scenarios';

describe('ground truth scenario catalogue', () => {
  it('contains every documented scenario with a stable id', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(10);
    const ids = SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'excess-wait',
      'within-schedule',
      'single-device-flood',
      'single-day-many-hours',
      'sparse',
      'no-data',
      'simulated-mixed',
      'abandonment-heavy',
      'excluded-rows',
      'low-trust-dominant',
    ]);
  });

  it('gives every scenario a title, a summary and an expectation', () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.title.length).toBeGreaterThan(3);
      expect(scenario.summary.length).toBeGreaterThan(20);
      expect(Object.keys(scenario.expectation).length).toBeGreaterThan(0);
    }
  });
});

describe('estimator against ground truth', () => {
  const summary = evaluateAllScenarios();

  it('passes every scenario', () => {
    const failures = summary.results
      .filter((result) => !result.passed)
      .map((result) => ({
        id: result.id,
        failures: result.failures,
      }));
    expect(failures).toEqual([]);
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(summary.total);
  });

  it('is deterministic across repeated runs', () => {
    const again = evaluateAllScenarios();
    expect(again.passed).toBe(summary.passed);
    for (let index = 0; index < summary.results.length; index += 1) {
      expect(again.results[index]!.estimate.n).toBe(summary.results[index]!.estimate.n);
      expect(again.results[index]!.estimate.evidence).toBe(
        summary.results[index]!.estimate.evidence,
      );
    }
  });
});

describe('individual scenario semantics', () => {
  it('never claims excess when the observed wait is below the threshold', () => {
    const scenario = findScenario('within-schedule');
    expect(scenario).not.toBeNull();
    const result = evaluateScenario(scenario!);
    expect(result.estimate.direction).toBe('no_excess');
    expect(result.estimate.ewtMin!).toBeLessThan(0);
  });

  it('refuses strong evidence from a single cluster even with many rows', () => {
    const result = evaluateScenario(findScenario('single-device-flood')!);
    expect(result.estimate.n).toBe(40);
    expect(result.estimate.evidence).toBe('none');
    expect(result.estimate.clusters).toBe(1);
  });

  it('caps evidence when everything comes from a single day', () => {
    const result = evaluateScenario(findScenario('single-day-many-hours')!);
    expect(result.estimate.days).toBe(1);
    expect(result.estimate.evidence).not.toBe('strong');
    expect(result.estimate.evidence).not.toBe('field_verified');
  });

  it('returns empty figures instead of zero filled ones when there is no data', () => {
    const result = evaluateScenario(findScenario('no-data')!);
    expect(result.estimate.n).toBe(0);
    expect(result.estimate.medianMin).toBeNull();
    expect(result.estimate.rmstMin).toBeNull();
    expect(result.estimate.ewtMin).toBeNull();
    expect(result.estimate.ci).toBeNull();
  });

  it('excludes simulated rows from the estimate but still flags them', () => {
    const result = evaluateScenario(findScenario('simulated-mixed')!);
    expect(result.estimate.simulated).toBe(true);
    expect(result.estimate.n).toBe(60);
  });

  it('excludes anomalous clusters and cancelled episodes', () => {
    const result = evaluateScenario(findScenario('excluded-rows')!);
    expect(result.estimate.n).toBe(60);
  });

  it('surfaces abandonment instead of hiding it in the mean', () => {
    const result = evaluateScenario(findScenario('abandonment-heavy')!);
    expect(result.estimate.abandonRate!).toBeGreaterThanOrEqual(0.9);
    expect(result.estimate.cifAbandon!).toBeGreaterThan(0);
  });

  it('warns when low trust observations dominate', () => {
    const result = evaluateScenario(findScenario('low-trust-dominant')!);
    expect(result.estimate.warnings).toContain('low_trust_dominant');
  });
});
