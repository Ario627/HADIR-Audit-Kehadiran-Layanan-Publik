export interface LockoutPolicy {
  threshold: number;
  baseSeconds: number;
  maxSeconds: number;
}

export const LOCKOUT_POLICY: LockoutPolicy = Object.freeze({
  threshold: 5,
  baseSeconds: 60,
  maxSeconds: 900,
});

export function lockSecondsFor(failures: number, policy: LockoutPolicy = LOCKOUT_POLICY): number {
  if (failures < policy.threshold) {
    return 0;
  }
  const exponent = failures - policy.threshold;
  const scaled = policy.baseSeconds * 2 ** Math.min(exponent, 16);
  return Math.min(scaled, policy.maxSeconds);
}

export function lockedUntilFor(
  failures: number,
  now: Date,
  policy: LockoutPolicy = LOCKOUT_POLICY,
): Date | null {
  const seconds = lockSecondsFor(failures, policy);
  return seconds === 0 ? null : new Date(now.getTime() + seconds * 1_000);
}

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

export function nextFailureCount(current: number): number {
  return Math.min(current + 1, 1_000);
}
