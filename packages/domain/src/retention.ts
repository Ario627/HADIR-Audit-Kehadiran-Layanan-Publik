export type RetentionAction = 'delete' | 'anonymize' | 'keep';

export type RetentionDataset =
  | 'uploads.pending'
  | 'uploads.rejected'
  | 'uploads.attached'
  | 'exports.file'
  | 'exports.row'
  | 'idempotency_keys'
  | 'partner_otp_challenges'
  | 'partner_webauthn_challenges'
  | 'partner_sessions'
  | 'platform_admin_sessions'
  | 'reports.contact_email'
  | 'reports'
  | 'report_events'
  | 'audit_log'
  | 'anchor_log'
  | 'retention_runs';

export interface RetentionRule {
  dataset: RetentionDataset;
  action: RetentionAction;
  retentionDays: number | null;
  floorDays: number | null;
  legalBasis: string;
  rationale: string;
}

export interface RetentionPolicy {
  rules: readonly RetentionRule[];
  version: string;
  reviewedAt: string;
}

export interface RetentionOverride {
  dataset: RetentionDataset;
  retentionDays: number;
}

export interface RetentionDecision {
  dataset: RetentionDataset;
  action: RetentionAction;
  effectiveDays: number | null;
  cutoff: string | null;
  overridden: boolean;
  rejectedOverride: string | null;
  reason: string;
}

export interface RetentionPlan {
  now: string;
  decisions: readonly RetentionDecision[];
  skipped: readonly string[];
  warnings: readonly string[];
}

export interface RetentionPlanInput {
  now: string;
  overrides?: readonly RetentionOverride[];
}

const DAY_MS = 86_400_000;

export const RETENTION_POLICY_VERSION = '2026-11-09';

function rule(input: RetentionRule): RetentionRule {
  return Object.freeze(input);
}

