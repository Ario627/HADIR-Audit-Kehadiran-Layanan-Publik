import { recordingAudit } from '../../test-support/audit.stub';
import type { PartnerSession } from '../../common/auth/partner-session';
import type { Transaction } from '../../db/client';
import type {
  AccountabilityRepository,
  MemberRow,
} from '../../db/repositories/accountability.repository';
import { PartnerMembersService } from './partner-members.service';

const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const SELF = '0192f0c4-0000-7000-8000-0000000000b1';
const PEER = '0192f0c4-0000-7000-8000-0000000000b2';
const THIRD = '0192f0c4-0000-7000-8000-0000000000b3';

const passthroughRunner = async <T>(
  work: (tx: Transaction) => Promise<T>,
): Promise<T> => work({} as Transaction);

function session(role: PartnerSession['role'] = 'admin'): PartnerSession {
  return {
    sessionId: 'session-1',
    userId: SELF,
    displayName: 'Budi',
    institutionId: DISHUB,
    institutionName: 'Dishub',
    role,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-10-01T00:00:00.000Z'),
    expiresAt: new Date('2026-12-01T00:00:00.000Z'),
    revokedAt: null,
  };
}

function member(overrides: Partial<MemberRow> = {}): MemberRow {
  return {
    membershipId: 'membership-1',
    userId: PEER,
    displayName: 'Sari',
    role: 'responder',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    revokedAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

interface Doubles {
  audits: () => unknown[];
  revokedUsers: string[];
  roleChanges: { membershipId: string; role: string }[];
}

function build(overrides: {
  members?: readonly MemberRow[];
  target?: MemberRow | null;
  inviteCreated?: { id: string } | null;
  inviteRevoked?: boolean;
} = {}): { service: PartnerMembersService; doubles: Doubles } {
  const revokedUsers: string[] = [];
  const roleChanges: { membershipId: string; role: string }[] = [];
  const members = overrides.members ?? [
    member({ membershipId: 'm-self', userId: SELF, displayName: 'Budi', role: 'admin' }),
    member(),
    member({ membershipId: 'm-third', userId: THIRD, displayName: 'Tono', role: 'admin' }),
  ];

  const repository = {
    listMembers: async () => [...members],
    findMembership: async () => (overrides.target === undefined ? members[1] : overrides.target),
    updateMembershipRole: async (_tx: Transaction, membershipId: string, role: string) => {
      roleChanges.push({ membershipId, role });
      return true;
    },
    revokeMembership: async () => true,
    revokeSessionsForUser: async (_tx: Transaction, userId: string) => {
      revokedUsers.push(userId);
      return 2;
    },
    createInvite: async () => (overrides.inviteCreated === undefined ? { id: 'invite-1' } : overrides.inviteCreated),
    listInvites: async () => [],
    revokeInvite: async () => overrides.inviteRevoked ?? true,
  } as unknown as AccountabilityRepository;

  const audit = recordingAudit();

  return {
    service: new PartnerMembersService(repository, audit.service, passthroughRunner),
    doubles: {
      audits: () => audit.records,
      revokedUsers,
      roleChanges,
    },
  };
}

describe('PartnerMembersService.list', () => {
  it('marks the actor and counts active admins', async () => {
    const { service } = build();
    const result = await service.list(session());
    expect(result.members.find((entry) => entry.userId === SELF)?.isSelf).toBe(true);
    expect(result.activeAdmins).toBe(2);
    expect(result.caveats.join(' ')).toContain('mengakhiri seluruh sesi');
  });
});

describe('PartnerMembersService.changeRole', () => {
  it('refuses a responder managing members', async () => {
    const { service } = build();
    await expect(
      service.changeRole('membership-1', 'viewer', session('responder')),
    ).rejects.toThrow(/manage_members/u);
  });

  it('refuses changing your own role', async () => {
    const { service } = build({
      target: member({ membershipId: 'm-self', userId: SELF, role: 'admin' }),
    });
    await expect(service.changeRole('m-self', 'responder', session())).rejects.toThrow(
      /sendiri/u,
    );
  });

  it('promotes a responder to admin', async () => {
    const { service, doubles } = build();
    const updated = await service.changeRole('membership-1', 'admin', session());
    expect(updated.membershipId).toBe('membership-1');
    expect(doubles.roleChanges).toEqual([{ membershipId: 'membership-1', role: 'admin' }]);
    expect(doubles.audits().length).toBeGreaterThanOrEqual(1);
  });

  it('refuses demoting the only admin when the actor is not a member', async () => {
    const onlyAdmin = member({ membershipId: 'm-only', userId: PEER, role: 'admin' });
    const { service } = build({
      target: onlyAdmin,
      members: [onlyAdmin],
    });
    await expect(service.changeRole('m-only', 'responder', session())).rejects.toThrow(
      /minimal satu admin/u,
    );
  });

  it('rejects an unknown membership', async () => {
    const { service } = build({ target: null });
    await expect(service.changeRole('missing', 'admin', session())).rejects.toThrow(
      /tidak ditemukan/u,
    );
  });
});

describe('PartnerMembersService.revoke', () => {
  it('revokes the membership and every session of that user', async () => {
    const { service, doubles } = build();
    const result = await service.revoke('membership-1', session());
    expect(result.revoked).toBe(true);
    expect(doubles.revokedUsers).toEqual([PEER]);
  });

  it('refuses revoking yourself', async () => {
    const { service } = build({
      target: member({ membershipId: 'm-self', userId: SELF, role: 'admin' }),
    });
    await expect(service.revoke('m-self', session())).rejects.toThrow(/sendiri/u);
  });

  it('refuses revoking the last admin', async () => {
    const onlyAdmin = member({ membershipId: 'm-only', userId: PEER, role: 'admin' });
    const { service } = build({ target: onlyAdmin, members: [onlyAdmin] });
    await expect(service.revoke('m-only', session())).rejects.toThrow(
      /minimal satu admin/u,
    );
  });
});

describe('PartnerMembersService.invite', () => {
  it('issues a single use token and records the audit action', async () => {
    const { service, doubles } = build();
    const issued = await service.invite({ email: 'sari@dishub.go.id', role: 'responder' }, session());
    expect(issued.inviteToken.length).toBeGreaterThanOrEqual(20);
    expect(issued.invite.emailMasked).toContain('@dishub.go.id');
    expect(issued.invite.pending).toBe(true);
    expect(
      doubles.audits().map((entry) => (entry as { action: string }).action),
    ).toContain('partner.member_invited');
  });

  it('masks the local part of the email', async () => {
    const { service } = build();
    const issued = await service.invite({ email: 'sari@dishub.go.id', role: 'viewer' }, session());
    expect(issued.invite.emailMasked).not.toContain('sari');
    expect(issued.invite.emailMasked.startsWith('sa')).toBe(true);
  });

  it('refuses a duplicate pending invite', async () => {
    const { service } = build({ inviteCreated: null });
    await expect(
      service.invite({ email: 'sari@dishub.go.id', role: 'responder' }, session()),
    ).rejects.toThrow(/Sudah ada undangan aktif/u);
  });

  it('refuses a responder issuing an invite', async () => {
    const { service } = build();
    await expect(
      service.invite({ email: 'sari@dishub.go.id', role: 'responder' }, session('responder')),
    ).rejects.toThrow(/manage_members/u);
  });
});

describe('PartnerMembersService.revokeInvite', () => {
  it('reports a missing invite', async () => {
    const { service } = build({ inviteRevoked: false });
    await expect(service.revokeInvite('invite-x', session())).rejects.toThrow(
      /tidak ditemukan atau sudah dipakai/u,
    );
  });

  it('records the revocation', async () => {
    const { service, doubles } = build();
    const result = await service.revokeInvite('invite-1', session());
    expect(result.revoked).toBe(true);
    expect(
      doubles.audits().map((entry) => (entry as { action: string }).action),
    ).toContain('partner.invite_revoked');
  });
});
