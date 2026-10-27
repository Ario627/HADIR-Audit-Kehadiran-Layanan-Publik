import { createHash } from 'node:crypto';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenShape,
  sessionTokensEqual,
} from './session-token';

describe('generateSessionToken', () => {
  it('produces 43 base64url characters from 32 bytes', () => {
    const token = generateSessionToken();

    expect(token).toHaveLength(43);
    expect(isSessionTokenShape(token)).toBe(true);
  });

  it('never repeats', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));

    expect(tokens.size).toBe(500);
  });
});

describe('hashSessionToken', () => {
  it('returns exactly 32 bytes', () => {
    expect(hashSessionToken(generateSessionToken())).toHaveLength(32);
  });

  it('is deterministic', () => {
    const token = generateSessionToken();

    expect(hashSessionToken(token).equals(hashSessionToken(token))).toBe(true);
  });

  it('matches a plain sha256 of the utf8 token', () => {
    const token = 'a'.repeat(43);

    expect(hashSessionToken(token).toString('hex')).toBe(
      createHash('sha256').update(token, 'utf8').digest('hex'),
    );
  });

  it('differs for tokens that differ by one character', () => {
    const left = `${'a'.repeat(42)}b`;
    const right = `${'a'.repeat(42)}c`;

    expect(hashSessionToken(left).equals(hashSessionToken(right))).toBe(false);
  });
});

describe('isSessionTokenShape', () => {
  it('rejects tokens of the wrong length', () => {
    expect(isSessionTokenShape('a'.repeat(42))).toBe(false);
    expect(isSessionTokenShape('a'.repeat(44))).toBe(false);
  });

  it('rejects characters outside base64url', () => {
    expect(isSessionTokenShape(`${'a'.repeat(42)}+`)).toBe(false);
    expect(isSessionTokenShape(`${'a'.repeat(42)}.`)).toBe(false);
  });

  it('rejects an empty value', () => {
    expect(isSessionTokenShape('')).toBe(false);
  });
});

describe('sessionTokensEqual', () => {
  it('compares content, not identity', () => {
    const token = hashSessionToken('x');

    expect(sessionTokensEqual(token, Buffer.from(token))).toBe(true);
  });

  it('rejects buffers of different length without throwing', () => {
    expect(sessionTokensEqual(Buffer.alloc(32), Buffer.alloc(16))).toBe(false);
  });
});
