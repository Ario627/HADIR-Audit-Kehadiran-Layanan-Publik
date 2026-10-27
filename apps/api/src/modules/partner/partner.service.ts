import { Injectable } from '@nestjs/common';
import type { PartnerSessionInput } from '@hadir/contracts';
import { AuditService } from '../../common/audit/audit.service';
import { env } from '../../common/config/env';
import { AppError } from '../../common/errors/app-error';
import { hashEmail, normalizeEmail } from '../../common/auth/email-identity';
import { verifyInvite } from '../../common/auth/invite-token';
import type { PartnerSession } from '../../common/auth/partner-session';
import { SESSION_POLICY } from '../../common/auth/session-policy.constants';
import { PartnerRepository, type MembershipRow } from '../../db/repositories/partner.repository';
import { PartnerAuthService, type IssuedSession } from './partner-auth.service';
import { PartnerCredentialService } from './partner-credential.service';
import { PartnerOtpService } from './partner-otp.service';

export interface LoginContext {
  requestId: string;
  ipHash: string | null;
  userAgentHash: string | null;
}

export interface PartnerProfile {
  userId: string;
  displayName: string;
  institutionId: string;
  institutionName: string;
  role: PartnerSession['role'];
  expiresAt: string;
  createdAt: string;
}

interface ResolvedIdentity {
  userId: string;
  displayName: string;
  membership: MembershipRow;
}

const GENERIC_LOGIN_FAILURE = 'Email atau kredensial tidak cocok.';

function toProfile(session: PartnerSession): PartnerProfile {
  return {
    userId: session.userId,
    displayName: session.displayName,
    institutionId: session.institutionId,
    institutionName: session.institutionName,
    role: session.role,
    expiresAt: session.expiresAt.toISOString(),
    createdAt: session.createdAt.toISOString(),
  };
}

@Injectable()
export class PartnerService {
  constructor(
    private readonly repository: PartnerRepository,
    private readonly auth: PartnerAuthService,
    private readonly audit: AuditService,
    private readonly credentials: PartnerCredentialService,
    private readonly otp: PartnerOtpService,
  ) {}

  private async issue(
    userId: string,
    membership: MembershipRow,
    context: LoginContext,
    via: PartnerSessionInput['method'],
    inviteJti: string | null,
    now: Date,
  ): Promise<IssuedSession> {
    const issued = this.auth.issueToken();
    await this.repository.createSession({
      userId,
      membershipId: membership.id,
      tokenHash: issued.tokenHash,
      inviteJti,
      expiresAt: new Date(now.getTime() + SESSION_POLICY.absoluteMs),
      ipHash: context.ipHash,
      userAgentHash: context.userAgentHash,
    });
    const session = await this.repository.findSessionByTokenHash(issued.tokenHash);
    if (session === null) {
      throw new AppError('INTERNAL_ERROR', { detail: 'Sesi gagal dibuat.' });
    }
    await this.audit.record({
      action: 'partner.login',
      objectType: 'device',
      objectId: userId,
      actor: {
        kind: 'partner',
        userId,
        institutionId: membership.institutionId,
        role: membership.role,
      },
      requestId: context.requestId,
      ipHash: context.ipHash,
      payload: { institutionId: membership.institutionId, role: membership.role, via },
    });
    return { token: issued.token, session };
  }

  async resolveByEmail(email: string): Promise<ResolvedIdentity | null> {
    const normalized = normalizeEmail(email);
    if (normalized === null) {
      return null;
    }
    const user = await this.repository.findUserByEmailHash(
      hashEmail(normalized, env.SESSION_SECRET),
    );
    if (user === null) {
      return null;
    }
    const membership = await this.repository.findAnyActiveMembership(user.userId);
    if (membership === null) {
      return null;
    }
    return { userId: user.userId, displayName: user.displayName, membership };
  }

