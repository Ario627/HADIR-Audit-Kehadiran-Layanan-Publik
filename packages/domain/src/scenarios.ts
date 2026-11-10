import { mulberry32 } from './bootstrap';
import type { Direction, EvidenceLevel } from './evidence';
import {
  estimateWait,
  type WaitEpisodeInput,
  type WaitEstimate,
  type WaitOutcome,
} from './estimator';

export interface ScenarioExpectation {
  direction?: Direction;
  evidenceMax?: EvidenceLevel;
  evidenceExact?: EvidenceLevel;
  mustWarn?: readonly string[];
  mustNotWarn?: readonly string[];
  ewtRange?: { min: number; max: number };
  minAbandonRate?: number;
  minN?: number;
  maxN?: number;
  simulatedFlag?: boolean;
}

export interface Scenario {
  id: string;
  title: string;
  summary: string;
  headwayMinutes: number | null;
  episodes: readonly WaitEpisodeInput[];
  expectation: ScenarioExpectation;
}

export interface ScenarioFailure {
  check: string;
  expected: string;
  actual: string;
}

export interface ScenarioResult {
  id: string;
  passed: boolean;
  failures: readonly ScenarioFailure[];
  estimate: WaitEstimate;
}

export interface ScenarioSummary {
  total: number;
  passed: number;
  failed: number;
  results: readonly ScenarioResult[];
}

const DAYS = [
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
];

const SCENARIO_ITERATIONS = 200;
const SCENARIO_SEED = 20261024;

