export const PROVENANCE_SCHEMA_VERSION = 1;
export const PROV_NAMESPACE = 'http://www.w3.org/ns/prov#';
export const HADIR_NS = 'urn:hadir:';

export type ProvenanceSourceKind =
  | 'citizen_observation'
  | 'service_commitment'
  | 'operational_notice'
  | 'gtfs_snapshot'
  | 'gps_snapshot'
  | 'report';

export type ProvenanceAgentRole = 'software' | 'human' | 'organization';

export interface ObservationRow {
  day: string;
  hour: number;
  outcome: string;
  durationS: number;
  deviceDayHash: string;
  qualityFlags: readonly string[];
}

export interface ProvenanceSource {
  kind: ProvenanceSourceKind;
  ref: string;
  retrievedAt: string | null;
  url: string | null;
}

export interface ProvenanceEntity {
  provType: 'prov:Entity';
  id: string;
  label: string;
  digest: string;
  generatedBy: string;
  derivedFrom: readonly string[];
}

export interface ProvenanceActivity {
  provType: 'prov:Activity';
  id: string;
  methodVersion: string;
  startedAt: string;
  endedAt: string;
  used: readonly string[];
  generated: readonly string[];
}

export interface ProvenanceAgent {
  provType: 'prov:Agent';
  id: string;
  role: ProvenanceAgentRole;
  label: string;
}

export interface ReproducibilityRecipe {
  methodVersion: string;
  parameters: Readonly<Record<string, unknown>>;
  datasetDigest: string;
  outputDigest: string;
  inputRows: number;
  window: { start: string; end: string };
  steps: readonly string[];
  caveats: readonly string[];
}

export interface ProvenanceDocument {
  schemaVersion: number;
  generatedAt: string;
  subject: { kind: string; ref: string };
  entities: readonly ProvenanceEntity[];
  activity: ProvenanceActivity;
  agents: readonly ProvenanceAgent[];
  sources: readonly ProvenanceSource[];
  reproducibility: ReproducibilityRecipe;
}

export interface ProvenanceInput {
  subject: { kind: string; ref: string };
  methodVersion: string;
  parameters: Readonly<Record<string, unknown>>;
  dataset: {
    canonical: string;
    digestHex: string;
    rows: number;
    firstDay: string | null;
    lastDay: string | null;
  };
  outputDigestHex: string;
  agent: { id: string; role: ProvenanceAgentRole; label: string };
  activityStart: string;
  activityEnd: string;
  sources: readonly ProvenanceSource[];
}

export interface ReproducibilityVerdict {
  reproducible: boolean;
  differences: readonly string[];
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function normaliseFlag(flag: string): string {
  return flag.trim().toLowerCase().slice(0, 40);
}

function normaliseNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'nan';
  }
  return Number.isInteger(value) ? value.toString() : value.toFixed(3);
}

export function canonicalObservationLine(row: ObservationRow): string {
  const flags = [...new Set(row.qualityFlags.map(normaliseFlag))]
    .filter((flag) => flag.length > 0)
    .sort()
    .join('|');
  return [
    row.day,
    pad(Math.min(23, Math.max(0, Math.trunc(row.hour)))),
    row.outcome,
    normaliseNumber(row.durationS),
    row.deviceDayHash.slice(0, 64),
    flags,
  ].join('\t');
}

export function canonicalDataset(rows: readonly ObservationRow[]): string {
  return rows
    .map(canonicalObservationLine)
    .slice()
    .sort()
    .join('\n');
}

export interface DatasetShape {
  rows: number;
  days: number;
  hours: number;
  firstDay: string | null;
  lastDay: string | null;
}

export function datasetShape(rows: readonly ObservationRow[]): DatasetShape {
  const days = new Set<string>();
  const hours = new Set<number>();
  let firstDay: string | null = null;
  let lastDay: string | null = null;
  for (const row of rows) {
    days.add(row.day);
    hours.add(Math.min(23, Math.max(0, Math.trunc(row.hour))));
    if (firstDay === null || row.day < firstDay) {
      firstDay = row.day;
    }
    if (lastDay === null || row.day > lastDay) {
      lastDay = row.day;
    }
  }
  return {
    rows: rows.length,
    days: days.size,
    hours: hours.size,
    firstDay,
    lastDay,
  };
}

