import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { env } from '../../common/config/env';
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
  generateOtpCode,
  hashOtpCode,
  isOtpCodeShape,
  otpChallengeUsable,
  otpCodesEqual,
  otpResendAllowed,
} from '../../common/auth/otp-code';
import { OTP_DELIVERY, type OtpDelivery } from '../../common/auth/otp-delivery';
import { PartnerCredentialRepository } from '../../db/repositories/partner-credential.repository';

export interface OtpRequestContext {
  email: string;
  userId: string | null;
  requestId: string;
  ipHash: string | null;
}

export interface IssuedOtp {
  expiresInSeconds: number;
  resendInSeconds: number;
}

@Injectable()
export class PartnerOtpService {
  constructor(
    private readonly repository: PartnerCredentialRepository,
    private readonly audit: AuditService,
    @Inject(OTP_DELIVERY) private readonly delivery: OtpDelivery,
  ) {}

  private pepper(): string {
    return env.SESSION_SECRET;
  }

  async issue(context: OtpRequestContext, now: Date = new Date()): Promise<IssuedOtp> {
    if (context.userId === null) {
      await this.audit.record({
        action: 'partner.otp_requested',
        objectType: 'device',
        requestId: context.requestId,
        ipHash: context.ipHash,
        payload: { known: false },
      });
      return { expiresInSeconds: OTP_TTL_SECONDS, resendInSeconds: 0 };
    }

    const open = await this.repository.findLatestOpenOtp(context.userId);
    if (open !== null && !otpResendAllowed(open, now) && open.expiresAt.getTime() > now.getTime()) {
      return { expiresInSeconds: OTP_TTL_SECONDS, resendInSeconds: 0 };
    }

    await this.repository.deleteOpenOtps(context.userId);
    const code = generateOtpCode();
    const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1_000);
    await this.repository.insertOtp(
      context.userId,
      hashOtpCode(code, this.pepper(), context.userId),
      'login',
      expiresAt,
    );

    await this.delivery.send({
      email: context.email,
      code,
      expiresInSeconds: OTP_TTL_SECONDS,
      requestId: context.requestId,
    });
    await this.audit.record({
      action: 'partner.otp_requested',
      objectType: 'device',
      objectId: context.userId,
      requestId: context.requestId,
      ipHash: context.ipHash,
      payload: { known: true },
    });

    return { expiresInSeconds: OTP_TTL_SECONDS, resendInSeconds: 0 };
  }

  async verify(
    userId: string,
    code: string,
    context: { requestId: string; ipHash: string | null },
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!isOtpCodeShape(code)) {
      return false;
    }
    const challenge = await this.repository.findLatestOpenOtp(userId);
    if (challenge === null || !otpChallengeUsable(challenge, OTP_MAX_ATTEMPTS, now)) {
      await this.audit.record({
        action: 'partner.otp_failed',
        objectType: 'device',
        objectId: userId,
        requestId: context.requestId,
        ipHash: context.ipHash,
        payload: { reason: 'no_open_challenge' },
      });
      return false;
    }

    const expected = hashOtpCode(code, this.pepper(), userId);
    const matches = otpCodesEqual(expected, challenge.codeHash);
    if (!matches) {
      const attempts = await this.repository.bumpOtpAttempts(challenge.id);
      await this.audit.record({
        action: 'partner.otp_failed',
        objectType: 'device',
        objectId: userId,
        requestId: context.requestId,
        ipHash: context.ipHash,
        payload: { reason: 'wrong_code', attempts },
      });
      return false;
    }

    await this.repository.consumeOtp(challenge.id, now);
    return true;
  }
}
