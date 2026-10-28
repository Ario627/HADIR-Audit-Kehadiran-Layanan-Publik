import { Injectable } from '@nestjs/common';
import type { PlatformAdminSession } from '../../common/auth/platform-session';
import { hashPassword, passwordWithinLimits, burnPasswordTime, verifyPassword } from '../../common/auth/password';
import { platformRolesSatisfy } from '../../common/auth/roles';
import type { PlatformAdminRoleName } from '../../common/auth/roles';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenShape,
} from '../../common/auth/session-token';
import { verifyTotp, type TotpVerification } from '../../common/auth/totp';
import { env } from '../../common/config/env';
import { open as secretBoxOpen, seal as secretBoxSeal } from '../../common/crypto/secret-box';
import { contactCipherFromEnv } from '../../common/crypto/contact-key';
import { AppError } from '../../common/errors/app-error';
import { PlatformAdminRepository } from '../../db/repositories/platform-admin.repository';
import { AuditService } from '../../common/audit/audit.service';

const TOUCH_THRESHOLD_MS = 60_000;

export interface IssuedPlatformSession {
  token: string;
  session: PlatformAdminSession;
}

export interface ResolvedPlatformSession {
  session: PlatformAdminSession;
}

export interface LoginAttempt {
  email: string;
  password: string;
  totp: string;
  requestId: string;
  ipHash: string | null;
  userAgentHash: string | null;
}

export function totpSecretOf(stored: Buffer): Buffer {
  return Buffer.from(secretBoxOpen(stored, contactCipherFromEnv().key), 'base64');
}

export function sealTotpSecret(secret: Buffer): Buffer {
  return secretBoxSeal(secret.toString('base64'), contactCipherFromEnv().key);
}

export function remainingIdle(expiresAt: Date, now: Date): number {
  return Math.max(0, expiresAt.getTime() - now.getTime());
}

export function platformSessionUsable(
  session: PlatformAdminSession,
  now: Date,
): boolean {
  if (session.revokedAt !== null) {
    return false;
  }
  return session.expiresAt.getTime() > now.getTime();
}