export function datasetEntityId(subjectKind: string, subjectRef: string): string {
  return `${HADIR_NS}dataset/${subjectKind}/${subjectRef}`;
}

export function activityIdFor(methodVersion: string): string {
  return `${HADIR_NS}activity/estimate/${methodVersion}`;
}

export function outputEntityId(subjectKind: string, subjectRef: string): string {
  return `${HADIR_NS}output/${subjectKind}/${subjectRef}`;
}

export function formatDigest(algorithm: string, hex: string): string {
  return `${algorithm}:${hex.toLowerCase()}`;
}

export function buildProvenance(input: ProvenanceInput): ProvenanceDocument {
  const datasetId = datasetEntityId(input.subject.kind, input.subject.ref);
  const outputId = outputEntityId(input.subject.kind, input.subject.ref);
  const activityId = activityIdFor(input.methodVersion);
  const shape = datasetShape([]);
  void shape;

  const datasetEntity: ProvenanceEntity = {
    provType: 'prov:Entity',
    id: datasetId,
    label: `Himpunan observasi ${input.subject.kind} ${input.subject.ref}`,
    digest: formatDigest('sha256', input.dataset.digestHex),
    generatedBy: `${HADIR_NS}activity/ingest`,
    derivedFrom: [],
  };

  const outputEntity: ProvenanceEntity = {
    provType: 'prov:Entity',
    id: outputId,
    label: `Keluaran estimasi ${input.subject.kind} ${input.subject.ref}`,
    digest: formatDigest('sha256', input.outputDigestHex),
    generatedBy: activityId,
    derivedFrom: [datasetId],
  };

  const activity: ProvenanceActivity = {
    provType: 'prov:Activity',
    id: activityId,
    methodVersion: input.methodVersion,
    startedAt: input.activityStart,
    endedAt: input.activityEnd,
    used: [datasetId, ...input.sources.map((source) => source.ref)],
    generated: [outputId],
  };

  const agents: ProvenanceAgent[] = [
    { provType: 'prov:Agent', id: input.agent.id, role: input.agent.role, label: input.agent.label },
  ];

  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    generatedAt: input.activityEnd,
    subject: input.subject,
    entities: [datasetEntity, outputEntity],
    activity,
    agents,
    sources: input.sources,
    reproducibility: {
      methodVersion: input.methodVersion,
      parameters: input.parameters,
      datasetDigest: formatDigest('sha256', input.dataset.digestHex),
      outputDigest: formatDigest('sha256', input.outputDigestHex),
      inputRows: input.dataset.rows,
      window: {
        start: input.dataset.firstDay === null ? input.activityStart : `${input.dataset.firstDay}T00:00:00.000Z`,
        end: input.dataset.lastDay === null ? input.activityEnd : `${input.dataset.lastDay}T23:59:59.999Z`,
      },
      steps: reproducibilitySteps(input.methodVersion),
      caveats: reproducibilityCaveats(),
    },
  };
}

export function reproducibilitySteps(methodVersion: string): readonly string[] {
  return Object.freeze([
    '1. Kumpulkan baris observasi pada jendela waktu yang tercatat, sertakan hanya episode dengan outcome dikenal dan durasi ≥ 30 detik.',
    '2. Susun ulang bentuk kanonik: satu baris per observasi, kolom dipisah TAB, urutan kolom hari, jam, outcome, durasi, hash perangkat-harian, flag kualitas; lalu urutkan baris dan gabung dengan baris baru.',
    `3. Hitung SHA-256 atas bentuk kanonik itu dan bandingkan dengan datasetDigest. Harus sama persis.`,
    `4. Jalankan estimator ${methodVersion} dengan parameters yang tercatat, seed tetap, dan jumlah iterasi bootstrap yang sama.`,
    '5. Hitung SHA-256 atas keluaran kanonik dan bandingkan dengan outputDigest.',
    '6. Jika salah satu digest berbeda, hasil tidak dapat direproduksi: periksa versi data atau versi metode.',
  ]);
}