export const RETENTION_POLICY: RetentionPolicy = Object.freeze({
  version: RETENTION_POLICY_VERSION,
  reviewedAt: '2026-11-09T00:00:00.000Z',
  rules: Object.freeze([
    rule({
      dataset: 'uploads.pending',
      action: 'delete',
      retentionDays: 2,
      floorDays: 1,
      legalBasis: 'minimisasi data',
      rationale: 'Unggahan yang tidak pernah menjadi laporan tidak punya nilai bukti.',
    }),
    rule({
      dataset: 'uploads.rejected',
      action: 'delete',
      retentionDays: 7,
      floorDays: 1,
      legalBasis: 'kepentingan sah penyalahgunaan',
      rationale:
        'Dipertahankan sebentar untuk mendeteksi pola penyalahgunaan, lalu dibuang.',
    }),
    rule({
      dataset: 'uploads.attached',
      action: 'keep',
      retentionDays: null,
      floorDays: null,
      legalBasis: 'bukti publik',
      rationale: 'Media yang menempel pada laporan adalah bagian dari bukti dan tidak dihapus otomatis.',
    }),
    rule({
      dataset: 'exports.file',
      action: 'delete',
      retentionDays: 2,
      floorDays: 1,
      legalBasis: 'minimisasi data',
      rationale: 'Berkas export adalah salinan data mitra; tidak perlu hidup lebih lama dari unduhan.',
    }),
    rule({
      dataset: 'exports.row',
      action: 'delete',
      retentionDays: 90,
      floorDays: 14,
      legalBasis: 'audit akses',
      rationale: 'Baris export menyimpan jejak siapa mengunduh apa; disimpan lebih lama dari berkasnya.',
    }),
    rule({
      dataset: 'idempotency_keys',
      action: 'delete',
      retentionDays: 8,
      floorDays: 7,
      legalBasis: 'operasional',
      rationale: 'Kunci idempotensi hanya perlu hidup sedikit lebih lama dari TTL-nya.',
    }),
    rule({
      dataset: 'partner_otp_challenges',
      action: 'delete',
      retentionDays: 1,
      floorDays: 1,
      legalBasis: 'keamanan',
      rationale: 'Kode OTP kedaluwarsa tidak berguna dan berisiko jika disimpan.',
    }),
    rule({
      dataset: 'partner_webauthn_challenges',
      action: 'delete',
      retentionDays: 1,
      floorDays: 1,
      legalBasis: 'keamanan',
      rationale: 'Challenge WebAuthn sekali pakai; disimpan hanya untuk deteksi replay jangka pendek.',
    }),
    rule({
      dataset: 'partner_sessions',
      action: 'delete',
      retentionDays: 30,
      floorDays: 7,
      legalBasis: 'keamanan',
      rationale: 'Sesi yang sudah dicabut tetap disimpan sebentar untuk investigasi penyalahgunaan.',
    }),
    rule({
      dataset: 'platform_admin_sessions',
      action: 'delete',
      retentionDays: 90,
      floorDays: 30,
      legalBasis: 'audit keamanan',
      rationale: 'Jejak sesi admin dipakai untuk menelusuri akses istimewa.',
    }),
    rule({
      dataset: 'reports.contact_email',
      action: 'anonymize',
      retentionDays: 90,
      floorDays: 30,
      legalBasis: 'persetujuan',
      rationale:
        'Email penulis dihapus setelah laporan selesai atau setelah batas waktu, mana yang lebih dulu.',
    }),
    rule({
      dataset: 'reports',
      action: 'keep',
      retentionDays: null,
      floorDays: null,
      legalBasis: 'bukti publik',
      rationale:
        'Laporan adalah inti papan bukti publik; tidak dihapus otomatis. Penghapusan harus lewat permintaan eksplisit.',
    }),
    rule({
      dataset: 'report_events',
      action: 'keep',
      retentionDays: null,
      floorDays: null,
      legalBasis: 'integritas',
      rationale:
        'Menghapus event akan memutus hash chain dan membatalkan seluruh anchor. Dilarang.',
    }),
    rule({
      dataset: 'audit_log',
      action: 'keep',
      retentionDays: null,
      floorDays: null,
      legalBasis: 'akuntabilitas',
      rationale:
        'Audit log bersifat append-only dan menjadi dasar akuntabilitas; tidak pernah dipangkas otomatis.',
    }),
    rule({
      dataset: 'anchor_log',
      action: 'keep',
      retentionDays: null,
      floorDays: null,
      legalBasis: 'integritas',
      rationale:
        'Anchor adalah bukti publik yang tidak boleh hilang; menghapusnya membatalkan klaim transparansi.',
    }),
    rule({
      dataset: 'retention_runs',
      action: 'delete',
      retentionDays: 365,
      floorDays: 30,
      legalBasis: 'operasional',
      rationale: 'Riwayat pemeliharaan disimpan cukup lama untuk audit, lalu dipangkas.',
    }),
  ]),
});

export function ruleFor(dataset: RetentionDataset): RetentionRule | null {
  return RETENTION_POLICY.rules.find((entry) => entry.dataset === dataset) ?? null;
}

export function protectedDatasets(): readonly RetentionDataset[] {
  return RETENTION_POLICY.rules
    .filter((entry) => entry.action === 'keep')
    .map((entry) => entry.dataset);
}

export function applyOverrides(
  overrides: readonly RetentionOverride[],
): {
  decisions: Map<RetentionDataset, { days: number; rejected: string | null }>;
  warnings: string[];
} {
  const decisions = new Map<RetentionDataset, { days: number; rejected: string | null }>();
  const warnings: string[] = [];
  for (const override of overrides) {
    const base = ruleFor(override.dataset);
    if (base === null) {
      warnings.push(`override_unknown_dataset:${override.dataset}`);
      continue;
    }
    if (base.action === 'keep') {
      warnings.push(`override_protected_dataset:${override.dataset}`);
      continue;
    }
    if (base.floorDays !== null && override.retentionDays < base.floorDays) {
      warnings.push(`override_below_floor:${override.dataset}`);
      decisions.set(override.dataset, {
        days: base.floorDays,
        rejected: `override ${override.retentionDays} hari di bawah lantai ${base.floorDays} hari`,
      });
      continue;
    }
    const hardCap = base.retentionDays === null ? null : base.retentionDays * 4;
    if (hardCap !== null && override.retentionDays > hardCap) {
      warnings.push(`override_above_cap:${override.dataset}`);
      decisions.set(override.dataset, {
        days: hardCap,
        rejected: `override ${override.retentionDays} hari di atas batas ${hardCap} hari`,
      });
      continue;
    }
    decisions.set(override.dataset, { days: override.retentionDays, rejected: null });
  }
  return { decisions, warnings };
}

