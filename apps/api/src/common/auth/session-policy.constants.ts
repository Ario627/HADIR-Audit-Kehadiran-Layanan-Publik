import { env } from '../config/env';
import type { SessionPolicy } from './session-policy';

export const SESSION_POLICY: SessionPolicy = Object.freeze({
  idleMs: env.partnerSessionIdleHours * 60 * 60 * 1000,
  absoluteMs: env.partnerSessionAbsoluteDays * 24 * 60 * 60 * 1000,
  freshMs: env.partnerSessionFreshMinutes * 60 * 1000,
  touchIntervalMs: 60_000,
});