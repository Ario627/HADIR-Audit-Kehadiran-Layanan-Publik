export type MemberRole = 'viewer' | 'responder' | 'admin';

export type MemberStatus = 'active' | 'suspended' | 'revoked';

export type Capability =
  | 'read_inbox'
  | 'act_on_report'
  | 'publish_response'
  | 'verify_resolution'
  | 'manage_members'
  | 'request_export'
  | 'view_analytics';

export type MemberAction = 'promote' | 'demote' | 'revoke' | 'reinstate' | 'suspend';

export interface MemberRecord {
  membershipId: string;
  userId: string;
  displayName: string;
  role: MemberRole;
  status: MemberStatus;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

export interface ActionDecision {
  allowed: boolean;
  reason: string | null;
}

const ROLE_ORDER: readonly MemberRole[] = ['viewer', 'responder', 'admin'];

const ROLE_CAPABILITIES: Readonly<Record<MemberRole, readonly Capability[]>> = Object.freeze({
  viewer: ['read_inbox', 'view_analytics'],
  responder: ['read_inbox', 'act_on_report', 'publish_response', 'view_analytics'],
  admin: [
    'read_inbox',
    'act_on_report',
    'publish_response',
    'verify_resolution',
    'manage_members',
    'request_export',
    'view_analytics',
  ],
});

export function roleRank(role: MemberRole): number {
  const index = ROLE_ORDER.indexOf(role);
  return index < 0 ? 0 : index;
}

export function capabilitiesOf(role: MemberRole): readonly Capability[] {
  return ROLE_CAPABILITIES[role];
}

export function memberCan(role: MemberRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function memberDenialReason(role: MemberRole, capability: Capability): string | null {
  if (memberCan(role, capability)) {
    return null;
  }
  const needed = ROLE_ORDER.find((candidate) =>
    ROLE_CAPABILITIES[candidate].includes(capability),
  );
  return needed === undefined
    ? `Tidak ada peran yang memiliki izin ${capability}.`
    : `Peran ${role} tidak memiliki izin ${capability}; dibutuhkan minimal ${needed}.`;
}

export function highestRole(roles: readonly MemberRole[]): MemberRole | null {
  let best: MemberRole | null = null;
  for (const role of roles) {
    if (best === null || roleRank(role) > roleRank(best)) {
      best = role;
    }
  }
  return best;
}

export function activeAdminCount(members: readonly MemberRecord[]): number {
  return members.filter(
    (member) => member.role === 'admin' && member.revokedAt === null && member.status === 'active',
  ).length;
}

export interface ActionContext {
  actorUserId: string;
  actorRole: MemberRole;
  target: MemberRecord;
  members: readonly MemberRecord[];
}

function selfActionBlocked(action: MemberAction): ActionDecision {
  return {
    allowed: false,
    reason:
      action === 'revoke' || action === 'suspend'
        ? 'Anda tidak dapat mencabut atau menangguhkan akses Anda sendiri.'
        : 'Anda tidak dapat mengubah peran Anda sendiri.',
  };
}

export function evaluateMemberAction(
  action: MemberAction,
  context: ActionContext,
): ActionDecision {
  const { actorUserId, actorRole, target, members } = context;

  if (!memberCan(actorRole, 'manage_members')) {
    return {
      allowed: false,
      reason: memberDenialReason(actorRole, 'manage_members'),
    };
  }
  if (target.userId === actorUserId) {
    return selfActionBlocked(action);
  }

  const targetIsActiveAdmin =
    target.role === 'admin' && target.revokedAt === null && target.status === 'active';
  const remainingAdmins =
    activeAdminCount(members) - (targetIsActiveAdmin ? 1 : 0);

  if (action === 'revoke' || action === 'suspend') {
    if (targetIsActiveAdmin && remainingAdmins < 1) {
      return {
        allowed: false,
        reason: 'Institusi wajib menyisakan minimal satu admin aktif.',
      };
    }
    if (target.revokedAt !== null) {
      return { allowed: false, reason: 'Anggota ini sudah dicabut aksesnya.' };
    }
    return { allowed: true, reason: null };
  }

  if (action === 'demote') {
    if (targetIsActiveAdmin && remainingAdmins < 1) {
      return {
        allowed: false,
        reason: 'Institusi wajib menyisakan minimal satu admin aktif.',
      };
    }
    return { allowed: true, reason: null };
  }

  if (action === 'promote') {
    if (target.revokedAt !== null) {
      return { allowed: false, reason: 'Anggota yang dicabut tidak dapat dipromosikan.' };
    }
    return { allowed: true, reason: null };
  }

  const reinstated: MemberRecord = { ...target, revokedAt: null };
  if (reinstated.revokedAt !== null) {
    return { allowed: false, reason: 'Anggota ini belum dicabut.' };
  }
  return { allowed: true, reason: null };
}

export function nextRole(role: MemberRole, action: 'promote' | 'demote'): MemberRole | null {
  const index = roleRank(role);
  if (action === 'promote') {
    return ROLE_ORDER[index + 1] ?? null;
  }
  return index === 0 ? null : (ROLE_ORDER[index - 1] ?? null);
}

export function membershipCaveats(): readonly string[] {
  return [
    'Mencabut akses juga mengakhiri seluruh sesi aktif anggota tersebut.',
    'Institusi tidak dapat kehilangan seluruh admin; sistem menolak langkah yang menyisakan nol admin.',
    'Perubahan peran tidak menghapus jejak aksi yang sudah dilakukan anggota sebelumnya.',
    'Anggota yang dicabut tetap tercatat di audit, hanya aksesnya yang ditutup.',
  ];
}

export function describeMembership(member: MemberRecord): string {
  if (member.revokedAt !== null) {
    return `${member.displayName} — akses dicabut.`;
  }
  if (member.status === 'suspended') {
    return `${member.displayName} — ditangguhkan.`;
  }
  return `${member.displayName} — ${member.role}.`;
}
