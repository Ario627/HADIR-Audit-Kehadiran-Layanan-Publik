import type { CaseFile, EvidencePack } from '@hadir/contracts';

type SlaPhase = NonNullable<CaseFile['sla']>['phases'][number];

type Band = 'very_low' | 'low' | 'moderate' | 'high';
type SlaPhaseName = 'acknowledge' | 'respond' | 'resolve';

const BAND_LABEL: Readonly<Record<Band, string>> = {
  very_low: 'sangat rendah',
  low: 'rendah',
  moderate: 'sedang',
  high: 'tinggi',
};

const DIMENSION_LABEL: Readonly<
  Record<EvidencePack['quality']['dimensions'][number]['dimension'], string>
> = {
  strength: 'Kekuatan bukti',
  precision: 'Ketelitian statistik',
  coverage: 'Cakupan pengamatan',
  reliability: 'Keterandalan sumber',
  corroboration: 'Dukungan independen',
};

const BENCHMARK_REASON: Readonly<Record<string, string>> = {
  no_commitment: 'Belum ada janji layanan resmi untuk halte atau koridor ini.',
  not_verified: 'Ada dokumen janji layanan, tetapi belum terverifikasi.',
  outside_validity: 'Janji layanan terverifikasi, tetapi tidak berlaku pada tanggal ini.',
  scope_mismatch: 'Janji layanan yang ada berlaku untuk rute atau halte lain.',
  missing_headway: 'Dokumen janji layanan tidak mencantumkan angka headway.',
};

const SLA_PHASE_LABEL: Readonly<Record<SlaPhaseName, string>> = {
  acknowledge: 'Pengakuan',
  respond: 'Tanggapan',
  resolve: 'Penyelesaian',
};

const SLA_STATE_LABEL: Readonly<Record<string, string>> = {
  not_started: 'belum dihitung',
  pending: 'berjalan',
  met: 'tepat waktu',
  overdue: 'lewat tenggat',
  met_late: 'terlambat',
};

const RESPONSE_KIND_LABEL: Readonly<Record<string, string>> = {
  initial: 'Tanggapan awal',
  follow_up: 'Tindak lanjut',
  closure_claim: 'Klaim selesai',
  correction: 'Koreksi',
};

const VERDICT_LABEL: Readonly<Record<string, string>> = {
  confirmed: 'menguatkan',
  refuted: 'membantah',
  inconclusive: 'belum menyimpulkan',
};

const METHOD_LABEL: Readonly<Record<string, string>> = {
  citizen_confirmation: 'Konfirmasi penumpang',
  field_inspection: 'Pemeriksaan lapangan',
  observation_data: 'Data pengamatan',
  panel_review: 'Tinjauan panel',
};

const IMPACT_LABEL: Readonly<Record<string, string>> = {
  none: 'tanpa gangguan',
  minor: 'gangguan kecil',
  major: 'gangguan besar',
  service_stopped: 'layanan berhenti',
};

const OUTCOME_LABEL: Readonly<Record<CaseFile['resolution']['outcome'], string>> = {
  verified: 'Selesai terverifikasi',
  disputed: 'Klaim selesai dibantah',
  undecided: 'Klaim belum terbukti',
};

const OUTCOME_TONE: Readonly<Record<CaseFile['resolution']['outcome'], string>> = {
  verified: 'verified',
  disputed: 'alert',
  undecided: 'pending',
};

const MILESTONE_LABEL: Readonly<Record<string, string>> = {
  submitted: 'Dikirim',
  triaged: 'Dipilah',
  acknowledged: 'Diakui',
  scheduled: 'Dijadwalkan',
  responded: 'Ditanggapi',
  claimed_resolved: 'Diklaim selesai',
  verified_resolved: 'Terbukti selesai',
  disputed: 'Dibantah',
  rejected: 'Ditolak',
};

export function bandLabel(band: string): string {
  return BAND_LABEL[band as Band] ?? band;
}

export function dimensionLabel(
  dimension: EvidencePack['quality']['dimensions'][number]['dimension'],
): string {
  return DIMENSION_LABEL[dimension];
}

export function milestoneLabel(key: string): string {
  return MILESTONE_LABEL[key] ?? key.replace(/_/gu, ' ');
}

