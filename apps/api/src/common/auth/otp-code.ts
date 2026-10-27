import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_DIGITS = 6;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 60;

const CODE_PATTERN = /^[0-9]{6}$/;

export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, '0');
}

export function isOtpCodeShape(value: string): boolean {
  return CODE_PATTERN.test(value);
}

export function hashOtpCode(code: string, secret: string, userId: string): Buffer {
  return createHmac('sha256', secret)
    .update(`hadir.otp.v1|${userId}|${code}`)
    .digest();
}

export function otpCodesEqual(left: Buffer, right: Buffer): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export interface OtpChallengeState {
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export function otpChallengeUsable(
  state: OtpChallengeState,
  maxAttempts: number,
  now: Date,
): boolean {
  if (state.consumedAt !== null) {
    return false;
  }
  if (state.attempts >= maxAttempts) {
    return false;
  }
  return state.expiresAt.getTime() > now.getTime();
}

export function otpResendAllowed(state: OtpChallengeState, now: Date): boolean {
  return now.getTime() - state.createdAt.getTime() >= OTP_RESEND_SECONDS * 1_000;
}
