export type PanelRole = 'observer' | 'verifier';

export type PanelStatus = 'invited' | 'active' | 'declined' | 'revoked';

export interface PanelGrant {
  id: string;
  institutionId: string;
  role: PanelRole;
  status: PanelStatus;
  cityId: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface PanelCandidate {
  institutionId: string;
  displayName: string;
  cityId: string | null;
  activeGrant: PanelGrant | null;
}

export interface PanelContext {
  claimantInstitutionId: string;
  claimantCityId: string | null;
  candidate: PanelCandidate;
}

export type PanelRefusal =
  | 'self'
  | 'different_city'
  | 'already_active'
  | 'revoked_recently'
  | 'unknown_city';

export interface PanelEligibility {
  eligible: boolean;
  role: PanelRole;
  refusal: PanelRefusal | null;
  reason: string;
}

export interface PanelQuorum {
  required: number;
  present: number;
  met: boolean;
  missing: number;
}

export const PANEL_MIN_QUORUM = 1;
export const PANEL_STRONG_QUORUM = 2;

const ROLE_ORDER: readonly PanelRole[] = ['observer', 'verifier'];

export function panelRoleRank(role: PanelRole): number {
  const index = ROLE_ORDER.indexOf(role);
  return index < 0 ? 0 : index;
}

export function strongestPanelRole(grants: readonly PanelGrant[]): PanelRole | null {
  let best: PanelRole | null = null;
  for (const grant of grants) {
    if (grant.status !== 'active' || grant.revokedAt !== null) {
      continue;
    }
    if (best === null || panelRoleRank(grant.role) > panelRoleRank(best)) {
      best = grant.role;
    }
  }
  return best;
}

export function panelEligibility(context: PanelContext): PanelEligibility {
  const { claimantInstitutionId, claimantCityId, candidate } = context;

  if (candidate.institutionId === claimantInstitutionId) {
    return {
      eligible: false,
      role: 'observer',
      refusal: 'self',
      reason: 'Institusi pengklaim tidak dapat menjadi panel untuk laporannya sendiri.',
    };
  }
  if (claimantCityId === null) {
    return {
      eligible: false,
      role: 'observer',
      refusal: 'unknown_city',
      reason: 'Laporan tanpa kota tidak dapat membentuk panel lintas instansi.',
    };
  }
  if (candidate.cityId !== claimantCityId) {
    return {
      eligible: false,
      role: 'observer',
      refusal: 'different_city',
      reason: 'Panel lintas instansi hanya berlaku dalam satu kota.',
    };
  }
  const grant = candidate.activeGrant;
  if (grant !== null && grant.status === 'revoked' && grant.revokedAt !== null) {
    return {
      eligible: false,
      role: 'observer',
      refusal: 'revoked_recently',
      reason: 'Akses panel institusi ini pernah dicabut dan tidak dapat dipulihkan otomatis.',
    };
  }
  if (grant !== null && grant.status === 'active') {
    return {
      eligible: true,
      role: grant.role,
      refusal: null,
      reason: `Institusi ini sudah aktif sebagai ${grant.role} panel.`,
    };
  }
  return {
    eligible: true,
    role: 'verifier',
    refusal: null,
    reason: 'Institusi satu kota dapat diundang sebagai verifier panel.',
  };
}

export function panelRefusalMessage(refusal: PanelRefusal): string {
  switch (refusal) {
    case 'self':
      return 'Tidak boleh menilai klaim sendiri.';
    case 'different_city':
      return 'Berbeda kota dengan laporan.';
    case 'already_active':
      return 'Sudah aktif di panel laporan ini.';
    case 'revoked_recently':
      return 'Akses panel pernah dicabut.';
    case 'unknown_city':
      return 'Laporan belum memiliki kota.';
  }
}

export function panelQuorum(activeVerifiers: number): PanelQuorum {
  const required = PANEL_MIN_QUORUM;
  const present = Math.max(0, Math.trunc(activeVerifiers));
  return {
    required,
    present,
    met: present >= required,
    missing: Math.max(0, required - present),
  };
}

export function panelStrength(activeVerifiers: number, distinctKinds: number): 'weak' | 'adequate' | 'strong' {
  if (activeVerifiers >= PANEL_STRONG_QUORUM && distinctKinds >= 2) {
    return 'strong';
  }
  if (activeVerifiers >= PANEL_MIN_QUORUM) {
    return 'adequate';
  }
  return 'weak';
}

export function eligiblePanelCandidates(
  claimantInstitutionId: string,
  claimantCityId: string | null,
  candidates: readonly PanelCandidate[],
): readonly PanelCandidate[] {
  return candidates.filter(
    (candidate) =>
      panelEligibility({ claimantInstitutionId, claimantCityId, candidate }).eligible,
  );
}

export function panelCaveats(): readonly string[] {
  return [
    'Panel hanya dapat menilai klaim selesai, bukan menilai mutu laporan warga.',
    'Panel lintas instansi dibatasi satu kota agar penilai mengenal konteks lapangan.',
    'Institusi yang pernah dicabut aksesnya tidak kembali otomatis; perlu keputusan platform.',
    'Panel tidak menggantikan konfirmasi warga, dan keduanya dihitung terpisah.',
  ];
}

export function describePanel(
  claimantName: string,
  members: readonly { displayName: string; role: PanelRole }[],
): string {
  if (members.length === 0) {
    return `Belum ada panel untuk laporan ${claimantName}.`;
  }
  const verifiers = members.filter((member) => member.role === 'verifier');
  const observers = members.filter((member) => member.role === 'observer');
  const parts: string[] = [];
  if (verifiers.length > 0) {
    parts.push(`${verifiers.length} verifier`);
  }
  if (observers.length > 0) {
    parts.push(`${observers.length} observer`);
  }
  return `Panel ${claimantName}: ${parts.join(', ')}.`;
}
