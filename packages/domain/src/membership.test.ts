import { describe, expect, it } from 'vitest';
import {
  activeAdminCount,
  capabilitiesOf,
  describeMembership,
  evaluateMemberAction,
  highestRole,
  memberCan,
  memberDenialReason,
  membershipCaveats,
  nextRole,
  roleRank,
  type MemberRecord,
} from './membership';

function member(overrides: Partial<MemberRecord> = {}): MemberRecord {
  return {
    membershipId: 'membership-1',
    userId: 'user-1',
    displayName: 'Budi',
    role: 'responder',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    revokedAt: null,
    lastSeenAt: null,
    ...overrides,
  };
}

describe('roleRank dan capabilitiesOf', () => {
  it('orders viewer below responder below admin', () => {
    expect(roleRank('viewer')).toBeLessThan(roleRank('responder'));
    expect(roleRank('responder')).toBeLessThan(roleRank('admin'));
  });

  it('gives admins every capability', () => {
    const capabilities = capabilitiesOf('admin');
    expect(capabilities).toContain('manage_members');
    expect(capabilities).toContain('verify_resolution');
    expect(capabilities).toContain('act_on_report');
  });

  it('gives viewers only read capabilities', () => {
    const capabilities = capabilitiesOf('viewer');
    expect(capabilities).toContain('read_inbox');
    expect(capabilities).not.toContain('act_on_report');
    expect(capabilities).not.toContain('manage_members');
  });

  it('gives responders action but not member management', () => {
    expect(memberCan('responder', 'act_on_report')).toBe(true);
    expect(memberCan('responder', 'manage_members')).toBe(false);
  });
});

describe('memberDenialReason', () => {
  it('returns null when the capability is present', () => {
    expect(memberDenialReason('admin', 'manage_members')).toBeNull();
  });

  it('names the minimum role needed', () => {
    const reason = memberDenialReason('viewer', 'publish_response');
    expect(reason).toContain('responder');
  });
});

describe('highestRole', () => {
  it('picks the strongest role present', () => {
    expect(highestRole(['viewer', 'admin', 'responder'])).toBe('admin');
  });

  it('returns null for an empty list', () => {
    expect(highestRole([])).toBeNull();
  });
});

describe('activeAdminCount', () => {
  it('ignores revoked and suspended admins', () => {
    const count = activeAdminCount([
      member({ membershipId: 'a', role: 'admin' }),
      member({
        membershipId: 'b',
        role: 'admin',
        revokedAt: '2026-05-01T00:00:00.000Z',
      }),
      member({ membershipId: 'c', role: 'admin', status: 'suspended' }),
      member({ membershipId: 'd', role: 'responder' }),
    ]);
    expect(count).toBe(1);
  });
});

describe('evaluateMemberAction', () => {
  it('blocks a responder from managing members', () => {
    const decision = evaluateMemberAction('revoke', {
      actorUserId: 'actor',
      actorRole: 'responder',
      target: member(),
      members: [member({ role: 'admin' })],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('manage_members');
  });

  it('blocks acting on your own membership', () => {
    const decision = evaluateMemberAction('demote', {
      actorUserId: 'user-1',
      actorRole: 'admin',
      target: member({ userId: 'user-1', role: 'admin' }),
      members: [member({ userId: 'user-1', role: 'admin' }), member({ membershipId: 'x' })],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('sendiri');
  });

  it('blocks revoking the only admin when the actor is not a member', () => {
    const target = member({ membershipId: 'admin-1', userId: 'other', role: 'admin' });
    const decision = evaluateMemberAction('revoke', {
      actorUserId: 'platform-admin',
      actorRole: 'admin',
      target,
      members: [target],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('minimal satu admin');
  });

  it('blocks demoting the only admin when the actor is not a member', () => {
    const target = member({ membershipId: 'admin-1', userId: 'other', role: 'admin' });
    const decision = evaluateMemberAction('demote', {
      actorUserId: 'platform-admin',
      actorRole: 'admin',
      target,
      members: [target],
    });
    expect(decision.allowed).toBe(false);
  });

  it('ignores suspended admins when counting survivors', () => {
    const target = member({ membershipId: 'admin-1', userId: 'other', role: 'admin' });
    const decision = evaluateMemberAction('revoke', {
      actorUserId: 'platform-admin',
      actorRole: 'admin',
      target,
      members: [target, member({ membershipId: 'b', role: 'admin', status: 'suspended' })],
    });
    expect(decision.allowed).toBe(false);
  });

  it('allows revoking one of two admins', () => {
    const target = member({ membershipId: 'admin-1', userId: 'other', role: 'admin' });
    const decision = evaluateMemberAction('revoke', {
      actorUserId: 'user-1',
      actorRole: 'admin',
      target,
      members: [
        member({ membershipId: 'admin-2', userId: 'user-1', role: 'admin' }),
        target,
      ],
    });
    expect(decision.allowed).toBe(true);
  });

  it('allows promoting a responder to admin', () => {
    const decision = evaluateMemberAction('promote', {
      actorUserId: 'user-1',
      actorRole: 'admin',
      target: member({ userId: 'other' }),
      members: [member({ userId: 'user-1', role: 'admin' }), member({ userId: 'other' })],
    });
    expect(decision.allowed).toBe(true);
  });

  it('refuses to revoke an already revoked member', () => {
    const decision = evaluateMemberAction('revoke', {
      actorUserId: 'user-1',
      actorRole: 'admin',
      target: member({
        userId: 'other',
        revokedAt: '2026-05-01T00:00:00.000Z',
      }),
      members: [member({ userId: 'user-1', role: 'admin' })],
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('sudah dicabut');
  });

  it('refuses to promote a revoked member', () => {
    const decision = evaluateMemberAction('promote', {
      actorUserId: 'user-1',
      actorRole: 'admin',
      target: member({
        userId: 'other',
        revokedAt: '2026-05-01T00:00:00.000Z',
      }),
      members: [member({ userId: 'user-1', role: 'admin' })],
    });
    expect(decision.allowed).toBe(false);
  });
});

describe('nextRole', () => {
  it('promotes upward and stops at admin', () => {
    expect(nextRole('viewer', 'promote')).toBe('responder');
    expect(nextRole('responder', 'promote')).toBe('admin');
    expect(nextRole('admin', 'promote')).toBeNull();
  });

  it('demotes downward and stops at viewer', () => {
    expect(nextRole('admin', 'demote')).toBe('responder');
    expect(nextRole('responder', 'demote')).toBe('viewer');
    expect(nextRole('viewer', 'demote')).toBeNull();
  });
});

describe('describeMembership', () => {
  it('describes active, suspended and revoked members', () => {
    expect(describeMembership(member())).toContain('responder');
    expect(describeMembership(member({ status: 'suspended' }))).toContain('ditangguhkan');
    expect(
      describeMembership(member({ revokedAt: '2026-05-01T00:00:00.000Z' })),
    ).toContain('dicabut');
  });
});

describe('membershipCaveats', () => {
  it('states that revocation ends sessions', () => {
    const text = membershipCaveats().join(' ');
    expect(text).toContain('mengakhiri seluruh sesi');
    expect(text).toContain('nol admin');
  });
});
