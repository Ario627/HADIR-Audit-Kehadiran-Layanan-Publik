import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, totpStep, verifyTotp } from './totp';

const RFC_SECRET = Buffer.from('12345678901234567890', 'utf8');

function codeAt(seconds: number): string {
  return hotp(RFC_SECRET, Math.floor(seconds / 30));
}

describe('base32', () => {
  it('encodes known vectors', () => {
    expect(base32Encode(Buffer.from('f', 'utf8'))).toBe('MY');
    expect(base32Encode(Buffer.from('fo', 'utf8'))).toBe('MZXQ');
    expect(base32Encode(Buffer.from('foo', 'utf8'))).toBe('MZXW6');
    expect(base32Encode(Buffer.from('foobar', 'utf8'))).toBe('MZXW6YTBOI');
  });

  it('round-trips arbitrary bytes', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
  });

  it('ignores padding and whitespace', () => {
    expect(base32Decode('MZXW6YTB OI').toString('utf8')).toBe('foobar');
    expect(base32Decode('MZXW6YTBOI======').toString('utf8')).toBe('foobar');
  });

  it('rejects non base32 characters', () => {
    expect(() => base32Decode('MZXW6!')).toThrow();
    expect(() => base32Decode('0189')).toThrow();
  });
});

describe('hotp against RFC 4226 test vectors', () => {
  it('matches the published truncated values', () => {
    expect(hotp(RFC_SECRET, 0)).toBe('755224');
    expect(hotp(RFC_SECRET, 1)).toBe('287082');
    expect(hotp(RFC_SECRET, 2)).toBe('359152');
    expect(hotp(RFC_SECRET, 3)).toBe('969429');
    expect(hotp(RFC_SECRET, 4)).toBe('338314');
    expect(hotp(RFC_SECRET, 5)).toBe('254676');
    expect(hotp(RFC_SECRET, 6)).toBe('287922');
    expect(hotp(RFC_SECRET, 7)).toBe('162583');
    expect(hotp(RFC_SECRET, 8)).toBe('399871');
    expect(hotp(RFC_SECRET, 9)).toBe('520489');
  });
});

describe('totp against RFC 6238 test vectors', () => {
  it('matches the published six digit suffixes', () => {
    expect(codeAt(59)).toBe('287082');
    expect(codeAt(1111111109)).toBe('081804');
    expect(codeAt(1111111111)).toBe('050471');
    expect(codeAt(1234567890)).toBe('005924');
    expect(codeAt(2000000000)).toBe('279037');
    expect(codeAt(20000000000)).toBe('353130');
  });

  it('uses thirty second steps', () => {
    expect(totpStep(0)).toBe(0);
    expect(totpStep(29_999)).toBe(0);
    expect(totpStep(30_000)).toBe(1);
    expect(totpAt(RFC_SECRET, 59_000)).toBe(codeAt(59));
  });
});

describe('verifyTotp', () => {
  const now = 1_111_111_109_000;

  it('accepts the current step', () => {
    const result = verifyTotp(RFC_SECRET, '081804', now, null);
    expect(result).toEqual({ ok: true, step: 37_037_036, reason: 'ok' });
  });

  it('accepts a one step drift in both directions', () => {
    expect(verifyTotp(RFC_SECRET, '050471', now, null).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET, codeAt(1111111100), now, null).ok).toBe(true);
  });

  it('rejects a two step drift', () => {
    expect(verifyTotp(RFC_SECRET, codeAt(1111111169), now, null).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, codeAt(1111111040), now, null).ok).toBe(false);
  });

  it('rejects a replayed step', () => {
    const first = verifyTotp(RFC_SECRET, '081804', now, null);
    expect(first.ok).toBe(true);
    const replay = verifyTotp(RFC_SECRET, '081804', now, first.step);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('replay');
  });

  it('rejects malformed codes without throwing', () => {
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, null).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, '12345', now, null).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, '1234567', now, null).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET, '', now, null).ok).toBe(false);
  });

  it('never accepts a code from another secret', () => {
    const other = Buffer.from('09876543210987654321', 'utf8');
    expect(verifyTotp(other, '081804', now, null).ok).toBe(false);
  });
});

describe('otpauthUri', () => {
  it('encodes issuer, account and parameters', () => {
    const uri = otpauthUri({
      secretBase32: 'MZXW6YTBOI',
      accountName: 'ops@hadir.id',
      issuer: 'HADIR',
    });
    expect(uri.startsWith('otpauth://totp/HADIR%3Aops%40hadir.id?')).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe('MZXW6YTBOI');
    expect(params.get('issuer')).toBe('HADIR');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });
});
