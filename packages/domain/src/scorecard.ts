import { qualityBandOf, type QualityBand } from './quality';

export type ScorecardDimension =
  | 'responsiveness'
  | 'timeliness'
  | 'resolutionIntegrity'
  | 'appealFairness';

export type ScorecardState = 'insufficient' | 'provisional' | 'published';

export interface ScorecardInput {
  reportsReceived: number;
  reportsAcknowledged: number;
  reportsResponded: number;
  slaTracked: number;
  slaMet: number;
  claimsResolved: number;
  claimsVerified: number;
  claimsDisputed: number;
  appealsDecided: number;
  appealsOverturned: number;
  windowDays: number;
}

export interface ScorecardDimensionResult {
  dimension: ScorecardDimension;
  value: number | null;
  band: QualityBand;
  numerator: number;
  denominator: number;
  label: string;
}

export interface Scorecard {
  state: ScorecardState;
  dimensions: readonly ScorecardDimensionResult[];
  overall: number | null;
  band: QualityBand;
  windowDays: number;
  sample: { reportsReceived: number; slaTracked: number; appealsDecided: number };
  warnings: readonly string[];
  summary: string;
}

export const MIN_REPORTS_FOR_PUBLICATION = 20;
export const MIN_SLA_FOR_PUBLICATION = 10;
export const MIN_APPEALS_FOR_FAIRNESS = 5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return clamp01(numerator / denominator);
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function dimension(
  key: ScorecardDimension,
  numerator: number,
  denominator: number,
  label: string,
  value = ratio(numerator, denominator),
): ScorecardDimensionResult {
  return {
    dimension: key,
    value: value === null ? null : round3(value),
    band: qualityBandOf(value ?? 0),
    numerator,
    denominator,
    label,
  };
}

export function scorecardState(input: ScorecardInput): ScorecardState {
  if (input.reportsReceived < MIN_REPORTS_FOR_PUBLICATION) {
    return 'insufficient';
  }
  if (input.slaTracked < MIN_SLA_FOR_PUBLICATION) {
    return 'provisional';
  }
  return 'published';
}

export function scorecardFor(input: ScorecardInput): Scorecard {
  const responsiveness = dimension(
    'responsiveness',
    input.reportsAcknowledged,
    input.reportsReceived,
    'Laporan yang pernah diakui',
  );
  const timeliness = dimension(
    'timeliness',
    input.slaMet,
    input.slaTracked,
    'Tenggat yang dipenuhi',
  );
  const resolutionIntegrity = dimension(
    'resolutionIntegrity',
    input.claimsVerified,
    input.claimsResolved,
    'Klaim selesai yang terbukti',
  );
  const appealFairness = dimension(
    'appealFairness',
    input.appealsDecided - input.appealsOverturned,
    input.appealsDecided,
    'Banding yang dipertahankan',
  );

  const dimensions = [
    responsiveness,
    timeliness,
    resolutionIntegrity,
    appealFairness,
  ] as const;

  const warnings: string[] = [];
  if (input.reportsReceived < MIN_REPORTS_FOR_PUBLICATION) {
    warnings.push(
      `Sampel ${input.reportsReceived} laporan di bawah ambang ${MIN_REPORTS_FOR_PUBLICATION}; angka tidak dipublikasikan.`,
    );
  }
  if (input.slaTracked < MIN_SLA_FOR_PUBLICATION) {
    warnings.push(
      `Hanya ${input.slaTracked} laporan punya catatan tenggat; ketepatan waktu belum stabil.`,
    );
  }
  if (input.appealsDecided < MIN_APPEALS_FOR_FAIRNESS) {
    warnings.push(
      `Banding yang diputuskan baru ${input.appealsDecided}; keadilan banding belum dapat dinilai.`,
    );
  }
  if (input.claimsDisputed > 0) {
    warnings.push(
      `${input.claimsDisputed} klaim selesai dibantah; ini dihitung sebagai kegagalan integritas, bukan penundaan.`,
    );
  }

  const available = dimensions
    .map((entry) => entry.value)
    .filter((value): value is number => value !== null);
  const overall =
    available.length === 0
      ? null
      : round3(available.reduce((sum, value) => sum + value, 0) / available.length);

  const state = scorecardState(input);

  return {
    state,
    dimensions,
    overall: state === 'insufficient' ? null : overall,
    band: qualityBandOf(overall ?? 0),
    windowDays: input.windowDays,
    sample: {
      reportsReceived: input.reportsReceived,
      slaTracked: input.slaTracked,
      appealsDecided: input.appealsDecided,
    },
    warnings,
    summary: summariseScorecard(state, overall, warnings.length),
  };
}

function summariseScorecard(
  state: ScorecardState,
  overall: number | null,
  warningCount: number,
): string {
  if (state === 'insufficient') {
    return 'Data belum cukup untuk menilai kinerja instansi ini. Tidak ada angka yang dipublikasikan.';
  }
  if (state === 'provisional') {
    return `Angka sementara (${Math.round((overall ?? 0) * 100)} dari 100) karena catatan tenggat masih sedikit.`;
  }
  const suffix = warningCount === 0 ? '' : ` ${warningCount} catatan perlu dibaca.`;
  return `Kinerja proses ${Math.round((overall ?? 0) * 100)} dari 100.${suffix}`;
}

export interface InstitutionRanking {
  institutionId: string;
  name: string;
  scorecard: Scorecard;
  rank: number | null;
}

export function rankInstitutions(entries: readonly InstitutionRanking[]): InstitutionRanking[] {
  const publishable = entries
    .filter((entry) => entry.scorecard.state === 'published' && entry.scorecard.overall !== null)
    .sort((left, right) => (right.scorecard.overall ?? 0) - (left.scorecard.overall ?? 0));
  const ranked = new Map<string, number>();
  publishable.forEach((entry, index) => {
    ranked.set(entry.institutionId, index + 1);
  });
  return entries.map((entry) => ({
    ...entry,
    rank: ranked.get(entry.institutionId) ?? null,
  }));
}

export function scorecardCaveats(): readonly string[] {
  return [
    'Skor mengukur proses yang tercatat, bukan kepuasan warga.',
    'Instansi dengan laporan sedikit tidak diberi peringkat sama sekali.',
    'Skor tidak membandingkan kota yang berbeda beban laporan.',
    'Mengabulkan banding dihitung sebagai kegagalan mutu keputusan, bukan kegagalan proses banding.',
    'Tidak ada skor yang dihitung dari laporan yang ditolak moderasi.',
  ];
}

export function describeScorecard(scorecard: Scorecard): string {
  if (scorecard.state === 'insufficient') {
    return 'Belum cukup data untuk menilai instansi ini.';
  }
  const worst = [...scorecard.dimensions]
    .filter((entry) => entry.value !== null)
    .sort((left, right) => (left.value ?? 0) - (right.value ?? 0))[0];
  if (worst === undefined) {
    return scorecard.summary;
  }
  return `${scorecard.summary} Dimensi terlemah: ${worst.label} (${Math.round((worst.value ?? 0) * 100)}%).`;
}
