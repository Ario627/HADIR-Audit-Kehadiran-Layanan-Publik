import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { DATABASE } from '../db.module';

export interface PasswordCredentialRow {
  userId: string;
  passwordHash: string;
}

export interface OtpChallengeRow {
  id: string;
  userId: string;
  codeHash: Buffer;
  createdAt: Date;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
}

export interface WebAuthnCredentialRow {
  id: string;
  userId: string;
  credentialId: Buffer;
  publicKey: Buffer;
  counter: number;
  transports: string[];
  deviceType: string | null;
  lastUsedAt: Date | null;
}

export interface LockStateRow {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface WebAuthnChallengeRow {
  id: string;
  userId: string | null;
  challenge: string;
  expiresAt: Date;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Kolom ${field} bukan teks.`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    return Number(value);
  }
  throw new Error(`Kolom ${field} bukan angka.`);
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

function asBuffer(value: unknown, field: string): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  throw new Error(`Kolom ${field} bukan bytea.`);
}

@Injectable()
export class PartnerCredentialRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findPasswordByUserId(userId: string): Promise<PasswordCredentialRow | null> {
    const result = await this.db.execute(sql`
      SELECT user_id, password_hash
      FROM partner_password_credentials
      WHERE user_id = ${userId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      userId: asString(row.user_id, 'user_id'),
      passwordHash: asString(row.password_hash, 'password_hash'),
    };
  }