export function platformRoleAllowed(
  role: PlatformAdminRoleName,
  required: readonly PlatformAdminRoleName[],
): boolean {
  return platformRolesSatisfy(role, required);
}

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly repository: PlatformAdminRepository,
    private readonly audit: AuditService,
  ) {}

  cookieName(): string {
    return env.adminSessionCookieName;
  }

  cookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict';
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'strict' as const,
      path: '/',
      maxAge: env.adminSessionAbsoluteMs,
    };
  }

  clearedCookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'strict';
    path: string;
  } {
    return {
      httpOnly: true,
      secure: env.cookieSecure,
      sameSite: 'strict' as const,
      path: '/',
    };
  }

  async login(attempt: LoginAttempt, now: Date = new Date()): Promise<IssuedPlatformSession> {
    const identity = await this.repository.findAdminByEmail(attempt.email);
    if (identity === null) {
      await burnPasswordTime(attempt.password);
      await this.audit.record({
        action: 'admin.login_failed',
        objectType: 'system',
        objectId: null,
        actor: null,
        requestId: attempt.requestId,
        ipHash: attempt.ipHash,
        payload: { reason: 'unknown_admin' },
      });
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Kredensial admin tidak valid.',
      });
    }
    if (identity.disabledAt !== null) {
      await burnPasswordTime(attempt.password);
      await this.audit.record({
        action: 'admin.login_failed',
        objectType: 'system',
        objectId: identity.adminId,
        actor: null,
        requestId: attempt.requestId,
        ipHash: attempt.ipHash,
        payload: { reason: 'disabled' },
      });
      throw new AppError('FORBIDDEN', { detail: 'Akun admin dinonaktifkan.' });
    }
    if (!passwordWithinLimits(attempt.password)) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Kredensial admin tidak valid.' });
    }

    const passwordOk = await verifyPassword(identity.passwordHash, attempt.password);
    if (!passwordOk) {
      await this.audit.record({
        action: 'admin.login_failed',
        objectType: 'system',
        objectId: identity.adminId,
        actor: null,
        requestId: attempt.requestId,
        ipHash: attempt.ipHash,
        payload: { reason: 'password' },
      });
      throw new AppError('UNAUTHENTICATED', { detail: 'Kredensial admin tidak valid.' });
    }

    const secret = totpSecretOf(identity.totpSecretEnc);
    const verification: TotpVerification = verifyTotp(
      secret,
      attempt.totp,
      now.getTime(),
      identity.lastTotpStep,
    );
    if (!verification.ok) {
      await this.audit.record({
        action: 'admin.login_failed',
        objectType: 'system',
        objectId: identity.adminId,
        actor: null,
        requestId: attempt.requestId,
        ipHash: attempt.ipHash,
        payload: { reason: verification.reason },
      });
      throw new AppError('UNAUTHENTICATED', {
        detail:
          verification.reason === 'replay'
            ? 'Kode TOTP sudah dipakai. Tunggu kode berikutnya.'
            : 'Kode TOTP tidak valid.',
      });
    }

    const claimed = await this.repository.recordTotpStep(identity.adminId, verification.step!);
    if (!claimed) {
      await this.audit.record({
        action: 'admin.login_failed',
        objectType: 'system',
        objectId: identity.adminId,
        actor: null,
        requestId: attempt.requestId,
        ipHash: attempt.ipHash,
        payload: { reason: 'replay_race' },
      });
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Kode TOTP sudah dipakai. Tunggu kode berikutnya.',
      });
    }

    const token = generateSessionToken();
    const sessionId = await this.repository.createSession({
      adminId: identity.adminId,
      tokenHash: hashSessionToken(token),
      ipHash: attempt.ipHash ? Buffer.from(attempt.ipHash, 'hex') : null,
      userAgentHash: attempt.userAgentHash
        ? Buffer.from(attempt.userAgentHash, 'hex')
        : null,
      idleExpiresAt: new Date(now.getTime() + env.adminSessionIdleMs),
      absoluteExpiresAt: new Date(now.getTime() + env.adminSessionAbsoluteMs),
    });

    await this.audit.record({
      action: 'admin.login',
      objectType: 'system',
      objectId: identity.adminId,
      actor: { kind: 'superadmin', userId: identity.adminId },
      requestId: attempt.requestId,
      ipHash: attempt.ipHash,
      payload: { role: identity.role },
    });

    return {
      token,
      session: {
        sessionId,
        adminId: identity.adminId,
        email: identity.email,
        displayName: identity.displayName,
        role: identity.role,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + env.adminSessionAbsoluteMs),
        revokedAt: null,
      },
    };
  }

  async resolve(
    rawToken: string | null,
    now: Date = new Date(),
  ): Promise<ResolvedPlatformSession | null> {
    if (rawToken === null || !isSessionTokenShape(rawToken)) {
      return null;
    }
    const session = await this.repository.findSessionByTokenHash(hashSessionToken(rawToken));
    if (session === null || !platformSessionUsable(session, now)) {
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_THRESHOLD_MS) {
      await this.repository.touchSession(
        session.sessionId,
        new Date(now.getTime() + env.adminSessionIdleMs),
      );
    }
    return { session };
  }

  async logout(session: PlatformAdminSession, requestId: string): Promise<void> {
    await this.repository.revokeSession(session.sessionId);
    await this.audit.record({
      action: 'admin.logout',
      objectType: 'system',
      objectId: session.adminId,
      actor: { kind: session.role, userId: session.adminId },
      requestId,
      payload: {},
    });
  }

  async createAdmin(input: {
    email: string;
    displayName: string;
    role: PlatformAdminRoleName;
    password: string;
    totpSecret: Buffer;
  }): Promise<string> {
    if (!passwordWithinLimits(input.password)) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Kata sandi admin minimal 12 karakter.',
      });
    }
    const hash = await hashPassword(input.password);
    return this.repository.insertAdmin({
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      passwordHash: Buffer.from(hash, 'utf8'),
      totpSecretEnc: sealTotpSecret(input.totpSecret),
    });
  }
}
