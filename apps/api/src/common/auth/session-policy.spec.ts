import {
  isExpired,
  isFresh,
  isIdle,
  isRevoked,
  sessionUsable,
  shouldTouch,
  type SessionPolicy,
} from './session-policy';

const POLICY: SessionPolicy = {
  idleMs: 8 * 60 * 60 * 1000,
  absoluteMs: 7 * 24 * 60 * 60 * 1000,
  freshMs: 30 * 60 * 1000,
  touchIntervalMs: 60_000,
};

const NOW = new Date('2026-10-27T12:00:00.000Z');

function at(minutesAgo: number): Date {
  return new Date(NOW.getTime() - minutesAgo * 60 * 1000);
}

function session(overrides: Partial<Parameters<typeof sessionUsable>[0]> = {}) {
  return {
    createdAt: at(5),
    lastSeenAt: at(1),
    expiresAt: at(-60),
    revokedAt: null,
    ...overrides,
  };
}

describe('session validity', () => {
  it('accepts a session that was just used', () => {
    expect(sessionUsable(session(), POLICY, NOW)).toBe(true);
  });

  it('rejects a revoked session even when otherwise valid', () => {
    const revoked = session({ revokedAt: at(1) });

    expect(isRevoked(revoked)).toBe(true);
    expect(sessionUsable(revoked, POLICY, NOW)).toBe(false);
  });

  it('rejects an expired session even when recently used', () => {
    const expired = session({ expiresAt: at(1) });

    expect(isExpired(expired, NOW)).toBe(true);
    expect(sessionUsable(expired, POLICY, NOW)).toBe(false);
  });

  it('rejects a session idle past the limit', () => {
    const idle = session({ lastSeenAt: at(9 * 60) });

    expect(isIdle(idle, POLICY, NOW)).toBe(true);
    expect(sessionUsable(idle, POLICY, NOW)).toBe(false);
  });

  it('treats a session used exactly at the idle boundary as still usable', () => {
    const boundary = session({ lastSeenAt: new Date(NOW.getTime() - POLICY.idleMs) });

    expect(sessionUsable(boundary, POLICY, NOW)).toBe(true);
  });

  it('treats expiry exactly at now as expired', () => {
    expect(isExpired(session({ expiresAt: NOW }), NOW)).toBe(true);
  });
});

describe('session freshness', () => {
  it('is fresh inside the window', () => {
    expect(isFresh(session({ createdAt: at(10) }), POLICY, NOW)).toBe(true);
  });

  it('is stale past the window', () => {
    expect(isFresh(session({ createdAt: at(31) }), POLICY, NOW)).toBe(false);
  });

  it('measures freshness from creation, not last use', () => {
    const used = session({ createdAt: at(90), lastSeenAt: at(0) });

    expect(isFresh(used, POLICY, NOW)).toBe(false);
  });
});

describe('touch throttling', () => {
  it('skips the write when the session was seen recently', () => {
    expect(shouldTouch(session({ lastSeenAt: at(0.5) }), POLICY, NOW)).toBe(false);
  });

  it('writes once the interval has elapsed', () => {
    expect(shouldTouch(session({ lastSeenAt: at(2) }), POLICY, NOW)).toBe(true);
  });
});