export function percentText(value: number): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${String(Math.round(value * 100))}%`;
}

export function scorePercent(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(100, Math.round(value * 100));
}

export function shortDigest(value: string, length = 12): string {
  const bare = value.replace(/^sha256:/u, '');
  return bare.length <= length ? bare : bare.slice(0, length);
}

export function benchmarkReasonText(reason: string): string {
  return BENCHMARK_REASON[reason] ?? 'Janji layanan tidak tersedia untuk periode ini.';
}

export function benchmarkHeadline(pack: EvidencePack): string {
  if (pack.benchmark.status === 'resolved') {
    return `Janji ${String(pack.benchmark.headwayMin)} menit · ambang ${String(pack.benchmark.thresholdMin)} menit`;
  }
  return 'Tanpa janji layanan';
}

export function benchmarkCaption(pack: EvidencePack): string {
  if (pack.benchmark.status === 'unavailable') {
    return benchmarkReasonText(pack.benchmark.reason);
  }
  const version = pack.benchmark.sourceDocumentVersion;
  const scope = pack.benchmark.specificity === 'stop' ? 'per halte' : 'per koridor';
  return version === null ? `Dokumen resmi ${scope}` : `Dokumen versi ${version} ${scope}`;
}

export function qualityLimitingText(pack: EvidencePack): string {
  return `Penentu terlemah: ${dimensionLabel(pack.quality.limiting).toLowerCase()}`;
}

export function qualityVerdictText(pack: EvidencePack): string {
  if (pack.quality.band === 'high') {
    return 'Bukti cukup untuk menyimpulkan selisih.';
  }
  if (pack.quality.band === 'moderate') {
    return 'Bukti cukup untuk indikasi, bukan kesimpulan final.';
  }
  return 'Bukti belum cukup untuk menyimpulkan apa pun.';
}

const DAY_SCOPE_LABEL: Readonly<Record<string, string>> = {
  weekday: 'hari kerja',
  weekend: 'akhir pekan',
  holiday: 'hari libur',
  all: 'semua hari',
};

export function dayScopeLabel(scope: string): string {
  return DAY_SCOPE_LABEL[scope] ?? scope;
}

export function dayScopeNote(pack: EvidencePack): string {
  if (pack.dayScope === 'holiday') {
    return pack.holidayName === null
      ? 'Tanggal ini tercatat sebagai hari libur.'
      : `Tanggal ini hari libur: ${pack.holidayName}.`;
  }
  if (pack.dayScope === 'weekend') {
    return 'Tanggal ini akhir pekan.';
  }
  return 'Tanggal ini hari kerja.';
}

export function qualityActionText(pack: EvidencePack): string | null {
  if (pack.quality.band === 'high' || pack.quality.band === 'moderate') {
    return null;
  }
  return 'Satu perjalanan lagi akan menaikkan mutu bukti. Laporan tetap boleh dikirim sekarang.';
}

export function contextSummary(pack: EvidencePack): string {
  const segments = pack.context.segments.length;
  if (segments === 0) {
    return 'Tidak ada pengumuman operasional pada periode ini.';
  }
  return `${String(pack.context.events.length)} pengumuman menutup ${String(segments)} rentang waktu`;
}

export function impactLabel(impact: string): string {
  return IMPACT_LABEL[impact] ?? impact;
}

export function provenanceLine(pack: EvidencePack): string {
  const snapshot = pack.snapshot;
  if (snapshot === null) {
    return `Dihitung ${pack.generatedAt.slice(0, 16).replace('T', ' ')}`;
  }
  return `${snapshot.methodVersion} · ${String(snapshot.inputRows)} baris · data ${shortDigest(snapshot.datasetDigest, 10)}`;
}

export function slaPhaseLabel(phase: string): string {
  return SLA_PHASE_LABEL[phase as SlaPhaseName] ?? phase;
}

export function slaStateLabel(state: string): string {
  return SLA_STATE_LABEL[state] ?? state;
}

export function slaPhaseValue(phase: SlaPhase): string {
  switch (phase.state) {
    case 'met':
      return 'tepat waktu';
    case 'met_late':
      return `telat ${String(Math.round(phase.lateByHours ?? 0))} jam`;
    case 'overdue':
      return `lewat ${String(Math.round(phase.lateByHours ?? 0))} jam`;
    case 'pending':
      return `sisa ${String(Math.round(phase.remainingHours ?? 0))} jam`;
    case 'not_started':
      return 'belum dihitung';
  }
}

export function responseKindLabel(kind: string): string {
  return RESPONSE_KIND_LABEL[kind] ?? kind;
}

export function verdictLabel(verdict: string): string {
  return VERDICT_LABEL[verdict] ?? verdict;
}

export function methodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method;
}

export function outcomeLabel(outcome: CaseFile['resolution']['outcome']): string {
  return OUTCOME_LABEL[outcome];
}

export function outcomeTone(outcome: CaseFile['resolution']['outcome']): string {
  return OUTCOME_TONE[outcome];
}

export function milestoneProgress(caseFile: CaseFile): number {
  return Math.min(1, Math.max(0, caseFile.milestones.progress));
}

export function reachedMilestone(caseFile: CaseFile, key: string): boolean {
  return caseFile.milestones.entries.some((entry) => entry.key === key);
}

export function nextMilestoneText(caseFile: CaseFile): string {
  if (caseFile.milestones.terminal !== null) {
    return 'Kasus sudah berakhir.';
  }
  if (caseFile.milestones.next === null) {
    return 'Tidak ada tahap berikutnya yang terjadwal.';
  }
  return `Tahap berikutnya: ${milestoneLabel(caseFile.milestones.next).toLowerCase()}.`;
}

export function attestationTone(
  attestation: NonNullable<CaseFile['responses'][number]['attestation']>,
): string {
  if (attestation.status === 'verified') {
    return 'verified';
  }
  if (attestation.status === 'unsigned') {
    return 'pending';
  }
  return 'alert';
}

export function attestationLabel(
  attestation: NonNullable<CaseFile['responses'][number]['attestation']>,
): string {
  switch (attestation.status) {
    case 'verified':
      return 'Tertanda tangan';
    case 'unsigned':
      return 'Tanpa tanda tangan';
    case 'signature_mismatch':
      return 'Tanda tangan tidak cocok';
    case 'unsupported_algorithm':
      return 'Algoritma tidak didukung';
    case 'payload_mismatch':
      return 'Isi berubah sejak ditandatangani';
    case 'structural_invalid':
      return 'Tanda tangan rusak';
  }
}

export function resolutionCounts(caseFile: CaseFile): string {
  const { supporting, refuting, inconclusive } = caseFile.resolution;
  return `${String(supporting)} menguatkan · ${String(refuting)} membantah · ${String(inconclusive)} belum simpul`;
}

export function slaHeadline(caseFile: CaseFile): string | null {
  const sla = caseFile.sla;
  if (sla === null) {
    return null;
  }
  const { acknowledgeHours, respondHours, resolveHours } = sla.targets;
  const base = `Akui ${String(acknowledgeHours)} j · tanggap ${String(respondHours)} j · selesai ${String(resolveHours)} j`;
  return sla.breached ? `${base} · tenggat terlampaui` : base;
}
