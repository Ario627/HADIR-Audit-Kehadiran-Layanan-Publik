export type ResolutionMethod =
  | 'citizen_confirmation'
  | 'field_inspection'
  | 'observation_data'
  | 'panel_review';

export type ResolutionVerdict = 'confirmed' | 'refuted' | 'inconclusive';

export type VerifierKind = 'citizen' | 'independent_institution' | 'platform' | 'automatic';

export type ResolutionStatus = 'claimed_resolved' | 'verified_resolved' | 'disputed';

export interface ResolutionClaim {
  publicId: string;
  claimantInstitutionId: string;
  claimedAt: string;
}

export interface ResolutionVerification {
  id: string;
  method: ResolutionMethod;
  verdict: ResolutionVerdict;
  verifierKind: VerifierKind;
  verifierInstitutionId: string | null;
  verifierUserId: string | null;
  note: string | null;
  evidenceUrls: readonly string[];
  verifiedAt: string;
}

export interface IndependenceCheck {
  independent: boolean;
  reason: string | null;
}

export interface ResolutionDecision {
  status: ResolutionStatus;
  outcome: 'verified' | 'disputed' | 'undecided';
  reason: string;
  supporting: number;
  refuting: number;
  inconclusive: number;
}

export const MIN_VERIFICATIONS_FOR_RESOLUTION = 1;
export const OBSERVATION_SUPPORT_MIN_ROWS = 20;

const SELF_VERIFICATION_METHODS: readonly ResolutionMethod[] = [
  'citizen_confirmation',
  'field_inspection',
  'observation_data',
  'panel_review',
];

const METHOD_LABELS: Readonly<Record<ResolutionMethod, string>> = Object.freeze({
  citizen_confirmation: 'Konfirmasi warga pelapor',
  field_inspection: 'Pemeriksaan lapangan',
  observation_data: 'Data pengamatan setelah perbaikan',
  panel_review: 'Tinjauan panel independen',
});

export function resolutionMethodLabel(method: ResolutionMethod): string {
  return METHOD_LABELS[method];
}

export function checkIndependence(
  claim: ResolutionClaim,
  verifierKind: VerifierKind,
  verifierInstitutionId: string | null,
): IndependenceCheck {
  if (verifierKind === 'citizen' || verifierKind === 'automatic') {
    return { independent: true, reason: null };
  }
  if (verifierKind === 'platform') {
    return { independent: true, reason: null };
  }
  if (verifierInstitutionId === null) {
    return {
      independent: false,
      reason: 'Verifikasi oleh institusi wajib mencantumkan identitas institusi.',
    };
  }
  if (verifierInstitutionId === claim.claimantInstitutionId) {
    return {
      independent: false,
      reason: 'Institusi yang mengklaim selesai tidak boleh memverifikasi klaimnya sendiri.',
    };
  }
  return { independent: true, reason: null };
}

export function acceptsMethodForVerifier(
  method: ResolutionMethod,
  verifierKind: VerifierKind,
): boolean {
  if (!SELF_VERIFICATION_METHODS.includes(method)) {
    return false;
  }
  if (verifierKind === 'citizen') {
    return method === 'citizen_confirmation';
  }
  if (verifierKind === 'automatic') {
    return method === 'observation_data';
  }
  if (verifierKind === 'platform') {
    return method === 'panel_review' || method === 'field_inspection';
  }
  return method === 'field_inspection' || method === 'panel_review';
}

export function decideResolution(
  claim: ResolutionClaim,
  verifications: readonly ResolutionVerification[],
): ResolutionDecision {
  let supporting = 0;
  let refuting = 0;
  let inconclusive = 0;

  for (const verification of verifications) {
    const independence = checkIndependence(
      claim,
      verification.verifierKind,
      verification.verifierInstitutionId,
    );
    if (!independence.independent) {
      continue;
    }
    if (verification.verdict === 'confirmed') {
      supporting += 1;
    } else if (verification.verdict === 'refuted') {
      refuting += 1;
    } else {
      inconclusive += 1;
    }
  }

  if (refuting > 0) {
    return {
      status: 'disputed',
      outcome: 'disputed',
      reason: `${refuting} verifikasi independen membantah klaim selesai.`,
      supporting,
      refuting,
      inconclusive,
    };
  }
  if (supporting >= MIN_VERIFICATIONS_FOR_RESOLUTION) {
    return {
      status: 'verified_resolved',
      outcome: 'verified',
      reason: `${supporting} verifikasi independen menguatkan klaim selesai.`,
      supporting,
      refuting,
      inconclusive,
    };
  }
  return {
    status: 'claimed_resolved',
    outcome: 'undecided',
    reason:
      inconclusive === 0
        ? 'Belum ada verifikasi independen.'
        : `${inconclusive} verifikasi belum menyimpulkan; klaim tetap belum terbukti.`,
    supporting,
    refuting,
    inconclusive,
  };
}

export interface ObservationSupportInput {
  rows: number;
  excessShare: number;
  windowStart: string;
  windowEnd: string;
}

