import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  activeAdminCount,
  evaluateMemberAction,
  memberCan,
  memberDenialReason,
  membershipCaveats,
  nextRole,
  type MemberAction,
  type MemberRecord,
  type MemberRole,
} from '@hadir/domain';
import type {
  PartnerInvite,
  PartnerInviteCreate,
  PartnerInviteIssued,
  PartnerMember,
  PartnerMemberList,
} from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../common/audit/audit.service';
import type { PartnerSession } from '../../common/auth/partner-session';
import { env } from '../../common/config/env';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import { db } from '../../db/client';
import {
  AccountabilityRepository,
  type InviteRow,
  type MemberRow,
} from '../../db/repositories/accountability.repository';
import { hashSessionToken } from '../../common/auth/session-token';
import { normalizeEmail } from '../../common/auth/email-identity';
import { contactCipherFromEnv, contactEmailHash } from '../../common/crypto/contact-key';
import { open, seal } from '../../common/crypto/secret-box';

const INVITE_TTL_MS = 7 * 86_400_000;

function toMember(row: MemberRow, selfUserId: string): MemberRecord & { isSelf: boolean } {
  return {
    membershipId: row.membershipId,
    userId: row.userId,
    displayName: row.displayName,
    role: row.role as MemberRole,
    status: row.status as MemberRecord['status'],
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    lastSeenAt: row.lastSeenAt === null ? null : row.lastSeenAt.toISOString(),
    isSelf: row.userId === selfUserId,
  };
}

function toView(member: MemberRecord & { isSelf: boolean }): PartnerMember {
  return {
    membershipId: member.membershipId,
    userId: member.userId,
    displayName: member.displayName,
    role: member.role,
    status: member.status,
    isSelf: member.isSelf,
    createdAt: member.createdAt,
    revokedAt: member.revokedAt,
    lastSeenAt: member.lastSeenAt,
  };
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) {
    return '***';
  }
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

function decodeEmail(cipher: Buffer): string | null {
  try {
    return open(cipher, contactCipherFromEnv().key);
  } catch {
    return null;
  }
}

function toInviteView(row: InviteRow, now: Date): PartnerInvite {
  const plain = decodeEmail(row.emailEnc);
  const pending =
    row.consumedAt === null && row.revokedAt === null && row.expiresAt.getTime() > now.getTime();
  return {
    inviteId: row.id,
    emailMasked: plain === null ? '***' : maskEmail(plain),
    role: row.role as MemberRole,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    consumedAt: row.consumedAt === null ? null : row.consumedAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    pending,
  };
}

