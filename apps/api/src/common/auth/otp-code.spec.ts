import { createHmac } from 'node:crypto';
import {
  OTP_MAX_ATTEMPTS,
  generateOtpCode,
  hashOtpCode,
  isOtpCodeShape,
  otpChallengeUsable,
  otpCodesEqual,
  otpResendAllowed,
  type OtpChallengeState,
} from './otp-code';

const SECRET = 'y'.repeat(48);
const USER = '0192f0c4-0000-7000-8000-000000000001';
const NOW = new Date('2026-10-27T12:00:00.000Z');

function at(minutesAgo: number): Date {
  return new Date(NOW.getTime() - minutesAgo * 60 * 1000);
}

function state(overrides: Partial<OtpChallengeState> = {}): OtpChallengeState {
  return {
    createdAt: at(1),
    expiresAt: at(-4),
    attempts: 0,
    consumedAt: null,
    ...overrides,
  };
}

describe('generateOtpCode', () => {
  it('always produces exactly six digits', () => {
    for (let index = 0; index < 300; index += 1) {
      const code = generateOtpCode();
      expect(code).toHaveLength(6);
      expect(isOtpCodeShape(code)).toBe(true);
    }
  });

  it('keeps leading zeros instead of trimming them', () => {
    const codes = Array.from({ length: 4000 }, () => generateOtpCode());
    const withLeadingZero = codes.filter((code) => code.startsWith('0'));

    expect(withLeadingZero.length).toBeGreaterThan(0);
    expect(withLeadingZero.every((code) => code.length === 6)).toBe(true);
  });

  it('spreads across the full space', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateOtpCode()));

    expect(codes.size).toBeGreaterThan(400);
  });
});

describe('isOtpCodeShape', () => {
  it('rejects wrong lengths', () => {
    expect(isOtpCodeShape('12345')).toBe(false);
    expect(isOtpCodeShape('1234567')).toBe(false);
  });

  it('rejects non-digits', () => {
    expect(isOtpCodeShape('12345a')).toBe(false);
    expect(isOtpCodeShape(' 12345')).toBe(false);
    expect(isOtpCodeShape('')).toBe(false);
  });
});

describe('hashOtpCode', () => {
  it('returns 32 bytes', () => {
    expect(hashOtpCode('123456', SECRET, USER)).toHaveLength(32);
  });

  it('binds the hash to the user so a code cannot move accounts', () => {
    const other = '0192f0c4-0000-7000-8000-000000000002';

    expect(hashOtpCode('123456', SECRET, USER).equals(hashOtpCode('123456', SECRET, other))).toBe(
      false,
    );
  });

  it('binds the hash to the secret', () => {
    expect(
      hashOtpCode('123456', SECRET, USER).equals(hashOtpCode('123456', 'z'.repeat(48), USER)),
    ).toBe(false);
  });

  it('matches the documented HMAC construction', () => {
    const expected = createHmac('sha256', SECRET)
      .update(`hadir.otp.v1|${USER}|123456`)
      .digest();

    expect(hashOtpCode('123456', SECRET, USER).equals(expected)).toBe(true);
  });
});

describe('otpCodesEqual', () => {
  it('compares by content', () => {
    const hash = hashOtpCode('123456', SECRET, USER);

    expect(otpCodesEqual(hash, Buffer.from(hash))).toBe(true);
  });

  it('rejects different lengths without throwing', () => {
    expect(otpCodesEqual(Buffer.alloc(32), Buffer.alloc(8))).toBe(false);
  });
});

describe('otpChallengeUsable', () => {
  it('accepts a fresh untouched challenge', () => {
    expect(otpChallengeUsable(state(), OTP_MAX_ATTEMPTS, NOW)).toBe(true);
  });

  it('rejects a consumed challenge so a code cannot be replayed', () => {
    expect(otpChallengeUsable(state({ consumedAt: at(0) }), OTP_MAX_ATTEMPTS, NOW)).toBe(false);
  });

  it('rejects an expired challenge', () => {
    expect(otpChallengeUsable(state({ expiresAt: at(1) }), OTP_MAX_ATTEMPTS, NOW)).toBe(false);
  });

  it('rejects once the attempt budget is spent', () => {
    expect(otpChallengeUsable(state({ attempts: 4 }), OTP_MAX_ATTEMPTS, NOW)).toBe(true);
    expect(otpChallengeUsable(state({ attempts: 5 }), OTP_MAX_ATTEMPTS, NOW)).toBe(false);
  });
});

describe('otpResendAllowed', () => {
  it('blocks an immediate resend', () => {
    expect(otpResendAllowed(state({ createdAt: at(0.2) }), NOW)).toBe(false);
  });

  it('allows a resend after the cooldown', () => {
    expect(otpResendAllowed(state({ createdAt: at(2) }), NOW)).toBe(true);
  });
});
