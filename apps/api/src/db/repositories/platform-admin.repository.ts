import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PlatformAdminSession } from '../../common/auth/platform-session';
import type { PlatformAdminRoleName } from '../../common/auth/roles';
import type { Database } from '../client';
import { DATABASE } from '../db.module';

export interface PlatformAdminIdentity {
  adminId: string;
  email: string;
  displayName: string;
  role: PlatformAdminRoleName;
  passwordHash: string;
  totpSecretEnc: Buffer;
  totpEnrolledAt: Date;
  lastTotpStep: number | null;
  disabledAt: Date | null;
}

export interface CreatePlatformSessionInput {
  adminId: string;
  tokenHash: Buffer;
  ipHash: Buffer | null;
  userAgentHash: Buffer | null;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
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

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBuffer(value: unknown, field: string): Buffer {
  if (value instanceof Buffer) {
    return value;
  }
  throw new Error(`Kolom ${field} bukan bytea.`);
}

function toSession(row: Record<string, unknown>): PlatformAdminSession {
  return {
    sessionId: asString(row.session_id, 'session_id'),
    adminId: asString(row.admin_id, 'admin_id'),
    email: asString(row.email, 'email'),
    displayName: asString(row.display_name, 'display_name'),
    role: asString(row.role, 'role') as PlatformAdminRoleName,
    createdAt: asDate(row.created_at, 'created_at'),
    lastSeenAt: asDate(row.last_seen_at, 'last_seen_at'),
    expiresAt: asDate(row.absolute_expires_at, 'absolute_expires_at'),
    revokedAt: asNullableDate(row.revoked_at, 'revoked_at'),
  };
}

@Injectable()
export class PlatformAdminRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findAdminByEmail(email: string): Promise<PlatformAdminIdentity | null> {
    const result = await this.db.execute(sql`
      SELECT id, email, display_name, role, password_hash, totp_secret_enc,
             totp_enrolled_at, last_totp_step, disabled_at
      FROM platform_admins
      WHERE email = ${email}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      adminId: asString(row.id, 'id'),
      email: asString(row.email, 'email'),
      displayName: asString(row.display_name, 'display_name'),
      role: asString(row.role, 'role') as PlatformAdminRoleName,
      passwordHash: asBuffer(row.password_hash, 'password_hash').toString('utf8'),
      totpSecretEnc: asBuffer(row.totp_secret_enc, 'totp_secret_enc'),
      totpEnrolledAt: asDate(row.totp_enrolled_at, 'totp_enrolled_at'),
      lastTotpStep: asNullableNumber(row.last_totp_step),
      disabledAt: asNullableDate(row.disabled_at, 'disabled_at'),
    };
  }

  async latestTotpStep(adminId: string): Promise<number | null> {
    const result = await this.db.execute(sql`
      SELECT last_totp_step FROM platform_admins WHERE id = ${adminId} LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : asNullableNumber(row.last_totp_step);
  }

  async recordTotpStep(adminId: string, step: number): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE platform_admins
      SET last_totp_step = ${step}, updated_at = now()
      WHERE id = ${adminId}
        AND (last_totp_step IS NULL OR last_totp_step < ${step})
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async createSession(input: CreatePlatformSessionInput): Promise<string> {
    const result = await this.db.execute(sql`
      INSERT INTO platform_admin_sessions (
        admin_id, token_hash, ip_hash, user_agent_hash, idle_expires_at, absolute_expires_at
      ) VALUES (
        ${input.adminId}, ${input.tokenHash}, ${input.ipHash}, ${input.userAgentHash},
        ${input.idleExpiresAt}, ${input.absoluteExpiresAt}
      )
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Sesi admin gagal dibuat.');
    }
    return asString(row.id, 'id');
  }

  async findSessionByTokenHash(tokenHash: Buffer): Promise<PlatformAdminSession | null> {
    const result = await this.db.execute(sql`
      SELECT s.id AS session_id, s.admin_id, a.email, a.display_name, a.role,
             s.created_at, s.last_seen_at, s.absolute_expires_at, s.revoked_at
      FROM platform_admin_sessions s
      JOIN platform_admins a ON a.id = s.admin_id
      WHERE s.token_hash = ${tokenHash}
        AND s.revoked_at IS NULL
        AND s.idle_expires_at > now()
        AND s.absolute_expires_at > now()
        AND a.disabled_at IS NULL
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toSession(row);
  }

  async touchSession(sessionId: string, idleExpiresAt: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE platform_admin_sessions
      SET last_seen_at = now(),
          idle_expires_at = LEAST(${idleExpiresAt}, absolute_expires_at)
      WHERE id = ${sessionId}
    `);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE platform_admin_sessions
      SET revoked_at = now()
      WHERE id = ${sessionId} AND revoked_at IS NULL
    `);
  }

  async revokeAllSessions(adminId: string): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE platform_admin_sessions
      SET revoked_at = now()
      WHERE admin_id = ${adminId} AND revoked_at IS NULL
      RETURNING id
    `);
    return result.rows.length;
  }

  async countActiveAdmins(): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT count(*)::int AS total FROM platform_admins WHERE disabled_at IS NULL
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? 0 : Number(row.total ?? 0);
  }

  async insertAdmin(input: {
    email: string;
    displayName: string;
    role: PlatformAdminRoleName;
    passwordHash: Buffer;
    totpSecretEnc: Buffer;
  }): Promise<string> {
    const result = await this.db.execute(sql`
      INSERT INTO platform_admins (email, display_name, role, password_hash, totp_secret_enc)
      VALUES (${input.email}, ${input.displayName}, ${input.role}, ${input.passwordHash}, ${input.totpSecretEnc})
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Admin gagal dibuat.');
    }
    return asString(row.id, 'id');
  }

  async findAdminById(adminId: string): Promise<PlatformAdminIdentity | null> {
    const result = await this.db.execute(sql`
      SELECT id, email, display_name, role, password_hash, totp_secret_enc,
             totp_enrolled_at, last_totp_step, disabled_at
      FROM platform_admins
      WHERE id = ${adminId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      adminId: asString(row.id, 'id'),
      email: asString(row.email, 'email'),
      displayName: asString(row.display_name, 'display_name'),
      role: asString(row.role, 'role') as PlatformAdminRoleName,
      passwordHash: asBuffer(row.password_hash, 'password_hash').toString('utf8'),
      totpSecretEnc: asBuffer(row.totp_secret_enc, 'totp_secret_enc'),
      totpEnrolledAt: asDate(row.totp_enrolled_at, 'totp_enrolled_at'),
      lastTotpStep: asNullableNumber(row.last_totp_step),
      disabledAt: asNullableDate(row.disabled_at, 'disabled_at'),
    };
  }
}
