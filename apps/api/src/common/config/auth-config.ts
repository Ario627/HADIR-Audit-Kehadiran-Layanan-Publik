import { env } from './env';

export interface WebAuthnConfig {
  rpId: string;
  rpName: string;
  origin: string[];
  challengeTtlMs: number;
}

export const WEBAUTHN: WebAuthnConfig = Object.freeze({
  rpId: env.webauthnRpId,
  rpName: 'HADIR',
  origin: [...env.webauthnOrigins],
  challengeTtlMs: 5 * 60 * 1_000,
});

export const OTP_PEPPER_PREFIX = 'hadir.otp.pepper.v1';
