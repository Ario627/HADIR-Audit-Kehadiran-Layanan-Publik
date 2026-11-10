import { describe, expect, it } from 'vitest';
import {
  analyzeRepresentativeness,
  describeRepresentativeness,
  serviceWindowHours,
  type ObservationPoint,
} from './representativeness';

function point(overrides: Partial<ObservationPoint> = {}): ObservationPoint {
  return {
    day: '2026-10-12',
    hour: 7,
    deviceDay: 'device-a',
    stopCode: 'BMS-A12',
    ...overrides,
  };
}

function spread(
  days: readonly string[],
  hours: readonly number[],
  devices: readonly string[],
): ObservationPoint[] {
  const output: ObservationPoint[] = [];
  let index = 0;
  for (const day of days) {
    for (const hour of hours) {
      for (const device of devices) {
        output.push({ day, hour, deviceDay: `${device}-${index}`, stopCode: 'BMS-A12' });
        index += 1;
      }
    }
  }
  return output;
}

const WEEK = [
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
];

describe('analyzeRepresentativeness temporal coverage', () => {
  it('counts observed and missing hours inside the service window', () => {
    const report = analyzeRepresentativeness({
      observations: [
        point({ hour: 6 }),
        point({ hour: 7, deviceDay: 'b' }),
        point({ hour: 9, deviceDay: 'c' }),
      ],
      serviceWindow: { startHour: 6, endHour: 9 },
    });
    expect(report.temporal.observedHours).toEqual([6, 7, 9]);
    expect(report.temporal.missingHours).toEqual([8]);
    expect(report.temporal.coverageRatio).toBeCloseTo(0.75, 3);
  });

  it('ignores hours outside the declared window when scoring', () => {
    const report = analyzeRepresentativeness({
      observations: [point({ hour: 3 }), point({ hour: 8, deviceDay: 'b' })],
      serviceWindow: { startHour: 6, endHour: 10 },
    });
    expect(report.temporal.coverageRatio).toBeCloseTo(0.2, 3);
  });

  it('computes the imbalance between the busiest and quietest covered hour', () => {
    const observations: ObservationPoint[] = [];
    for (let index = 0; index < 10; index += 1) {
      observations.push(point({ hour: 7, deviceDay: `d${index}` }));
    }
    observations.push(point({ hour: 8, deviceDay: 'solo' }));
    const report = analyzeRepresentativeness({
      observations,
      serviceWindow: { startHour: 7, endHour: 8 },
    });
    expect(report.temporal.imbalanceRatio).toBe(10);
    expect(report.warnings.map((warning) => warning.code)).toContain('hour_imbalance');
  });

  it('handles a window that wraps midnight', () => {
    const hours = serviceWindowHours({ startHour: 22, endHour: 2 });
    expect(hours).toEqual([0, 1, 2, 22, 23]);
  });

  it('clamps invalid hours into a safe bucket instead of throwing', () => {
    const report = analyzeRepresentativeness({
      observations: [point({ hour: 99 })],
      serviceWindow: { startHour: 0, endHour: 23 },
    });
    expect(report.sample).toBe(1);
    expect(report.temporal.observedHours).toEqual([0]);
  });
});

describe('analyzeRepresentativeness day coverage', () => {
  it('separates weekday and weekend observations', () => {
    const report = analyzeRepresentativeness({
      observations: [
        point({ day: '2026-10-12', deviceDay: 'a' }),
        point({ day: '2026-10-17', deviceDay: 'b' }),
        point({ day: '2026-10-18', deviceDay: 'c' }),
      ],
    });
    expect(report.days.weekdayCount).toBe(1);
    expect(report.days.weekendCount).toBe(2);
    expect(report.days.weekdayShare).toBeCloseTo(0.333, 3);
  });

  it('flags a sample that never covers a weekend', () => {
    const report = analyzeRepresentativeness({
      observations: spread(['2026-10-12', '2026-10-13'], [7, 8], ['a', 'b']),
    });
    expect(report.warnings.map((warning) => warning.code)).toContain('weekend_missing');
  });

  it('counts gaps inside the observed span', () => {
    const report = analyzeRepresentativeness({
      observations: [
        point({ day: '2026-10-12', deviceDay: 'a' }),
        point({ day: '2026-10-15', deviceDay: 'b' }),
      ],
    });
    expect(report.days.uniqueDays).toBe(2);
    expect(report.days.spanDays).toBe(4);
    expect(report.days.gapDays).toBe(2);
    expect(report.warnings.map((warning) => warning.code)).toContain('day_gap');
  });

  it('flags a single day of observations', () => {
    const report = analyzeRepresentativeness({
      observations: spread(['2026-10-12'], [7, 8, 9], ['a', 'b', 'c']),
    });
    expect(report.days.uniqueDays).toBe(1);
    expect(report.warnings.map((warning) => warning.code)).toContain('single_day');
    expect(report.representativenessLimitedTo).toBe('satu hari pengamatan');
  });
});

