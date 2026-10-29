import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PartnerSession } from '../../common/auth/partner-session';
import type { PartnerRoleName } from '../../common/auth/roles';
import type { Database } from '../client';
import { DATABASE } from '../db.module';

export interface PartnerIdentityRow {
  userId: string;
  displayName: string;
  emailHash: string;
  status: string;
}

export interface MembershipRow {
  id: string;
  institutionId: string;
  institutionName: string;
  role: PartnerRoleName;
}

export interface CreateSessionInput {
  userId: string;
  membershipId: string;
  tokenHash: Buffer;
  inviteJti: string | null;
  expiresAt: Date;
  ipHash: string | null;
  userAgentHash: string | null;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Kolom ${field} bukan teks.`);
  }
  return value;
}

function asDate(value: unknown, field: string): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value);
  }
  throw new Error(`Kolom ${field} bukan waktu.`);
}

function asNullableDate(value: unknown, field: string): Date | null {
  return value === null || value === undefined ? null : asDate(value, field);
}

function toSession(row: Record<string, unknown>): PartnerSession {
  return {
    sessionId: asString(row.session_id, 'session_id'),
    userId: asString(row.user_id, 'user_id'),
    displayName: asString(row.display_name, 'display_name'),
    institutionId: asString(row.institution_id, 'institution_id'),
    institutionName: asString(row.institution_name, 'institution_name'),
    role: asString(row.role, 'role') as PartnerRoleName,
    createdAt: asDate(row.created_at, 'created_at'),
    lastSeenAt: asDate(row.last_seen_at, 'last_seen_at'),
    expiresAt: asDate(row.expires_at, 'expires_at'),
    revokedAt: asNullableDate(row.revoked_at, 'revoked_at'),
  };
}

@Injectable()
export class PartnerRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findUserByEmailHash(emailHash: string): Promise<PartnerIdentityRow | null> {
    const result = await this.db.execute(sql`
      SELECT id, display_name, email_hash, status
      FROM partner_users
      WHERE email_hash = ${emailHash}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      userId: asString(row.id, 'id'),
      displayName: asString(row.display_name, 'display_name'),
      emailHash: asString(row.email_hash, 'email_hash'),
      status: asString(row.status, 'status'),
    };
  }

  async findActiveMembership(
    userId: string,
    institutionId: string,
  ): Promise<MembershipRow | null> {
    const result = await this.db.execute(sql`
      SELECT m.id, m.institution_id, m.role, i.name AS institution_name
      FROM partner_memberships m
      JOIN partner_users u ON u.id = m.user_id
      JOIN institutions i ON i.id = m.institution_id
      WHERE m.user_id = ${userId}
        AND m.institution_id = ${institutionId}
        AND m.revoked_at IS NULL
        AND u.status = 'active'
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: asString(row.id, 'id'),
      institutionId: asString(row.institution_id, 'institution_id'),
      institutionName: asString(row.institution_name, 'institution_name'),
      role: asString(row.role, 'role') as PartnerRoleName,
    };
  }

  async createSession(input: CreateSessionInput): Promise<boolean> {
    const result = await this.db.execute(sql`
      INSERT INTO partner_sessions (
        user_id, membership_id, token_hash, invite_jti, expires_at, ip_hash, user_agent_hash
      )
      VALUES (
        ${input.userId}, ${input.membershipId}, ${input.tokenHash}, ${input.inviteJti},
        ${input.expiresAt}, ${input.ipHash}, ${input.userAgentHash}
      )
      ON CONFLICT (invite_jti) DO NOTHING
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async findSessionByTokenHash(tokenHash: Buffer): Promise<PartnerSession | null> {
    const result = await this.db.execute(sql`
      SELECT
        s.id AS session_id,
        s.user_id,
        s.created_at,
        s.last_seen_at,
        s.expires_at,
        s.revoked_at,
        u.display_name,
        m.institution_id,
        m.role,
        i.name AS institution_name
      FROM partner_sessions s
      JOIN partner_users u ON u.id = s.user_id
      JOIN partner_memberships m ON m.id = s.membership_id
      JOIN institutions i ON i.id = m.institution_id
      WHERE s.token_hash = ${tokenHash}
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND m.revoked_at IS NULL
        AND u.status = 'active'
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toSession(row);
  }

  async touchSession(sessionId: string, now: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE partner_sessions SET last_seen_at = ${now} WHERE id = ${sessionId}
    `);
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE partner_sessions
      SET revoked_at = ${now}
      WHERE id = ${sessionId} AND revoked_at IS NULL
    `);
  }

  async revokeOthersForUser(userId: string, keepSessionId: string, now: Date): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE partner_sessions
      SET revoked_at = ${now}
      WHERE user_id = ${userId}
        AND id <> ${keepSessionId}
        AND revoked_at IS NULL
      RETURNING 1 AS revoked
    `);
    return result.rows.length;
  }

  async revokeAllForUser(userId: string, now: Date): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE partner_sessions
      SET revoked_at = ${now}
      WHERE user_id = ${userId} AND revoked_at IS NULL
      RETURNING 1 AS revoked
    `);
    return result.rows.length;
  }

  async findAnyActiveMembership(userId: string): Promise<MembershipRow | null> {
    const result = await this.db.execute(sql`
      SELECT m.id, m.institution_id, m.role, i.name AS institution_name
      FROM partner_memberships m
      JOIN partner_users u ON u.id = m.user_id
      JOIN institutions i ON i.id = m.institution_id
      WHERE m.user_id = ${userId}
        AND m.revoked_at IS NULL
        AND u.status = 'active'
      ORDER BY m.created_at
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: asString(row.id, 'id'),
      institutionId: asString(row.institution_id, 'institution_id'),
      institutionName: asString(row.institution_name, 'institution_name'),
      role: asString(row.role, 'role') as PartnerRoleName,
    };
  }

  async listInstitutions(): Promise<{ id: string; name: string }[]> {
    const result = await this.db.execute(sql`
      SELECT id, name FROM institutions ORDER BY name
    `);
    return result.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return { id: asString(row.id, 'id'), name: asString(row.name, 'name') };
    });
  }
}