export interface ObservationSupport {
  supporting: boolean;
  rows: number;
  excessShare: number;
  message: string;
}

export function observationSupport(
  input: ObservationSupportInput,
  excessThreshold: number,
): ObservationSupport {
  if (input.rows < OBSERVATION_SUPPORT_MIN_ROWS) {
    return {
      supporting: false,
      rows: input.rows,
      excessShare: input.excessShare,
      message: `Data setelah perbaikan belum cukup (${input.rows} pengamatan, minimal ${OBSERVATION_SUPPORT_MIN_ROWS}).`,
    };
  }
  if (input.excessShare <= excessThreshold) {
    return {
      supporting: true,
      rows: input.rows,
      excessShare: input.excessShare,
      message: `Data setelah perbaikan mendukung: hanya ${Math.round(input.excessShare * 100)}% pengamatan melebihi ambang.`,
    };
  }
  return {
    supporting: false,
    rows: input.rows,
    excessShare: input.excessShare,
    message: `Data setelah perbaikan belum mendukung: ${Math.round(input.excessShare * 100)}% masih melebihi ambang.`,
  };
}

export interface ResolutionConflict {
  code: string;
  detail: string;
}

export function resolutionConflicts(
  claim: ResolutionClaim,
  verifications: readonly ResolutionVerification[],
): readonly ResolutionConflict[] {
  const conflicts: ResolutionConflict[] = [];
  const seenVerifiers = new Set<string>();

  for (const verification of verifications) {
    const independence = checkIndependence(
      claim,
      verification.verifierKind,
      verification.verifierInstitutionId,
    );
    if (!independence.independent) {
      conflicts.push({
        code: 'self_verification',
        detail: independence.reason ?? 'Verifikasi tidak independen.',
      });
    }
    if (!acceptsMethodForVerifier(verification.method, verification.verifierKind)) {
      conflicts.push({
        code: 'method_mismatch',
        detail: `Metode ${verification.method} tidak sah untuk verifikator ${verification.verifierKind}.`,
      });
    }
    const key =
      verification.verifierKind === 'independent_institution'
        ? `institution:${verification.verifierInstitutionId ?? 'unknown'}`
        : verification.verifierKind === 'citizen'
          ? `citizen:${verification.verifierUserId ?? 'unknown'}`
          : `${verification.verifierKind}:${verification.id}`;
    if (seenVerifiers.has(key)) {
      conflicts.push({
        code: 'duplicate_verifier',
        detail: `Verifikator ${key} muncul lebih dari sekali.`,
      });
    }
    seenVerifiers.add(key);
    if (verification.verdict === 'confirmed' && verification.evidenceUrls.length === 0) {
      conflicts.push({
        code: 'confirmation_without_evidence',
        detail: 'Verifikasi yang menguatkan klaim wajib menyertakan tautan bukti.',
      });
    }
  }

  return conflicts;
}

export function resolutionCautions(
  claim: ResolutionClaim,
  verifications: readonly ResolutionVerification[],
): readonly string[] {
  const cautions: string[] = [];
  const independent = verifications.filter(
    (verification) =>
      checkIndependence(claim, verification.verifierKind, verification.verifierInstitutionId)
        .independent,
  );
  const kinds = new Set(independent.map((verification) => verification.verifierKind));
  if (independent.length === 1) {
    cautions.push(
      'Klaim selesai hanya bersandar pada satu verifikasi independen; konfirmasi warga atau pemeriksaan kedua akan memperkuat.',
    );
  }
  if (kinds.size === 1 && kinds.has('independent_institution') && independent.length > 1) {
    cautions.push(
      'Semua verifikasi berasal dari institusi lain, tanpa konfirmasi warga atau data pengamatan.',
    );
  }
  const urls = new Set<string>();
  for (const verification of independent) {
    for (const url of verification.evidenceUrls) {
      if (urls.has(url)) {
        cautions.push(`Tautan bukti ${url} dipakai lebih dari satu kali.`);
      }
      urls.add(url);
    }
  }
  return cautions;
}

export function resolutionCaveats(): readonly string[] {
  return [
    'Verifikasi independen memeriksa apakah masalah benar-benar hilang, bukan apakah prosedur dijalankan.',
    'Satu bantahan independen membuka kembali laporan; klaim selesai tidak boleh menang karena jumlah.',
    'Data pengamatan setelah perbaikan hanya mendukung, tidak pernah memutuskan sendiri.',
    'Institusi yang mengklaim selesai tidak pernah boleh memverifikasi klaimnya sendiri.',
  ];
}

export function describeResolution(decision: ResolutionDecision): string {
  switch (decision.outcome) {
    case 'verified':
      return 'Selesai terverifikasi oleh pihak independen.';
    case 'disputed':
      return 'Klaim selesai dibantah; laporan dibuka kembali dan menunggu tindak lanjut.';
    case 'undecided':
      return 'Klaim selesai belum diverifikasi. Belum terbukti selesai.';
  }
}
