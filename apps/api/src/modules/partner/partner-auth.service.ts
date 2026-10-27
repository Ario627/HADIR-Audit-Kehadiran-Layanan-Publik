import { Injectable } from '@nestjs/common';
import { env } from '../../common/config/env';
import type { PartnerSession } from '../../common/auth/partner-session';
import {
  isFresh,
  sessionUsable,
  shouldTouch,
} from '../../common/auth/session-policy';
import { SESSION_POLICY } from '../../common/auth/session-policy.constants';
import {
  generateSessionToken,
  hashSessionToken,
  isSessionTokenShape,
} from '../../common/auth/session-token';
import { PartnerRepository } from '../../db/repositories/partner.repository';

export interface IssuedSession {
  token: string;
  session: PartnerSession;
}

export interface ResolvedSession {
  session: PartnerSession;
  fresh: boolean;
}

@Injectable()
export class PartnerAuthService {
  constructor(private readonly repository: PartnerRepository) {}

  async resolve(rawToken: string | null, now: Date = new Date()): Promise<ResolvedSession | null> {
    if (rawToken === null || !isSessionTokenShape(rawToken)) {
      return null;
    }
    const session = await this.repository.findSessionByTokenHash(hashSessionToken(rawToken));
    if (session === null || !sessionUsable(session, SESSION_POLICY, now)) {
      return null;
    }
    if (shouldTouch(session, SESSION_POLICY, now)) {
      await this.repository.touchSession(session.sessionId, now);
    }
    return { session, fresh: isFresh(session, SESSION_POLICY, now) };
  }

  issueToken(): { token: string; tokenHash: Buffer; expiresAt: Date } {
    const token = generateSessionToken();
    return {
      token,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + SESSION_POLICY.absoluteMs),
    };
  }

  async revoke(sessionId: string, now: Date = new Date()): Promise<void> {
    await this.repository.revokeSession(sessionId, now);
  }

  sessionCookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      secure: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: SESSION_POLICY.absoluteMs,
    };
  }

  cookieName(): string {
    return env.partnerSessionCookieName;
  }
}