import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { Actor } from '../../common/http/request-context';
import type { PartnerSession } from '../../common/auth/partner-session';
import { AppError } from '../../common/errors/app-error';
import { passwordIssues } from '../../common/auth/credential-policy';
import {
  LOCKOUT_POLICY,
  isLocked,
  lockedUntilFor,
  nextFailureCount,
} from '../../common/auth/lockout';
import {
  burnPasswordTime,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../../common/auth/password';
import { PartnerCredentialRepository } from '../../db/repositories/partner-credential.repository';

export interface VerifyOutcome {
  ok: boolean;
  userId: string | null;
  lockedUntil: Date | null;
  failedCount: number;
}

export interface VerifyInput {
  userId: string | null;
  password: string;
  requestId: string;
  ipHash: string | null;
}

export interface ChangePasswordInput {
  session: PartnerSession;
  currentPassword: string;
  newPassword: string;
  requestId: string;
  ipHash: string | null;
}

@Injectable()
export class PartnerCredentialService {
  constructor(
    private readonly repository: PartnerCredentialRepository,
    private readonly audit: AuditService,
  ) {}

  async setPassword(userId: string, password: string): Promise<void> {
    const issues = passwordIssues(password);
    if (issues.length > 0) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Kata sandi belum memenuhi syarat.',
        errors: issues.map((issue) => ({
          field: 'password',
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    await this.repository.upsertPassword(userId, await hashPassword(password));
  }

  async verify(input: VerifyInput, now: Date = new Date()): Promise<VerifyOutcome> {
    if (input.userId === null) {
      await burnPasswordTime(input.password);
      return { ok: false, userId: null, lockedUntil: null, failedCount: 0 };
    }

    const lock = await this.repository.readLockState(input.userId);
    if (lock !== null && isLocked(lock.lockedUntil, now)) {
      await this.audit.record({
        action: 'partner.login_failed',
        objectType: 'device',
        objectId: input.userId,
        requestId: input.requestId,
        ipHash: input.ipHash,
        payload: { reason: 'locked', lockedUntil: lock.lockedUntil?.toISOString() ?? null },
      });
      return {
        ok: false,
        userId: input.userId,
        lockedUntil: lock.lockedUntil,
        failedCount: lock.failedLoginCount,
      };
    }

    const stored = await this.repository.findPasswordByUserId(input.userId);
    if (stored === null) {
      await burnPasswordTime(input.password);
      return this.registerFailure(input, lock?.failedLoginCount ?? 0, 'no_password', now);
    }

    const matches = await verifyPassword(stored.passwordHash, input.password);
    if (!matches) {
      return this.registerFailure(input, lock?.failedLoginCount ?? 0, 'wrong_password', now);
    }

    if (needsRehash(stored.passwordHash)) {
      await this.repository.upsertPassword(input.userId, await hashPassword(input.password));
    }
    await this.repository.clearFailures(input.userId);
    return { ok: true, userId: input.userId, lockedUntil: null, failedCount: 0 };
  }

  async changePassword(input: ChangePasswordInput): Promise<void> {
    const userId = input.session.userId;
    const actor: Actor = {
      kind: 'partner',
      userId,
      institutionId: input.session.institutionId,
      role: input.session.role,
    };
    const stored = await this.repository.findPasswordByUserId(userId);
    if (stored === null) {
      await burnPasswordTime(input.currentPassword);
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Kata sandi saat ini tidak cocok.',
      });
    }

    const matches = await verifyPassword(stored.passwordHash, input.currentPassword);
    if (!matches) {
      await this.audit.record({
        action: 'partner.login_failed',
        objectType: 'device',
        objectId: userId,
        actor,
        requestId: input.requestId,
        ipHash: input.ipHash,
        payload: { reason: 'password_change_wrong_current' },
      });
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Kata sandi saat ini tidak cocok.',
      });
    }

    const issues = passwordIssues(input.newPassword);
    if (issues.length > 0) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Kata sandi baru belum memenuhi syarat.',
        errors: issues.map((issue) => ({
          field: 'newPassword',
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    await this.repository.upsertPassword(userId, await hashPassword(input.newPassword));
    await this.repository.clearFailures(userId);
    await this.audit.record({
      action: 'partner.password_changed',
      objectType: 'device',
      objectId: userId,
      actor,
      requestId: input.requestId,
      ipHash: input.ipHash,
    });
  }

  private async registerFailure(
    input: VerifyInput,
    currentFailures: number,
    reason: string,
    now: Date,
  ): Promise<VerifyOutcome> {
    const userId = input.userId;
    const failedCount = nextFailureCount(currentFailures);
    const lockedUntil = lockedUntilFor(failedCount, now, LOCKOUT_POLICY);
    if (userId !== null) {
      await this.repository.recordFailure(userId, failedCount, lockedUntil);
    }
    await this.audit.record({
      action: 'partner.login_failed',
      objectType: 'device',
      objectId: userId,
      requestId: input.requestId,
      ipHash: input.ipHash,
      payload: { reason, failedCount, locked: lockedUntil !== null },
    });
    return { ok: false, userId, lockedUntil, failedCount };
  }
}
