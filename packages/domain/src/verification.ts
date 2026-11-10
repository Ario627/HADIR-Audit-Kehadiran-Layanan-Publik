export type VerifierRole = 'moderator' | 'superadmin' | 'partner' | 'auditor';

export type VerificationMethod =
  | 'field_visit'
  | 'operator_report'
  | 'third_party_audit'
  | 'remote_review';

export interface FieldVerificationRecord {
  reportPublicId: string;
  verifierRole: VerifierRole;
  verifierId: string;
  method: VerificationMethod;
  verifiedAt: string;
  evidenceIds: readonly string[];
  note: string;
  independentOfOperator: boolean;
}

export interface VerificationContext {
  reportCreatedAt: string;
  now: string;
  operatorInstitutionId: string | null;
  verifierInstitutionId: string | null;
  knownEvidenceIds: readonly string[];
}

export interface VerificationCheck {
  code: string;
  ok: boolean;
  detail: string;
}

export interface FieldVerificationAssessment {
  accepted: boolean;
  level: 'none' | 'field_verified';
  checks: readonly VerificationCheck[];
  warnings: readonly string[];
}

const MIN_NOTE_LENGTH = 20;
const MAX_NOTE_LENGTH = 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const RECOMMENDED_EVIDENCE = 2;
const MIN_PUBLIC_ID_LENGTH = 6;

const ROLE_METHODS: Readonly<Record<VerifierRole, readonly VerificationMethod[]>> =
  Object.freeze({
    moderator: ['field_visit', 'third_party_audit', 'remote_review'],
    superadmin: ['field_visit', 'third_party_audit', 'remote_review'],
    auditor: ['field_visit', 'third_party_audit'],
    partner: ['operator_report', 'remote_review'],
  });

function parseTime(raw: string): Date | null {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

export function verificationMethodAllowed(
  role: VerifierRole,
  method: VerificationMethod,
): boolean {
  return ROLE_METHODS[role].includes(method);
}

export function isIndependentVerification(
  record: FieldVerificationRecord,
  context: VerificationContext,
): boolean {
  if (!record.independentOfOperator) {
    return false;
  }
  if (
    context.operatorInstitutionId !== null &&
    context.verifierInstitutionId !== null &&
    context.operatorInstitutionId === context.verifierInstitutionId
  ) {
    return false;
  }
  return record.method !== 'operator_report';
}

export function assessFieldVerification(
  record: FieldVerificationRecord,
  context: VerificationContext,
): FieldVerificationAssessment {
  const checks: VerificationCheck[] = [];
  const warnings: string[] = [];

  const publicIdOk =
    record.reportPublicId.trim().length >= MIN_PUBLIC_ID_LENGTH &&
    record.reportPublicId.length <= 40;
  checks.push({
    code: 'report_identified',
    ok: publicIdOk,
    detail: publicIdOk
      ? 'Laporan yang diverifikasi tercatat jelas.'
      : 'ID laporan tidak valid.',
  });

  const verifierOk = record.verifierId.trim().length >= 3;
  checks.push({
    code: 'verifier_identified',
    ok: verifierOk,
    detail: verifierOk ? 'Pemeriksa tercatat.' : 'Pemeriksa tidak tercatat.',
  });

  const methodOk = verificationMethodAllowed(record.verifierRole, record.method);
  checks.push({
    code: 'method_allowed_for_role',
    ok: methodOk,
    detail: methodOk
      ? 'Metode verifikasi sesuai kewenangan peran.'
      : `Metode ${record.method} tidak diizinkan untuk peran ${record.verifierRole}.`,
  });

  const verifiedAt = parseTime(record.verifiedAt);
  const createdAt = parseTime(context.reportCreatedAt);
  const now = parseTime(context.now);
  const timeOrdered =
    verifiedAt !== null &&
    createdAt !== null &&
    now !== null &&
    verifiedAt.getTime() >= createdAt.getTime() - MAX_CLOCK_SKEW_MS &&
    verifiedAt.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS;
  checks.push({
    code: 'time_window_valid',
    ok: timeOrdered,
    detail: timeOrdered
      ? 'Waktu verifikasi berada di dalam riwayat laporan.'
      : 'Waktu verifikasi tidak masuk akal terhadap riwayat laporan.',
  });

  const evidenceIds = unique(record.evidenceIds);
  const unknown = evidenceIds.filter((id) => !context.knownEvidenceIds.includes(id));
  const evidenceOk = evidenceIds.length >= 1 && unknown.length === 0;
  checks.push({
    code: 'evidence_attached',
    ok: evidenceOk,
    detail:
      evidenceIds.length === 0
        ? 'Verifikasi lapangan wajib menyertakan bukti.'
        : unknown.length > 0
          ? 'Ada bukti yang tidak dikenali sistem.'
          : `Verifikasi menyertakan ${evidenceIds.length} bukti.`,
  });
  if (evidenceIds.length < RECOMMENDED_EVIDENCE) {
    warnings.push('single_evidence_item');
  }

  const noteLength = record.note.trim().length;
  const noteOk = noteLength >= MIN_NOTE_LENGTH && noteLength <= MAX_NOTE_LENGTH;
  checks.push({
    code: 'note_substantive',
    ok: noteOk,
    detail: noteOk
      ? 'Catatan verifikasi cukup menjelaskan dasar penilaian.'
      : `Catatan verifikasi minimal ${MIN_NOTE_LENGTH} karakter.`,
  });

  const independent = isIndependentVerification(record, context);
  checks.push({
    code: 'independent_of_operator',
    ok: independent,
    detail: independent
      ? 'Verifikasi tidak berasal dari pihak yang mengklaim selesai.'
      : 'Verifikasi berasal dari pihak operator sendiri atau tidak dinyatakan independen.',
  });
  if (!independent) {
    warnings.push('self_verification_rejected');
  }

  const accepted =
    publicIdOk &&
    verifierOk &&
    methodOk &&
    timeOrdered &&
    evidenceOk &&
    noteOk &&
    independent;

  return {
    accepted,
    level: accepted ? 'field_verified' : 'none',
    checks,
    warnings,
  };
}

export function describeVerification(assessment: FieldVerificationAssessment): string {
  if (assessment.accepted) {
    return 'Verifikasi lapangan diterima: status field_verified dapat dipakai.';
  }
  const failed = assessment.checks.filter((check) => !check.ok).map((check) => check.detail);
  return `Verifikasi lapangan ditolak. ${failed.join(' ')}`.trim();
}

export function verificationRequirements(): readonly string[] {
  return Object.freeze([
    'Pemeriksa harus tercatat dengan peran yang berwenang atas metode yang dipakai.',
    'Waktu verifikasi harus berada di antara pembuatan laporan dan saat ini.',
    'Minimal satu bukti yang sudah dikenal sistem wajib dilampirkan; dua bukti disarankan.',
    'Catatan verifikasi minimal 20 karakter agar dasarnya dapat dinilai ulang.',
    'Verifikasi tidak boleh berasal dari pihak yang mengklaim penyelesaian.',
  ]);
}