  async login(
    input: PartnerSessionInput,
    context: LoginContext,
    now: Date = new Date(),
  ): Promise<IssuedSession> {
    switch (input.method) {
      case 'invite':
        return this.loginWithInvite(input.inviteToken, context, now);
      case 'password':
        return this.loginWithPassword(input.email, input.password, context, now);
      case 'otp':
        return this.loginWithOtp(input.email, input.code, context, now);
    }
  }

  private async loginWithInvite(
    inviteToken: string,
    context: LoginContext,
    now: Date,
  ): Promise<IssuedSession> {
    const decoded = verifyInvite(inviteToken, env.SESSION_SECRET, now);
    if (decoded === null) {
      await this.audit.record({
        action: 'partner.login_failed',
        objectType: 'device',
        requestId: context.requestId,
        ipHash: context.ipHash,
        payload: { reason: 'invite_invalid' },
      });
      throw new AppError('UNAUTHENTICATED', { detail: 'Undangan tidak valid atau kedaluwarsa.' });
    }

    const membership = await this.repository.findActiveMembership(
      decoded.payload.sub,
      decoded.payload.inst,
    );
    if (membership === null || membership.role !== decoded.payload.role) {
      await this.audit.record({
        action: 'partner.login_failed',
        objectType: 'device',
        requestId: context.requestId,
        ipHash: context.ipHash,
        payload: { reason: 'membership_mismatch' },
      });
      throw new AppError('UNAUTHENTICATED', { detail: 'Undangan tidak valid atau kedaluwarsa.' });
    }

    return this.issue(decoded.payload.sub, membership, context, 'invite', decoded.payload.jti, now);
  }

  private async loginWithPassword(
    email: string,
    password: string,
    context: LoginContext,
    now: Date,
  ): Promise<IssuedSession> {
    const identity = await this.resolveByEmail(email);
    const outcome = await this.credentials.verify(
      {
        userId: identity?.userId ?? null,
        password,
        requestId: context.requestId,
        ipHash: context.ipHash,
      },
      now,
    );
    if (!outcome.ok || identity === null) {
      throw new AppError('UNAUTHENTICATED', { detail: GENERIC_LOGIN_FAILURE });
    }
    return this.issue(identity.userId, identity.membership, context, 'password', null, now);
  }

  private async loginWithOtp(
    email: string,
    code: string,
    context: LoginContext,
    now: Date,
  ): Promise<IssuedSession> {
    const identity = await this.resolveByEmail(email);
    if (identity === null) {
      await this.audit.record({
        action: 'partner.login_failed',
        objectType: 'device',
        requestId: context.requestId,
        ipHash: context.ipHash,
        payload: { reason: 'otp_unknown_email' },
      });
      throw new AppError('UNAUTHENTICATED', { detail: GENERIC_LOGIN_FAILURE });
    }
    const valid = await this.otp.verify(identity.userId, code, context, now);
    if (!valid) {
      throw new AppError('UNAUTHENTICATED', { detail: GENERIC_LOGIN_FAILURE });
    }
    return this.issue(identity.userId, identity.membership, context, 'otp', null, now);
  }

  async logout(session: PartnerSession, requestId: string, now: Date = new Date()): Promise<void> {
    await this.auth.revoke(session.sessionId, now);
    await this.audit.record({
      action: 'partner.logout',
      objectType: 'device',
      objectId: session.userId,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      requestId,
    });
  }

  async revokeUserSessions(
    userId: string,
    requestId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const revoked = await this.repository.revokeAllForUser(userId, now);
    await this.audit.record({
      action: 'partner.sessions_revoked',
      objectType: 'device',
      objectId: userId,
      requestId,
      payload: { revoked },
    });
    return revoked;
  }

  async resolveIdentity(email: string): Promise<{ userId: string } | null> {
    const identity = await this.resolveByEmail(email);
    return identity === null ? null : { userId: identity.userId };
  }

  me(session: PartnerSession): PartnerProfile {
    return toProfile(session);
  }
}
