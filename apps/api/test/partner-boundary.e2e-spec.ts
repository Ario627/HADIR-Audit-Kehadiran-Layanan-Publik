import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from '../src/db/client';
import { PartnerCredentialRepository } from '../src/db/repositories/partner-credential.repository';
import { PartnerRepository } from '../src/db/repositories/partner.repository';
import { ReportsRepository } from '../src/db/repositories/reports.repository';

const DATABASE_URL = process.env.HADIR_BOUNDARY_DATABASE_URL;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'fixtures/partner-boundary.sql');
const RLS_MIGRATION = resolve(HERE, '../src/db/migrations/0017_read_scopes.sql');

const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const POLRES = '0192f0c4-0000-7000-8000-0000000000a2';
const USER_A = '0192f0c4-0000-7000-8000-0000000000b1';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';

interface Seed {
  membershipA: string;
  membershipB: string;
}

const describeBoundary = DATABASE_URL === undefined ? describe.skip : describe;

describeBoundary('partner boundary against real PostgreSQL', () => {
  let pool: Pool;
  let db: Database;
  let partners: PartnerRepository;
  let credentials: PartnerCredentialRepository;
  let reports: ReportsRepository;
  let seed: Seed;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    db = drizzle(pool) as unknown as Database;

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query(await readFile(FIXTURE, 'utf8'));
    await pool.query(await readFile(RLS_MIGRATION, 'utf8'));

    await pool.query(
      `INSERT INTO institutions (id, name) VALUES ($1, 'Dishub'), ($2, 'Polrestabes')`,
      [DISHUB, POLRES],
    );
    await pool.query(`INSERT INTO stops (id, code, name) VALUES ($1, 'BMS-A12', 'Halte UMP')`, [
      STOP,
    ]);
    await pool.query(
      `INSERT INTO partner_users (id, email_hash, email_enc, display_name)
       VALUES ($1, repeat('a', 64), '\\x00'::bytea, 'Budi')`,
      [USER_A],
    );
    const membershipA = await pool.query<{ id: string }>(
      `INSERT INTO partner_memberships (user_id, institution_id, role)
       VALUES ($1, $2, 'responder') RETURNING id`,
      [USER_A, DISHUB],
    );
    const membershipB = await pool.query<{ id: string }>(
      `INSERT INTO partner_memberships (user_id, institution_id, role)
       VALUES ($1, $2, 'viewer') RETURNING id`,
      [USER_A, POLRES],
    );
    seed = {
      membershipA: membershipA.rows[0]?.id ?? '',
      membershipB: membershipB.rows[0]?.id ?? '',
    };

    await pool.query(
      `INSERT INTO reports (public_id, category, stop_id, device_hash, device_day_hash, text, institution_id, moderation)
       VALUES
         ('LPR-2026-000001', 'service_wait', $1, repeat('d', 64), repeat('e', 64), 'Laporan untuk Dishub yang cukup panjang.', $2, 'approved'),
         ('LPR-2026-000002', 'service_wait', $1, repeat('d', 64), repeat('e', 64), 'Laporan untuk Polrestabes yang cukup panjang.', $3, 'approved'),
         ('LPR-2026-000003', 'service_wait', $1, repeat('d', 64), repeat('e', 64), 'Laporan tanpa otoritas yang cukup panjang.', NULL, 'approved')`,
      [STOP, DISHUB, POLRES],
    );

    partners = new PartnerRepository(db);
    credentials = new PartnerCredentialRepository(db);
    reports = new ReportsRepository(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('round-trips a session through the real join', async () => {
    const tokenHash = Buffer.alloc(32, 1);
    await partners.createSession({
      userId: USER_A,
      membershipId: seed.membershipA,
      tokenHash,
      inviteJti: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      ipHash: null,
      userAgentHash: null,
    });

    const session = await partners.findSessionByTokenHash(tokenHash);

    expect(session).not.toBeNull();
    expect(session?.institutionId).toBe(DISHUB);
    expect(session?.institutionName).toBe('Dishub');
    expect(session?.role).toBe('responder');
    expect(session?.displayName).toBe('Budi');
  });

  it('returns null once the membership is revoked', async () => {
    const tokenHash = Buffer.alloc(32, 2);
    await partners.createSession({
      userId: USER_A,
      membershipId: seed.membershipB,
      tokenHash,
      inviteJti: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      ipHash: null,
      userAgentHash: null,
    });
    await expect(partners.findSessionByTokenHash(tokenHash)).resolves.not.toBeNull();

    await pool.query(`UPDATE partner_memberships SET revoked_at = now() WHERE id = $1`, [
      seed.membershipB,
    ]);

    await expect(partners.findSessionByTokenHash(tokenHash)).resolves.toBeNull();
  });

  it('revokes every other session but keeps the current one', async () => {
    const keep = Buffer.alloc(32, 3);
    const drop = Buffer.alloc(32, 4);
    for (const hash of [keep, drop]) {
      await partners.createSession({
        userId: USER_A,
        membershipId: seed.membershipA,
        tokenHash: hash,
        inviteJti: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        ipHash: null,
        userAgentHash: null,
      });
    }
    const current = await partners.findSessionByTokenHash(keep);
    expect(current).not.toBeNull();

    const revoked = await partners.revokeOthersForUser(USER_A, current?.sessionId ?? '', new Date());

    expect(revoked).toBeGreaterThanOrEqual(1);
    await expect(partners.findSessionByTokenHash(keep)).resolves.not.toBeNull();
    await expect(partners.findSessionByTokenHash(drop)).resolves.toBeNull();
  });

  it('scopes the inbox to the session institution', async () => {
    const filters = { category: null, status: null, bbox: null, cursor: null, limit: 20 };
    const dishub = await db.transaction((tx) =>
      reports.listForInstitution(tx, DISHUB, filters),
    );
    const polres = await db.transaction((tx) =>
      reports.listForInstitution(tx, POLRES, filters),
    );

    expect(dishub.items.map((row) => row.publicId)).toEqual(['LPR-2026-000001']);
    expect(polres.items.map((row) => row.publicId)).toEqual(['LPR-2026-000002']);
  });

  it('refuses to resolve a report from another institution', async () => {
    const wrong = await db.transaction((tx) =>
      reports.findReportIdInInstitution(tx, 'LPR-2026-000001', POLRES),
    );
    const right = await db.transaction((tx) =>
      reports.findReportIdInInstitution(tx, 'LPR-2026-000001', DISHUB),
    );

    expect(wrong).toBeNull();
    expect(right).not.toBeNull();
  });

  it('shows nothing to a connection with no scope', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE hadir_app`);
      await client.query(`SELECT set_config('app.scope', 'none', true)`);

      const visible = await client.query<{ count: string }>(`SELECT count(*) FROM reports`);

      expect(Number(visible.rows[0]?.count)).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('shows only approved reports to the public scope', async () => {
    const client = await pool.connect();
    try {
      await pool.query(`UPDATE reports SET moderation = 'pending' WHERE public_id = 'LPR-2026-000003'`);
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE hadir_app`);
      await client.query(`SELECT set_config('app.scope', 'public', true)`);

      const visible = await client.query<{ public_id: string }>(
        `SELECT public_id FROM reports ORDER BY public_id`,
      );

      expect(visible.rows.map((row) => row.public_id)).toEqual([
        'LPR-2026-000001',
        'LPR-2026-000002',
      ]);
      await client.query('ROLLBACK');
    } finally {
      await client.release();
    }
  });

  it('hides the row of another institution at the database level', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE hadir_app`);
      await client.query(`SELECT set_config('app.scope', 'partner', true)`);
      await client.query(`SELECT set_config('app.institution_id', $1, true)`, [DISHUB]);

      const visible = await client.query<{ public_id: string }>(
        `SELECT public_id FROM reports ORDER BY public_id`,
      );

      expect(visible.rows.map((row) => row.public_id)).toEqual(['LPR-2026-000001']);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('hides every row from a partner with no institution set', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE hadir_app`);
      await client.query(`SELECT set_config('app.scope', 'partner', true)`);
      await client.query(`SELECT set_config('app.institution_id', '', true)`);

      const visible = await client.query<{ count: string }>(`SELECT count(*) FROM reports`);

      expect(Number(visible.rows[0]?.count)).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('blocks a cross-institution update at the database level', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE hadir_app`);
      await client.query(`SELECT set_config('app.scope', 'partner', true)`);
      await client.query(`SELECT set_config('app.institution_id', $1, true)`, [DISHUB]);

      const updated = await client.query<{ public_id: string }>(
        `UPDATE reports SET status = 'acknowledged' RETURNING public_id`,
      );

      expect(updated.rows.map((row) => row.public_id)).toEqual(['LPR-2026-000001']);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('scopes a citizen to its own device hash', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE hadir_app`);
      await client.query(`SELECT set_config('app.scope', 'citizen', true)`);
      await client.query(`SELECT set_config('app.device_hash', $1, true)`, ['d'.repeat(64)]);

      const visible = await client.query<{ count: string }>(`SELECT count(*) FROM reports`);

      expect(Number(visible.rows[0]?.count)).toBe(3);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('shows nothing to a citizen with a foreign device hash', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE hadir_app`);
      await client.query(`SELECT set_config('app.scope', 'citizen', true)`);
      await client.query(`SELECT set_config('app.device_hash', $1, true)`, ['f'.repeat(64)]);

      const visible = await client.query<{ count: string }>(`SELECT count(*) FROM reports`);

      expect(Number(visible.rows[0]?.count)).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('stores and rotates a password hash', async () => {
    await credentials.upsertPassword(USER_A, '$argon2id$v=19$m=4096,t=1,p=1$c2FsdA$awal');
    await credentials.upsertPassword(USER_A, '$argon2id$v=19$m=4096,t=1,p=1$c2FsdA$baru');

    const stored = await credentials.findPasswordByUserId(USER_A);

    expect(stored?.passwordHash.endsWith('baru')).toBe(true);
  });

  it('consumes an OTP exactly once', async () => {
    const codeHash = Buffer.alloc(32, 9);
    const id = await credentials.insertOtp(USER_A, codeHash, 'login', new Date(Date.now() + 60_000));

    expect(await credentials.consumeOtp(id, new Date())).toBe(true);
    expect(await credentials.consumeOtp(id, new Date())).toBe(false);
  });

  it('bumps OTP attempts atomically', async () => {
    const id = await credentials.insertOtp(
      USER_A,
      Buffer.alloc(32, 10),
      'login',
      new Date(Date.now() + 60_000),
    );

    const [first, second] = await Promise.all([
      credentials.bumpOtpAttempts(id),
      credentials.bumpOtpAttempts(id),
    ]);

    expect([first, second].sort((left, right) => left - right)).toEqual([1, 2]);
  });

  it('consumes a WebAuthn challenge exactly once', async () => {
    const id = await credentials.insertWebAuthnChallenge(
      USER_A,
      'challenge-value-1234',
      'registration',
      new Date(Date.now() + 60_000),
    );

    expect(await credentials.consumeWebAuthnChallenge(id)).not.toBeNull();
    expect(await credentials.consumeWebAuthnChallenge(id)).toBeNull();
  });

  it('refuses an expired WebAuthn challenge', async () => {
    const id = await credentials.insertWebAuthnChallenge(
      USER_A,
      'challenge-expired-1234',
      'authentication',
      new Date(Date.now() - 1_000),
    );

    expect(await credentials.consumeWebAuthnChallenge(id)).toBeNull();
  });
});
