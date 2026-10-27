import {
  LOCKOUT_POLICY,
  isLocked,
  lockSecondsFor,
  lockedUntilFor,
  nextFailureCount,
} from './lockout';

const NOW = new Date('2026-10-27T12:00:00.000Z');

describe('lockSecondsFor', () => {
  it('does not lock below the threshold', () => {
    expect(lockSecondsFor(0)).toBe(0);
    expect(lockSecondsFor(4)).toBe(0);
  });

  it('starts at the base delay on the first lock', () => {
    expect(lockSecondsFor(5)).toBe(60);
  });

  it('doubles with each further failure', () => {
    expect(lockSecondsFor(6)).toBe(120);
    expect(lockSecondsFor(7)).toBe(240);
    expect(lockSecondsFor(8)).toBe(480);
  });

  it('caps so an attacker cannot lock a victim out forever', () => {
    expect(lockSecondsFor(9)).toBe(900);
    expect(lockSecondsFor(50)).toBe(900);
    expect(lockSecondsFor(1_000)).toBe(900);
  });

  it('never returns an absurd value for huge inputs', () => {
    expect(Number.isFinite(lockSecondsFor(10_000))).toBe(true);
  });
});

describe('lockedUntilFor', () => {
  it('returns null when no lock applies', () => {
    expect(lockedUntilFor(2, NOW)).toBeNull();
  });

  it('returns a future instant when locked', () => {
    const until = lockedUntilFor(5, NOW);

    expect(until).not.toBeNull();
    expect(until?.getTime()).toBe(NOW.getTime() + 60_000);
  });
});

describe('isLocked', () => {
  it('treats null as unlocked', () => {
    expect(isLocked(null, NOW)).toBe(false);
  });

  it('is locked while the deadline is ahead', () => {
    expect(isLocked(new Date(NOW.getTime() + 1_000), NOW)).toBe(true);
  });

  it('is unlocked once the deadline passes', () => {
    expect(isLocked(new Date(NOW.getTime() - 1_000), NOW)).toBe(false);
    expect(isLocked(NOW, NOW)).toBe(false);
  });
});

describe('nextFailureCount', () => {
  it('increments by one', () => {
    expect(nextFailureCount(0)).toBe(1);
    expect(nextFailureCount(4)).toBe(5);
  });

  it('saturates instead of overflowing', () => {
    expect(nextFailureCount(1_000)).toBe(1_000);
    expect(nextFailureCount(999)).toBe(1_000);
  });
});

describe('policy constants', () => {
  it('uses the documented threshold and cap', () => {
    expect(LOCKOUT_POLICY.threshold).toBe(5);
    expect(LOCKOUT_POLICY.maxSeconds).toBe(900);
  });
});