function hexDevice(index: number): string {
  return (index + 1).toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

function normal(random: () => number, mean: number, sd: number): number {
  const u1 = Math.max(random(), 1e-9);
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sd;
}

interface EpisodeSpec {
  days: readonly string[];
  hours: readonly number[];
  perCluster: number;
  meanMin: number;
  sdMin: number;
  deviceOffset: number;
  outcome: WaitOutcome;
  trustWeight: number;
  qualityFlags: readonly string[];
  seed: number;
}

function buildEpisodes(spec: EpisodeSpec): WaitEpisodeInput[] {
  const random = mulberry32(spec.seed);
  const episodes: WaitEpisodeInput[] = [];
  let deviceIndex = spec.deviceOffset;
  for (const day of spec.days) {
    for (const hour of spec.hours) {
      for (let index = 0; index < spec.perCluster; index += 1) {
        const minutes = Math.max(0.5, normal(random, spec.meanMin, spec.sdMin));
        episodes.push({
          durationS: Math.round(minutes * 60),
          outcome: spec.outcome,
          deviceHash: hexDevice(deviceIndex),
          day,
          hour,
          trustWeight: spec.trustWeight,
          qualityFlags: spec.qualityFlags,
        });
        deviceIndex += 1;
      }
    }
  }
  return episodes;
}

function excessWaitScenario(): Scenario {
  return {
    id: 'excess-wait',
    title: 'Layanan lambat dengan cakupan hari dan jam cukup',
    summary:
      'Enam hari pengamatan, dua jam berbeda per hari, headway janji 12 menit, waktu tunggu teramati jauh di atas ambang.',
    headwayMinutes: 12,
    episodes: buildEpisodes({
      days: DAYS,
      hours: [7, 17],
      perCluster: 6,
      meanMin: 16,
      sdMin: 2.5,
      deviceOffset: 1_000,
      outcome: 'boarded',
      trustWeight: 0.9,
      qualityFlags: [],
      seed: SCENARIO_SEED + 1,
    }),
    expectation: {
      direction: 'excess',
      evidenceMax: 'strong',
      minN: 60,
    },
  };
}

function withinScheduleScenario(): Scenario {
  return {
    id: 'within-schedule',
    title: 'Waktu tunggu di bawah ambang',
    summary:
      'Headway janji 12 menit, waktu tunggu teramati sekitar 4 menit, sehingga tidak boleh dinyatakan melebihi janji.',
    headwayMinutes: 12,
    episodes: buildEpisodes({
      days: DAYS,
      hours: [7, 17],
      perCluster: 6,
      meanMin: 4,
      sdMin: 0.8,
      deviceOffset: 2_000,
      outcome: 'boarded',
      trustWeight: 0.9,
      qualityFlags: [],
      seed: SCENARIO_SEED + 2,
    }),
    expectation: {
      direction: 'no_excess',
      evidenceExact: 'none',
      mustNotWarn: ['small_n'],
    },
  };
}

function singleDeviceFloodScenario(): Scenario {
  return {
    id: 'single-device-flood',
    title: 'Banyak observasi dari satu perangkat, satu hari, satu jam',
    summary:
      'Empat puluh observasi tetapi semuanya dari satu identitas perangkat-harian pada satu klaster.',
    headwayMinutes: 12,
    episodes: buildEpisodes({
      days: [DAYS[0]!],
      hours: [8],
      perCluster: 40,
      meanMin: 20,
      sdMin: 2,
      deviceOffset: 3_000,
      outcome: 'boarded',
      trustWeight: 0.9,
      qualityFlags: [],
      seed: SCENARIO_SEED + 3,
    }),
    expectation: {
      direction: 'inconclusive',
      evidenceExact: 'none',
      mustWarn: ['small_cluster_count'],
    },
  };
}

function singleDayManyHoursScenario(): Scenario {
  return {
    id: 'single-day-many-hours',
    title: 'Cakupan jam lebar tetapi hanya satu hari',
    summary:
      'Tiga puluh enam observasi tersebar pada dua belas jam, tetapi seluruhnya dari satu hari sehingga tidak boleh naik ke bukti kuat.',
    headwayMinutes: 12,
    episodes: buildEpisodes({
      days: [DAYS[0]!],
      hours: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      perCluster: 3,
      meanMin: 18,
      sdMin: 2,
      deviceOffset: 4_000,
      outcome: 'boarded',
      trustWeight: 0.9,
      qualityFlags: [],
      seed: SCENARIO_SEED + 4,
    }),
    expectation: {
      direction: 'excess',
      evidenceMax: 'indication',
      minN: 30,
    },
  };
}

function sparseScenario(): Scenario {
  return {
    id: 'sparse',
    title: 'Observasi terlalu sedikit untuk menyimpulkan',
    summary:
      'Enam observasi tersebar pada tiga hari; sistem harus menahan diri dan menyatakan bukti belum cukup.',
    headwayMinutes: 12,
    episodes: buildEpisodes({
      days: DAYS.slice(0, 3),
      hours: [8],
      perCluster: 2,
      meanMin: 25,
      sdMin: 1,
      deviceOffset: 5_000,
      outcome: 'boarded',
      trustWeight: 0.9,
      qualityFlags: [],
      seed: SCENARIO_SEED + 5,
    }),
    expectation: {
      evidenceExact: 'none',
      mustWarn: ['small_n'],
      maxN: 10,
    },
  };
}

function noDataScenario(): Scenario {
  return {
    id: 'no-data',
    title: 'Belum ada data',
    summary: 'Tidak ada episode yang dapat dianalisis; semua angka harus kosong.',
    headwayMinutes: 12,
    episodes: [],
    expectation: {
      evidenceExact: 'none',
      mustWarn: ['no_data'],
      maxN: 0,
    },
  };
}

function simulatedMixedScenario(): Scenario {
  const real = buildEpisodes({
    days: DAYS,
    hours: [7, 17],
    perCluster: 5,
    meanMin: 14,
    sdMin: 2,
    deviceOffset: 6_000,
    outcome: 'boarded',
    trustWeight: 0.9,
    qualityFlags: [],
    seed: SCENARIO_SEED + 6,
  });
  const simulated = buildEpisodes({
    days: DAYS,
    hours: [7, 17],
    perCluster: 4,
    meanMin: 30,
    sdMin: 1,
    deviceOffset: 7_000,
    outcome: 'boarded',
    trustWeight: 0.9,
    qualityFlags: ['simulated'],
    seed: SCENARIO_SEED + 7,
  });
  return {
    id: 'simulated-mixed',
    title: 'Data simulasi bercampur data nyata',
    summary:
      'Enam puluh episode nyata ditambah empat puluh delapan episode simulasi; estimasi tidak boleh menyerap data simulasi.',
    headwayMinutes: 12,
    episodes: [...real, ...simulated],
    expectation: {
      simulatedFlag: true,
      minN: 55,
      maxN: 65,
    },
  };
}

function abandonmentScenario(): Scenario {
  return {
    id: 'abandonment-heavy',
    title: 'Banyak penumpang menyerah',
    summary:
      'Separuh observasi berakhir dengan menyerah; laju penyerahan harus tampak, bukan tersembunyi.',
    headwayMinutes: 15,
    episodes: buildEpisodes({
      days: DAYS,
      hours: [7, 17],
      perCluster: 5,
      meanMin: 40,
      sdMin: 5,
      deviceOffset: 8_000,
      outcome: 'abandoned',
      trustWeight: 0.9,
      qualityFlags: [],
      seed: SCENARIO_SEED + 8,
    }),
    expectation: {
      minAbandonRate: 0.9,
      mustNotWarn: ['no_data'],
    },
  };
}

function excludedRowsScenario(): Scenario {
  const kept = buildEpisodes({
    days: DAYS,
    hours: [7, 17],
    perCluster: 5,
    meanMin: 15,
    sdMin: 2,
    deviceOffset: 9_000,
    outcome: 'boarded',
    trustWeight: 0.9,
    qualityFlags: [],
    seed: SCENARIO_SEED + 9,
  });
  const anomalous = buildEpisodes({
    days: DAYS,
    hours: [7, 17],
    perCluster: 5,
    meanMin: 15,
    sdMin: 2,
    deviceOffset: 9_500,
    outcome: 'boarded',
    trustWeight: 0.9,
    qualityFlags: ['cluster_anomaly'],
    seed: SCENARIO_SEED + 10,
  });
  const cancelled = buildEpisodes({
    days: DAYS,
    hours: [7, 17],
    perCluster: 5,
    meanMin: 15,
    sdMin: 2,
    deviceOffset: 9_800,
    outcome: 'cancelled',
    trustWeight: 0.9,
    qualityFlags: [],
    seed: SCENARIO_SEED + 11,
  });
  return {
    id: 'excluded-rows',
    title: 'Baris yang harus dibuang',
    summary:
      'Episode bertanda anomali klaster dan episode batal tidak boleh masuk ke perhitungan.',
    headwayMinutes: 12,
    episodes: [...kept, ...anomalous, ...cancelled],
    expectation: {
      maxN: 60,
      minN: 60,
    },
  };
}

function lowTrustScenario(): Scenario {
  return {
    id: 'low-trust-dominant',
    title: 'Mayoritas observasi berbobot kepercayaan rendah',
    summary:
      'Seluruh observasi berasal dari perangkat dengan kepercayaan rendah; estimasi harus memberi peringatan.',
    headwayMinutes: 12,
    episodes: buildEpisodes({
      days: DAYS,
      hours: [7, 17],
      perCluster: 5,
      meanMin: 14,
      sdMin: 2,
      deviceOffset: 10_000,
      outcome: 'boarded',
      trustWeight: 0.2,
      qualityFlags: [],
      seed: SCENARIO_SEED + 12,
    }),
    expectation: {
      mustWarn: ['low_trust_dominant'],
    },
  };
}

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  excessWaitScenario(),
  withinScheduleScenario(),
  singleDeviceFloodScenario(),
  singleDayManyHoursScenario(),
  sparseScenario(),
  noDataScenario(),
  simulatedMixedScenario(),
  abandonmentScenario(),
  excludedRowsScenario(),
  lowTrustScenario(),
]);

function formatValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.join(',')}]`;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function checkDirection(
  expectation: ScenarioExpectation,
  estimate: WaitEstimate,
  failures: ScenarioFailure[],
): void {
  if (expectation.direction === undefined) {
    return;
  }
  if (estimate.direction !== expectation.direction) {
    failures.push({
      check: 'direction',
      expected: expectation.direction,
      actual: estimate.direction,
    });
  }
}

function checkEvidence(
  expectation: ScenarioExpectation,
  estimate: WaitEstimate,
  failures: ScenarioFailure[],
): void {
  if (expectation.evidenceExact !== undefined && estimate.evidence !== expectation.evidenceExact) {
    failures.push({
      check: 'evidence_exact',
      expected: expectation.evidenceExact,
      actual: estimate.evidence,
    });
  }
  if (expectation.evidenceMax !== undefined) {
    const order: readonly EvidenceLevel[] = ['none', 'indication', 'strong', 'field_verified'];
    if (order.indexOf(estimate.evidence) > order.indexOf(expectation.evidenceMax)) {
      failures.push({
        check: 'evidence_max',
        expected: `<= ${expectation.evidenceMax}`,
        actual: estimate.evidence,
      });
    }
  }
}

function checkWarnings(
  expectation: ScenarioExpectation,
  estimate: WaitEstimate,
  failures: ScenarioFailure[],
): void {
  for (const warning of expectation.mustWarn ?? []) {
    if (!estimate.warnings.includes(warning)) {
      failures.push({
        check: 'must_warn',
        expected: warning,
        actual: formatValue(estimate.warnings),
      });
    }
  }
  for (const warning of expectation.mustNotWarn ?? []) {
    if (estimate.warnings.includes(warning)) {
      failures.push({
        check: 'must_not_warn',
        expected: `not ${warning}`,
        actual: formatValue(estimate.warnings),
      });
    }
  }
}

function checkNumbers(
  expectation: ScenarioExpectation,
  estimate: WaitEstimate,
  failures: ScenarioFailure[],
): void {
  if (expectation.ewtRange !== undefined) {
    const value = estimate.ewtMin;
    const { min, max } = expectation.ewtRange;
    if (value === null || value < min || value > max) {
      failures.push({
        check: 'ewt_range',
        expected: `${min}..${max}`,
        actual: formatValue(value),
      });
    }
  }
  if (expectation.minAbandonRate !== undefined) {
    const value = estimate.abandonRate ?? 0;
    if (value < expectation.minAbandonRate) {
      failures.push({
        check: 'min_abandon_rate',
        expected: `>= ${expectation.minAbandonRate}`,
        actual: String(value),
      });
    }
  }
  if (expectation.minN !== undefined && estimate.n < expectation.minN) {
    failures.push({
      check: 'min_n',
      expected: `>= ${expectation.minN}`,
      actual: String(estimate.n),
    });
  }
  if (expectation.maxN !== undefined && estimate.n > expectation.maxN) {
    failures.push({
      check: 'max_n',
      expected: `<= ${expectation.maxN}`,
      actual: String(estimate.n),
    });
  }
  if (expectation.simulatedFlag !== undefined && estimate.simulated !== expectation.simulatedFlag) {
    failures.push({
      check: 'simulated_flag',
      expected: String(expectation.simulatedFlag),
      actual: String(estimate.simulated),
    });
  }
}

export function evaluateScenario(scenario: Scenario): ScenarioResult {
  const estimate = estimateWait(scenario.episodes, {
    headwayMinutes: scenario.headwayMinutes,
    bootstrapIterations: SCENARIO_ITERATIONS,
    seed: SCENARIO_SEED,
  });
  const failures: ScenarioFailure[] = [];
  checkDirection(scenario.expectation, estimate, failures);
  checkEvidence(scenario.expectation, estimate, failures);
  checkWarnings(scenario.expectation, estimate, failures);
  checkNumbers(scenario.expectation, estimate, failures);
  return { id: scenario.id, passed: failures.length === 0, failures, estimate };
}

export function evaluateAllScenarios(
  scenarios: readonly Scenario[] = SCENARIOS,
): ScenarioSummary {
  const results = scenarios.map(evaluateScenario);
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

export function findScenario(id: string): Scenario | null {
  return SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}