function cutoffFor(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export function planRetention(input: RetentionPlanInput): RetentionPlan {
  const now = new Date(input.now);
  if (Number.isNaN(now.getTime())) {
    return {
      now: input.now,
      decisions: [],
      skipped: ['invalid_now'],
      warnings: ['now_invalid'],
    };
  }
  const { decisions: overrides, warnings } = applyOverrides(input.overrides ?? []);
  const decisions: RetentionDecision[] = [];
  const skipped: string[] = [];

  for (const entry of RETENTION_POLICY.rules) {
    const override = overrides.get(entry.dataset);
    const days =
      entry.retentionDays === null ? null : override?.days ?? entry.retentionDays;
    if (entry.action === 'keep' || days === null) {
      skipped.push(entry.dataset);
      decisions.push({
        dataset: entry.dataset,
        action: entry.action,
        effectiveDays: null,
        cutoff: null,
        overridden: false,
        rejectedOverride: override?.rejected ?? null,
        reason: entry.rationale,
      });
      continue;
    }
    decisions.push({
      dataset: entry.dataset,
      action: entry.action,
      effectiveDays: days,
      cutoff: cutoffFor(now, days),
      overridden: override !== undefined && override.rejected === null,
      rejectedOverride: override?.rejected ?? null,
      reason: entry.rationale,
    });
  }

  return { now: now.toISOString(), decisions, skipped, warnings };
}

export function decisionFor(
  plan: RetentionPlan,
  dataset: RetentionDataset,
): RetentionDecision | null {
  return plan.decisions.find((entry) => entry.dataset === dataset) ?? null;
}

export function actionableDecisions(plan: RetentionPlan): readonly RetentionDecision[] {
  return plan.decisions.filter(
    (entry) => entry.action !== 'keep' && entry.cutoff !== null,
  );
}

export function policyViolations(policy: RetentionPolicy = RETENTION_POLICY): readonly string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const entry of policy.rules) {
    if (seen.has(entry.dataset)) {
      violations.push(`duplicate_rule:${entry.dataset}`);
    }
    seen.add(entry.dataset);
    if (entry.action === 'keep') {
      if (entry.retentionDays !== null) {
        violations.push(`keep_with_retention:${entry.dataset}`);
      }
      continue;
    }
    if (entry.retentionDays === null) {
      violations.push(`actionable_without_days:${entry.dataset}`);
      continue;
    }
    if (entry.retentionDays < 1) {
      violations.push(`non_positive_retention:${entry.dataset}`);
    }
    if (entry.floorDays !== null && entry.floorDays > entry.retentionDays) {
      violations.push(`floor_above_retention:${entry.dataset}`);
    }
    if (entry.rationale.trim().length < 20) {
      violations.push(`rationale_too_short:${entry.dataset}`);
    }
    if (entry.legalBasis.trim().length === 0) {
      violations.push(`missing_legal_basis:${entry.dataset}`);
    }
  }
  for (const dataset of ['report_events', 'audit_log', 'anchor_log'] as const) {
    const entry = policy.rules.find((candidate) => candidate.dataset === dataset);
    if (entry === undefined || entry.action !== 'keep') {
      violations.push(`integrity_dataset_not_kept:${dataset}`);
    }
  }
  return violations;
}

export function describeRetention(plan: RetentionPlan): string[] {
  const lines: string[] = [];
  for (const entry of plan.decisions) {
    if (entry.action === 'keep') {
      lines.push(`${entry.dataset}: disimpan permanen (${entry.reason})`);
      continue;
    }
    if (entry.cutoff === null) {
      lines.push(`${entry.dataset}: dilewati`);
      continue;
    }
    lines.push(
      `${entry.dataset}: ${entry.action} data lebih tua dari ${entry.effectiveDays} hari`,
    );
  }
  return lines;
}

export function immutableDatasets(): readonly RetentionDataset[] {
  return Object.freeze(['report_events', 'audit_log', 'anchor_log'] as const);
}

export function isImmutableDataset(dataset: string): boolean {
  return immutableDatasets().includes(dataset as RetentionDataset);
}
