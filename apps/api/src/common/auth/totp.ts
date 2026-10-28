import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const DEFAULT_WINDOW = 1;
const SECRET_BYTES = 20;

export const TOTP_STEP_SECONDS = STEP_SECONDS;
export const TOTP_DIGITS = DIGITS;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(raw: string): Buffer {
  const normalized = raw.replace(/=+$/u, '').replace(/\s+/gu, '').toUpperCase();
  if (!/^[A-Z2-7]+$/u.test(normalized)) {
    throw new Error('Secret TOTP bukan base32 yang valid.');
  }
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error('Secret TOTP bukan base32 yang valid.');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): { secret: Buffer; base32: string } {
  const secret = randomBytes(SECRET_BYTES);
  return { secret, base32: base32Encode(secret) };
}

export function totpStep(atMs: number): number {
  return Math.floor(atMs / 1000 / STEP_SECONDS);
}

export function hotp(secret: Buffer, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export function totpAt(secret: Buffer, atMs: number): string {
  return hotp(secret, totpStep(atMs));
}

export interface TotpVerification {
  ok: boolean;
  step: number | null;
  reason: 'ok' | 'replay' | 'mismatch';
}

export function verifyTotp(
  secret: Buffer,
  code: string,
  atMs: number,
  lastUsedStep: number | null,
  window: number = DEFAULT_WINDOW,
): TotpVerification {
  if (!/^\d{6}$/u.test(code)) {
    return { ok: false, step: null, reason: 'mismatch' };
  }
  const current = totpStep(atMs);
  const provided = Buffer.from(code, 'utf8');
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateStep = current + offset;
    if (candidateStep < 0) {
      continue;
    }
    if (lastUsedStep !== null && candidateStep <= lastUsedStep) {
      continue;
    }
    const expected = Buffer.from(hotp(secret, candidateStep), 'utf8');
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      return { ok: true, step: candidateStep, reason: 'ok' };
    }
  }
  const replayStep =
    lastUsedStep === null
      ? null
      : current - window <= lastUsedStep
        ? lastUsedStep
        : null;
  return {
    ok: false,
    step: null,
    reason: replayStep === null ? 'mismatch' : 'replay',
  };
}

export function otpauthUri(input: {
  secretBase32: string;
  accountName: string;
  issuer: string;
}): string {
  const label = `${input.issuer}:${input.accountName}`;
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}