  async upsertPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO partner_password_credentials (user_id, password_hash)
      VALUES (${userId}, ${passwordHash})
      ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `);
  }

  async readLockState(userId: string): Promise<LockStateRow | null> {
    const result = await this.db.execute(sql`
      SELECT failed_login_count, locked_until FROM partner_users WHERE id = ${userId} LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      failedLoginCount: asNumber(row.failed_login_count, 'failed_login_count'),
      lockedUntil: asNullableDate(row.locked_until, 'locked_until'),
    };
  }

  async recordFailure(userId: string, count: number, lockedUntil: Date | null): Promise<void> {
    await this.db.execute(sql`
      UPDATE partner_users
      SET failed_login_count = ${count}, locked_until = ${lockedUntil}
      WHERE id = ${userId}
    `);
  }

  async clearFailures(userId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE partner_users
      SET failed_login_count = 0, locked_until = NULL
      WHERE id = ${userId} AND (failed_login_count > 0 OR locked_until IS NOT NULL)
    `);
  }

  async insertOtp(
    userId: string,
    codeHash: Buffer,
    purpose: 'login' | 'recovery',
    expiresAt: Date,
  ): Promise<string> {
    const result = await this.db.execute(sql`
      INSERT INTO partner_otp_challenges (user_id, code_hash, purpose, expires_at)
      VALUES (${userId}, ${codeHash}, ${purpose}, ${expiresAt})
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return asString(row?.id, 'id');
  }

  async findLatestOpenOtp(userId: string): Promise<OtpChallengeRow | null> {
    const result = await this.db.execute(sql`
      SELECT id, user_id, code_hash, created_at, expires_at, attempts, consumed_at
      FROM partner_otp_challenges
      WHERE user_id = ${userId} AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : this.toOtp(row);
  }

  async findOtpById(id: string): Promise<OtpChallengeRow | null> {
    const result = await this.db.execute(sql`
      SELECT id, user_id, code_hash, created_at, expires_at, attempts, consumed_at
      FROM partner_otp_challenges
      WHERE id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : this.toOtp(row);
  }

  private toOtp(row: Record<string, unknown>): OtpChallengeRow {
    return {
      id: asString(row.id, 'id'),
      userId: asString(row.user_id, 'user_id'),
      codeHash: asBuffer(row.code_hash, 'code_hash'),
      createdAt: asDate(row.created_at, 'created_at'),
      expiresAt: asDate(row.expires_at, 'expires_at'),
      attempts: asNumber(row.attempts, 'attempts'),
      consumedAt: asNullableDate(row.consumed_at, 'consumed_at'),
    };
  }

  async bumpOtpAttempts(id: string): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE partner_otp_challenges SET attempts = attempts + 1
      WHERE id = ${id}
      RETURNING attempts
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? 0 : asNumber(row.attempts, 'attempts');
  }

  async consumeOtp(id: string, now: Date): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE partner_otp_challenges SET consumed_at = ${now}
      WHERE id = ${id} AND consumed_at IS NULL
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async deleteOpenOtps(userId: string): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM partner_otp_challenges WHERE user_id = ${userId} AND consumed_at IS NULL
    `);
  }

  async listWebAuthnByUserId(userId: string): Promise<WebAuthnCredentialRow[]> {
    const result = await this.db.execute(sql`
      SELECT id, user_id, credential_id, public_key, counter, transports, device_type, last_used_at
      FROM partner_webauthn_credentials
      WHERE user_id = ${userId}
      ORDER BY created_at
    `);
    return result.rows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const transports = row.transports;
      return {
        id: asString(row.id, 'id'),
        userId: asString(row.user_id, 'user_id'),
        credentialId: asBuffer(row.credential_id, 'credential_id'),
        publicKey: asBuffer(row.public_key, 'public_key'),
        counter: asNumber(row.counter, 'counter'),
        transports: Array.isArray(transports)
          ? transports.filter((item): item is string => typeof item === 'string')
          : [],
        deviceType: row.device_type === null ? null : asString(row.device_type, 'device_type'),
        lastUsedAt: asNullableDate(row.last_used_at, 'last_used_at'),
      };
    });
  }

  async findWebAuthnByCredentialId(credentialId: Buffer): Promise<WebAuthnCredentialRow | null> {
    const result = await this.db.execute(sql`
      SELECT id, user_id, credential_id, public_key, counter, transports
      FROM partner_webauthn_credentials
      WHERE credential_id = ${credentialId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: asString(row.id, 'id'),
      userId: asString(row.user_id, 'user_id'),
      credentialId: asBuffer(row.credential_id, 'credential_id'),
      publicKey: asBuffer(row.public_key, 'public_key'),
      counter: asNumber(row.counter, 'counter'),
      transports: [],
      deviceType: null,
      lastUsedAt: null,
    };
  }

  async deleteWebAuthn(userId: string, id: string): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM partner_webauthn_credentials WHERE id = ${id} AND user_id = ${userId}
    `);
  }

  async insertWebAuthn(
    userId: string,
    credentialId: Buffer,
    publicKey: Buffer,
    counter: number,
    transports: string[],
    deviceType: string | null,
    backedUp: boolean,
  ): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO partner_webauthn_credentials (
        user_id, credential_id, public_key, counter, transports, device_type, backed_up
      )
      VALUES (${userId}, ${credentialId}, ${publicKey}, ${counter}, ${transports}, ${deviceType}, ${backedUp})
    `);
  }

  async updateWebAuthnCounter(id: string, counter: number, now: Date): Promise<void> {
    await this.db.execute(sql`
      UPDATE partner_webauthn_credentials
      SET counter = ${counter}, last_used_at = ${now}
      WHERE id = ${id}
    `);
  }

  async insertWebAuthnChallenge(
    userId: string | null,
    challenge: string,
    purpose: 'registration' | 'authentication',
    expiresAt: Date,
  ): Promise<string> {
    const result = await this.db.execute(sql`
      INSERT INTO partner_webauthn_challenges (user_id, challenge, purpose, expires_at)
      VALUES (${userId}, ${challenge}, ${purpose}, ${expiresAt})
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return asString(row?.id, 'id');
  }

  async consumeWebAuthnChallenge(id: string): Promise<WebAuthnChallengeRow | null> {
    const result = await this.db.execute(sql`
      DELETE FROM partner_webauthn_challenges
      WHERE id = ${id} AND expires_at > now()
      RETURNING id, user_id, challenge, expires_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: asString(row.id, 'id'),
      userId: row.user_id === null ? null : asString(row.user_id, 'user_id'),
      challenge: asString(row.challenge, 'challenge'),
      expiresAt: asDate(row.expires_at, 'expires_at'),
    };
  }

  async pruneExpiredChallenges(now: Date): Promise<number> {
    const result = await this.db.execute(sql`
      DELETE FROM partner_webauthn_challenges WHERE expires_at <= ${now} RETURNING 1 AS done
    `);
    return result.rows.length;
  }
}