export function reproducibilityCaveats(): readonly string[] {
  return Object.freeze([
    'Reproduksi hanya sah bila datasetDigest sama; data yang bertambah akan mengubah digest dan menghasilkan keluaran berbeda secara sah.',
    'Bootstrap memakai seed tetap, sehingga selisih angka bukan berasal dari keacakan.',
    'Hash perangkat-harian bersifat pseudonim dan berotasi tiap hari; dua hari berbeda tidak dapat dihubungkan.',
    'Provenance membuktikan ketertelusuran proses, bukan kebenaran isi laporan.',
  ]);
}

function readString(source: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(source: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function verifyReproducibility(
  declared: ReproducibilityRecipe,
  actual: {
    methodVersion: string;
    datasetDigest: string;
    outputDigest?: string | null;
    inputRows?: number | null;
    parameters?: Readonly<Record<string, unknown>> | null;
  },
): ReproducibilityVerdict {
  const differences: string[] = [];

  if (declared.methodVersion !== actual.methodVersion) {
    differences.push(
      `methodVersion: tercatat ${declared.methodVersion}, dijalankan ${actual.methodVersion}`,
    );
  }

  const declaredDigest = declared.datasetDigest.toLowerCase();
  const actualDigest = formatDigest('sha256', actual.datasetDigest).toLowerCase();
  if (declaredDigest !== actualDigest) {
    differences.push(`datasetDigest: tercatat ${declaredDigest}, dihitung ${actualDigest}`);
  }

  if (actual.outputDigest != null) {
    const declaredOutput = declared.outputDigest.toLowerCase();
    const actualOutput = formatDigest('sha256', actual.outputDigest).toLowerCase();
    if (declaredOutput !== actualOutput) {
      differences.push(`outputDigest: tercatat ${declaredOutput}, dihitung ${actualOutput}`);
    }
  }

  if (actual.inputRows != null && actual.inputRows !== declared.inputRows) {
    differences.push(`inputRows: tercatat ${declared.inputRows}, dihitung ${actual.inputRows}`);
  }

  if (actual.parameters != null) {
    for (const key of Object.keys(declared.parameters).sort()) {
      const declaredValue = declared.parameters[key];
      const actualValue = actual.parameters[key];
      if (JSON.stringify(declaredValue) !== JSON.stringify(actualValue)) {
        differences.push(
          `parameters.${key}: tercatat ${JSON.stringify(declaredValue)}, dijalankan ${JSON.stringify(actualValue)}`,
        );
      }
    }
  }

  return { reproducible: differences.length === 0, differences };
}

export function summariseProvenance(document: ProvenanceDocument): string[] {
  const lines: string[] = [];
  lines.push(
    `Metode ${document.reproducibility.methodVersion}, ${document.reproducibility.inputRows} baris masukan.`,
  );
  lines.push(`Digest dataset ${document.reproducibility.datasetDigest}.`);
  lines.push(`Digest keluaran ${document.reproducibility.outputDigest}.`);
  const sources = document.sources.length;
  lines.push(
    sources === 0
      ? 'Tidak ada sumber eksternal yang dicatat.'
      : `${sources} sumber eksternal dicatat (${[...new Set(document.sources.map((source) => source.kind))].join(', ')}).`,
  );
  return lines;
}

export function sourceLabel(kind: ProvenanceSourceKind): string {
  const labels: Readonly<Record<ProvenanceSourceKind, string>> = {
    citizen_observation: 'observasi warga',
    service_commitment: 'dokumen janji layanan',
    operational_notice: 'pengumuman operasional',
    gtfs_snapshot: 'snapshot GTFS',
    gps_snapshot: 'snapshot GPS kendaraan',
    report: 'laporan warga',
  };
  return labels[kind];
}

export function parametersFingerprint(
  parameters: Readonly<Record<string, unknown>>,
): string {
  return Object.keys(parameters)
    .sort()
    .map((key) => `${key}=${JSON.stringify(parameters[key])}`)
    .join(';');
}

export function readRecipeParameters(
  raw: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(raw).sort()) {
    const value = raw[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      output[key] = value;
    }
  }
  return output;
}

export function recipeParameter(
  recipe: ReproducibilityRecipe,
  key: string,
): string | number | boolean | null {
  const scalar = readString(recipe.parameters as Record<string, unknown>, key);
  if (scalar !== null) {
    return scalar;
  }
  return readNumber(recipe.parameters as Record<string, unknown>, key);
}
