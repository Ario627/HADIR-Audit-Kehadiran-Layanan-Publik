import { MemoryRateLimitStore } from '../http/rate-limit.memory';
import { isTrustedOrigin, issueCsrfToken, verifyCsrfToken } from './csrf';

const SECRET = 'test-secret-000000000000000000000000000000';
const DEVICE_HASH = 'a'.repeat(64);
const NOW = new Date('2026-10-25T00:00:00.000Z');

describe('CSRF token', () => {
  it('accepts a token for the same device before expiry', () => {
    const token = issueCsrfToken({
      deviceHash: DEVICE_HASH,
      secret: SECRET,
      now: NOW,
      ttlMs: 60_000,
    });
    expect(
      verifyCsrfToken(token, {
        deviceHash: DEVICE_HASH,
        secret: SECRET,
        now: new Date(NOW.getTime() + 30_000),
      }),
    ).toBe(true);
  });

  it('rejects a token after expiry', () => {
    const token = issueCsrfToken({
      deviceHash: DEVICE_HASH,
      secret: SECRET,
      now: NOW,
      ttlMs: 60_000,
    });
    expect(
      verifyCsrfToken(token, {
        deviceHash: DEVICE_HASH,
        secret: SECRET,
        now: new Date(NOW.getTime() + 60_001),
      }),
    ).toBe(false);
  });

  it('rejects a token bound to another device', () => {
    const token = issueCsrfToken({
      deviceHash: DEVICE_HASH,
      secret: SECRET,
      now: NOW,
      ttlMs: 60_000,
    });
    expect(
      verifyCsrfToken(token, {
        deviceHash: 'b'.repeat(64),
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const token = issueCsrfToken({
      deviceHash: DEVICE_HASH,
      secret: SECRET,
      now: NOW,
      ttlMs: 60_000,
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(
      verifyCsrfToken(tampered, {
        deviceHash: DEVICE_HASH,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe('trusted origin', () => {
  const allowed = ['https://hadir.id', 'http://localhost:5173'];

  it('accepts an exact allowed origin', () => {
    expect(isTrustedOrigin('https://hadir.id', allowed)).toBe(true);
    expect(isTrustedOrigin('http://localhost:5173', allowed)).toBe(true);
  });

  it('rejects lookalike and missing origins', () => {
    expect(isTrustedOrigin('https://hadir.id.evil.com', allowed)).toBe(false);
    expect(isTrustedOrigin('https://evil.com', allowed)).toBe(false);
    expect(isTrustedOrigin(undefined, allowed)).toBe(false);
    expect(isTrustedOrigin('null', allowed)).toBe(false);
  });
});

describe('memory rate limit', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects above the limit and recovers after the window', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    const store = new MemoryRateLimitStore();
    const input = { key: 'test', limit: 2, windowMs: 1_000, member: 'm1' };

    expect((await store.consume(input)).allowed).toBe(true);
    expect((await store.consume(input)).allowed).toBe(true);
    expect((await store.consume({ ...input, member: 'm3' })).allowed).toBe(false);

    jest.setSystemTime(new Date(NOW.getTime() + 1_001));
    expect((await store.consume({ ...input, member: 'm4' })).allowed).toBe(true);
  });

  it('keeps the remaining count accurate', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    const store = new MemoryRateLimitStore();
    const input = { key: 'remaining', limit: 3, windowMs: 10_000, member: 'm1' };

    expect(await store.consume(input)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
    expect(await store.consume({ ...input, member: 'm2' })).toMatchObject({
      allowed: true,
      remaining: 1,
    });
  });
});