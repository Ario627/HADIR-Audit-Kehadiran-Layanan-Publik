export interface SessionPolicy {
  idleMs: number;
  absoluteMs: number;
  freshMs: number;
  touchIntervalMs: number;
}

export interface SessionTimestamps {
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function isRevoked(session: SessionTimestamps): boolean {
  return session.revokedAt !== null;
}

export function isExpired(session: SessionTimestamps, now: Date): boolean {
  return session.expiresAt.getTime() <= now.getTime();
}

export function isIdle(session: SessionTimestamps, policy: SessionPolicy, now: Date): boolean {
  return now.getTime() - session.lastSeenAt.getTime() > policy.idleMs;
}

export function isFresh(session: SessionTimestamps, policy: SessionPolicy, now: Date): boolean {
  return now.getTime() - session.createdAt.getTime() <= policy.freshMs;
}

export function sessionUsable(
  session: SessionTimestamps,
  policy: SessionPolicy,
  now: Date,
): boolean {
  return !isRevoked(session) && !isExpired(session, now) && !isIdle(session, policy, now);
}

export function shouldTouch(session: SessionTimestamps, policy: SessionPolicy, now: Date): boolean {
  return now.getTime() - session.lastSeenAt.getTime() >= policy.touchIntervalMs;
}