describe('analyzeRepresentativeness device concentration', () => {
  it('detects a single device day', () => {
    const report = analyzeRepresentativeness({
      observations: [point(), point({ hour: 8 }), point({ hour: 9 })],
    });
    expect(report.devices.uniqueDeviceDays).toBe(1);
    expect(report.devices.band).toBe('single_device');
    expect(report.warnings.map((warning) => warning.code)).toContain('single_device');
  });

  it('flags a dominant device without declaring a single device', () => {
    const observations: ObservationPoint[] = [];
    for (let index = 0; index < 8; index += 1) {
      observations.push(point({ hour: 7, deviceDay: 'dominant' }));
    }
    for (let index = 0; index < 2; index += 1) {
      observations.push(point({ hour: 8, deviceDay: `other-${index}` }));
    }
    const report = analyzeRepresentativeness({ observations });
    expect(report.devices.band).toBe('concentrated');
    expect(report.devices.topShare).toBeCloseTo(0.8, 2);
    expect(report.warnings.map((warning) => warning.code)).toContain('device_concentrated');
  });

  it('reports a diffuse distribution for many small contributors', () => {
    const report = analyzeRepresentativeness({
      observations: spread(['2026-10-12', '2026-10-13'], [7, 8], ['a', 'b', 'c', 'd', 'e']),
    });
    expect(report.devices.uniqueDeviceDays).toBe(20);
    expect(report.devices.band).toBe('diffuse');
    expect(report.devices.effectiveDeviceDays).toBeGreaterThan(15);
  });

  it('keeps the Herfindahl index inside the unit interval', () => {
    const report = analyzeRepresentativeness({
      observations: spread(WEEK, [7, 8, 9], ['a', 'b']),
    });
    expect(report.devices.hhi).toBeGreaterThan(0);
    expect(report.devices.hhi).toBeLessThanOrEqual(1);
  });
});

describe('analyzeRepresentativeness stop coverage', () => {
  it('computes the stop ratio against a known universe', () => {
    const report = analyzeRepresentativeness({
      observations: [
        point({ stopCode: 'S1' }),
        point({ stopCode: 'S2', deviceDay: 'b' }),
      ],
      universeStops: 10,
    });
    expect(report.stops.observed).toBe(2);
    expect(report.stops.ratio).toBeCloseTo(0.2, 3);
    expect(report.warnings.map((warning) => warning.code)).toContain('stop_coverage_low');
  });

  it('reports an unknown universe honestly instead of assuming totality', () => {
    const report = analyzeRepresentativeness({
      observations: [point()],
    });
    expect(report.stops.universe).toBeNull();
    expect(report.stops.ratio).toBeNull();
    expect(report.warnings.map((warning) => warning.code)).toContain('universe_unknown');
  });
});

describe('analyzeRepresentativeness overall', () => {
  it('returns a defensible score for a broad week of observations', () => {
    const stops = ['S1', 'S2', 'S3', 'S4'];
    const observations: ObservationPoint[] = [];
    let index = 0;
    for (const day of WEEK) {
      for (const hour of [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]) {
        for (const stopCode of stops) {
          observations.push({ day, hour, deviceDay: `d${index}`, stopCode });
          index += 1;
        }
      }
    }
    const report = analyzeRepresentativeness({
      observations,
      universeStops: stops.length,
    });
    expect(report.score).toBeGreaterThan(0.7);
    expect(report.band).toBe('high');
    expect(report.representativenessLimitedTo).toBeNull();
  });

  it('returns zero and a single message when there is no data', () => {
    const report = analyzeRepresentativeness({ observations: [] });
    expect(report.sample).toBe(0);
    expect(report.score).toBe(0);
    expect(report.warnings.map((warning) => warning.code)).toEqual(['no_observations']);
    expect(describeRepresentativeness(report)).toEqual([
      'Belum ada observasi; belum ada yang bisa disimpulkan.',
    ]);
  });

  it('phrases the limitation instead of a generic warning', () => {
    const report = analyzeRepresentativeness({
      observations: spread(['2026-10-12'], [7, 8, 9], ['a', 'b', 'c']),
    });
    const lines = describeRepresentativeness(report);
    expect(lines[0]).toContain('hanya mewakili');
    expect(lines.join(' ')).toContain('satu hari pengamatan');
  });

  it('never claims full service coverage from a narrow window', () => {
    const report = analyzeRepresentativeness({
      observations: spread(['2026-10-12', '2026-10-13'], [7, 8], ['a', 'b']),
    });
    const lines = describeRepresentativeness(report);
    expect(lines.join(' ')).not.toContain('keseluruhan jadwal layanan cukup');
    expect(report.band).not.toBe('high');
  });
});