@Injectable()
export class PartnerMembersService {
  constructor(
    private readonly repository: AccountabilityRepository,
    private readonly audit: AuditService,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  private assertManage(session: PartnerSession): void {
    if (!memberCan(session.role, 'manage_members')) {
      throw new AppError('FORBIDDEN', {
        detail:
          memberDenialReason(session.role, 'manage_members') ??
          'Anda tidak dapat mengelola anggota institusi.',
      });
    }
  }

  private evaluate(
    action: MemberAction,
    session: PartnerSession,
    target: MemberRow,
    members: readonly MemberRow[],
  ): void {
    const records = members.map((row) => toMember(row, session.userId));
    const decision = evaluateMemberAction(action, {
      actorUserId: session.userId,
      actorRole: session.role,
      target: toMember(target, session.userId),
      members: records,
    });
    if (!decision.allowed) {
      throw new AppError('FORBIDDEN', {
        detail: decision.reason ?? 'Langkah ini tidak diizinkan.',
      });
    }
  }

  async list(session: PartnerSession): Promise<PartnerMemberList> {
    const rows = await this.repository.listMembers(db, session.institutionId);
    const records = rows.map((row) => toMember(row, session.userId));
    return {
      members: records.map(toView),
      activeAdmins: activeAdminCount(records),
      caveats: [...membershipCaveats()].slice(0, 4),
    };
  }

  async changeRole(
    membershipId: string,
    role: MemberRole,
    session: PartnerSession,
  ): Promise<PartnerMember> {
    this.assertManage(session);
    const updated = await this.run(
      async (tx) => {
        const target = await this.repository.findMembership(
          tx,
          session.institutionId,
          membershipId,
        );
        if (target === null) {
          return null;
        }
        const members = await this.repository.listMembers(tx, session.institutionId);
        const action: MemberAction =
          role === target.role
            ? 'reinstate'
            : roleRankOf(role) > roleRankOf(target.role as MemberRole)
              ? 'promote'
              : 'demote';
        this.evaluate(action, session, target, members);
        const changed = await this.repository.updateMembershipRole(tx, membershipId, role);
        if (!changed) {
          throw new AppError('INVALID_TRANSITION', {
            detail: 'Peran anggota tidak dapat diubah.',
          });
        }
        const refreshed = await this.repository.findMembership(
          tx,
          session.institutionId,
          membershipId,
        );
        return refreshed;
      },
      {
        scope: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `partner-member-${session.userId.slice(0, 8)}`,
      },
    );
    if (updated === null) {
      throw new AppError('NOT_FOUND', { detail: 'Anggota tidak ditemukan.' });
    }
    await this.audit.record({
      action: 'partner.member_role_changed',
      objectType: 'report',
      objectId: membershipId,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      payload: { role },
    });
    return toView(toMember(updated, session.userId));
  }

  async revoke(membershipId: string, session: PartnerSession): Promise<{ revoked: boolean }> {
    this.assertManage(session);
    const result = await this.run(
      async (tx) => {
        const target = await this.repository.findMembership(
          tx,
          session.institutionId,
          membershipId,
        );
        if (target === null) {
          return null;
        }
        const members = await this.repository.listMembers(tx, session.institutionId);
        this.evaluate('revoke', session, target, members);
        const revoked = await this.repository.revokeMembership(tx, membershipId);
        if (!revoked) {
          throw new AppError('INVALID_TRANSITION', {
            detail: 'Anggota sudah dicabut aksesnya.',
          });
        }
        const sessions = await this.repository.revokeSessionsForUser(tx, target.userId);
        return { userId: target.userId, sessions };
      },
      {
        scope: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `partner-member-${session.userId.slice(0, 8)}`,
      },
    );
    if (result === null) {
      throw new AppError('NOT_FOUND', { detail: 'Anggota tidak ditemukan.' });
    }
    await this.audit.record({
      action: 'partner.member_revoked',
      objectType: 'report',
      objectId: membershipId,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      payload: { sessionsRevoked: result.sessions },
    });
    return { revoked: true };
  }

  async listInvites(session: PartnerSession): Promise<PartnerInvite[]> {
    this.assertManage(session);
    const now = new Date();
    const rows = await this.repository.listInvites(db, session.institutionId);
    return rows.map((row) => toInviteView(row, now));
  }

  async invite(
    input: PartnerInviteCreate,
    session: PartnerSession,
  ): Promise<PartnerInviteIssued> {
    this.assertManage(session);
    const normalized = normalizeEmail(input.email);
    if (normalized === null) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Surel undangan tidak valid.',
        errors: [
          { field: 'email', code: 'invalid_email', message: 'Tulis surel yang valid.' },
        ],
      });
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashSessionToken(token);
    const cipherKey = contactCipherFromEnv();
    const emailHash = contactEmailHash(normalized, cipherKey.pepper).toString('hex');
    const cipher = seal(normalized, cipherKey.key);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const created = await this.run(
      async (tx) =>
        this.repository.createInvite(tx, {
          institutionId: session.institutionId,
          emailHash,
          emailEnc: cipher,
          role: input.role,
          tokenHash,
          invitedBy: session.userId,
          expiresAt,
        }),
      {
        scope: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `partner-invite-${session.userId.slice(0, 8)}`,
      },
    );

    if (created === null) {
      throw new AppError('INVALID_TRANSITION', {
        detail: 'Sudah ada undangan aktif untuk alamat surel ini.',
      });
    }

    await this.audit.record({
      action: 'partner.member_invited',
      objectType: 'report',
      objectId: created.id,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      payload: { role: input.role },
    });

    return {
      invite: {
        inviteId: created.id,
        emailMasked: maskEmail(input.email),
        role: input.role,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        consumedAt: null,
        revokedAt: null,
        pending: true,
      },
      inviteToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revokeInvite(
    inviteId: string,
    session: PartnerSession,
  ): Promise<{ revoked: boolean }> {
    this.assertManage(session);
    const revoked = await this.run(
      async (tx) =>
        this.repository.revokeInvite(tx, session.institutionId, inviteId),
      {
        scope: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `partner-invite-${session.userId.slice(0, 8)}`,
      },
    );
    if (!revoked) {
      throw new AppError('NOT_FOUND', { detail: 'Undangan tidak ditemukan atau sudah dipakai.' });
    }
    await this.audit.record({
      action: 'partner.invite_revoked',
      objectType: 'report',
      objectId: inviteId,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      payload: {},
    });
    return { revoked: true };
  }

  async consumeInvite(inviteId: string, actorUserId: string): Promise<boolean> {
    return this.run(
      async (tx) => this.repository.consumeInvite(tx, inviteId),
      { scope: 'partner', userId: actorUserId, requestId: 'partner-invite-consume' },
    );
  }

  demotionTarget(role: MemberRole): MemberRole | null {
    return nextRole(role, 'demote');
  }

  inviteTtlDays(): number {
    return Math.round(INVITE_TTL_MS / 86_400_000);
  }

  retentionNote(): string {
    return `Undangan kedaluwarsa dalam ${this.inviteTtlDays()} hari dan hanya dapat dipakai sekali.`;
  }

  appOrigin(): string {
    return env.WEB_ORIGIN;
  }
}

function roleRankOf(role: MemberRole): number {
  if (role === 'admin') {
    return 3;
  }
  return role === 'responder' ? 2 : 1;
}
