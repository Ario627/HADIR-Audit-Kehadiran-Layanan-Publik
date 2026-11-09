import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database, Transaction } from '../src/db/client';
import { AccountabilityRepository } from '../src/db/repositories/accountability.repository';

const DATABASE_URL = process.env.HADIR_BOUNDARY_DATABASE_URL;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'fixtures/admin-boundary.sql');
const MIGRATIONS = resolve(HERE, '../src/db/migrations');

const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const POLRES = '0192f0c4-0000-7000-8000-0000000000a2';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';
const USER_A = '0192f0c4-0000-7000-8000-0000000000b1';
const USER_B = '0192f0c4-0000-7000-8000-0000000000b2';
const USER_C = '0192f0c4-0000-7000-8000-0000000000b3';
const DEVICE = 'd'.repeat(64);
const OTHER_DEVICE = 'f'.repeat(64);

const describeBoundary = DATABASE_URL === undefined ? describe.skip : describe;

describeBoundary('accountability boundary against real PostgreSQL', () => {
  let pool: Pool;
  let repository: AccountabilityRepository;

  const asApp = async <T>(
    scope: 'admin' | 'public' | 'partner' | 'citizen' | 'none',
    extra: { institutionId?: string; deviceHash?: string },
    work: (tx: Transaction) => Promise<T>,
    commit = false,
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE hadir_app');
      await client.query(`SELECT set_config('app.scope', $1, true)`, [scope]);
      if (extra.institutionId !== undefined) {
        await client.query(`SELECT set_config('app.institution_id', $1, true)`, [
          extra.institutionId,
        ]);
      }
      if (extra.deviceHash !== undefined) {
        await client.query(`SELECT set_config('app.device_hash', $1, true)`, [
          extra.deviceHash,
        ]);
      }
      const scoped = drizzle(client) as unknown as Database;
      const result = await work(scoped as unknown as Transaction);
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const count = async (query: string): Promise<number> => {
    const result = await pool.query<{ n: string }>(query);
    return Number(result.rows[0]?.n ?? '0');
  };

  const responseId = async (publicId: string): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      `SELECT r.id FROM reports r WHERE r.public_id = $1`,
      [publicId],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('Laporan tidak ditemukan.');
    }
    return id;
  };

  const insertResponse = async (
    reportId: string,
    institutionId: string,
    body = 'Perbaikan dijadwalkan minggu depan oleh instansi terkait.',
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO report_responses (report_id, institution_id, kind, body)
       VALUES ($1, $2, 'initial', $3)`,
      [reportId, institutionId, body],
    );
  };

  const insertVerification = async (
    reportId: string,
    verifierInstitutionId: string | null,
    verdict: 'confirmed' | 'refuted' | 'inconclusive',
    claimant = DISHUB,
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO resolution_verifications (
         report_id, method, verdict, verifier_kind, verifier_institution_id,
         claimant_institution_id, evidence_urls
       ) VALUES ($1, 'field_inspection', $2::resolution_verdict,
                 'independent_institution', $3, $4, ARRAY['https://bukti.test/1'])`,
      [reportId, verdict, verifierInstitutionId, claimant],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    repository = new AccountabilityRepository();

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query(await readFile(FIXTURE, 'utf8'));
    await pool.query('GRANT USAGE ON SCHEMA public TO hadir_app');
    await pool.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TYPE partner_role AS ENUM ('viewer', 'responder', 'admin')
    `);
    await pool.query(`
      CREATE TABLE partner_memberships (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
        institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
        role partner_role NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        revoked_at timestamp with time zone
      )
    `);
    await pool.query(`
      CREATE TABLE partner_sessions (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        user_id uuid NOT NULL REFERENCES partner_users(id) ON DELETE CASCADE,
        membership_id uuid NOT NULL REFERENCES partner_memberships(id) ON DELETE CASCADE,
        token_hash bytea NOT NULL,
        created_at timestamp with time zone NOT NULL DEFAULT now(),
        last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
        expires_at timestamp with time zone NOT NULL,
        revoked_at timestamp with time zone
      )
    `);
    await pool.query(`
      GRANT SELECT, INSERT, UPDATE ON partner_users TO hadir_app
    `);
    await pool.query(`
      GRANT SELECT, INSERT, UPDATE ON partner_memberships TO hadir_app
    `);
    await pool.query(`
      GRANT SELECT, INSERT, UPDATE ON partner_sessions TO hadir_app
    `);
    await pool.query(
      await readFile(
        resolve(MIGRATIONS, '0027_accountability.sql'),
        'utf8',
      ),
    );

    await pool.query(`INSERT INTO institutions (id, name) VALUES ($1, 'Dishub'), ($2, 'Polrestabes')`, [
      DISHUB,
      POLRES,
    ]);
    await pool.query(`INSERT INTO stops (id, code, name) VALUES ($1, 'BMS-A12', 'Halte UMP')`, [
      STOP,
    ]);
    await pool.query(
      `INSERT INTO partner_users (id, email_hash, email_enc, display_name)
       VALUES ($1, repeat('a', 64), '\\x00'::bytea, 'Budi'),
              ($2, repeat('b', 64), '\\x00'::bytea, 'Sari'),
              ($3, repeat('c', 64), '\\x00'::bytea, 'Tono')`,
      [USER_A, USER_B, USER_C],
    );
    await pool.query(
      `INSERT INTO partner_memberships (user_id, institution_id, role)
       VALUES ($1, $2, 'admin'), ($3, $2, 'responder'), ($4, $2, 'admin')`,
      [USER_A, DISHUB, USER_B, USER_C],
    );
    await pool.query(
      `INSERT INTO reports (
         public_id, category, stop_id, device_hash, device_day_hash, text,
         institution_id, moderation, status
       ) VALUES
         ('LPR-2026-000101', 'service_wait', $1, $2, repeat('e', 64),
          'Laporan uji akuntabilitas yang cukup panjang.', $3, 'approved', 'claimed_resolved'),
         ('LPR-2026-000102', 'service_wait', $1, $4, repeat('e', 64),
          'Laporan perangkat lain yang cukup panjang.', $3, 'approved', 'submitted')`,
      [STOP, DEVICE, DISHUB, OTHER_DEVICE],
    );
    await pool.query(
      `INSERT INTO report_events (report_id, seq, kind, actor_type, actor_id,
         prev_hash, payload_hash, chain_hash)
       SELECT r.id, 1, 'submitted', 'citizen', NULL, repeat('0', 64)::bytea,
              repeat('1', 32)::bytea, repeat('2', 32)::bytea
       FROM reports r`,
    );
    await pool.query(
      `INSERT INTO report_events (report_id, seq, kind, actor_type, actor_id,
         prev_hash, payload_hash, chain_hash)
       SELECT r.id, 2, 'claimed_resolved', 'partner', $1, repeat('2', 32)::bytea,
              repeat('3', 32)::bytea, repeat('4', 32)::bytea
       FROM reports r WHERE r.public_id = 'LPR-2026-000101'`,
      [USER_A],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects updating a published response', async () => {
    const reportId = await responseId('LPR-2026-000101');
    await insertResponse(reportId, DISHUB);
    await expect(
      pool.query(`UPDATE report_responses SET body = repeat('x', 40) WHERE true`),
    ).rejects.toThrow(/append-only/u);
  });

  it('rejects deleting a published response', async () => {
    await expect(
      pool.query(`DELETE FROM report_responses WHERE true`),
    ).rejects.toThrow(/append-only/u);
  });

  it('rejects an evidence url that is not https', async () => {
    const reportId = await responseId('LPR-2026-000101');
    await expect(
      pool.query(
        `INSERT INTO report_responses (report_id, institution_id, body, evidence_urls)
         VALUES ($1, $2, 'Bukti perbaikan sudah selesai dikerjakan.', ARRAY['ftp://x'])`,
        [reportId, DISHUB],
      ),
    ).rejects.toThrow(/tidak valid/u);
  });

  it('accepts a well formed evidence url', async () => {
    const reportId = await responseId('LPR-2026-000101');
    await expect(
      pool.query(
        `INSERT INTO report_responses (report_id, institution_id, body, evidence_urls)
         VALUES ($1, $2, 'Bukti perbaikan sudah selesai dikerjakan.',
                 ARRAY['https://dinhub.test/bukti/1.jpg'])`,
        [reportId, DISHUB],
      ),
    ).resolves.toBeDefined();
  });

  it('requires a correction to point at another response', async () => {
    const reportId = await responseId('LPR-2026-000101');
    await expect(
      pool.query(
        `INSERT INTO report_responses (report_id, institution_id, kind, body)
         VALUES ($1, $2, 'correction', 'Koreksi atas tanggapan sebelumnya yang keliru.')`,
        [reportId, DISHUB],
      ),
    ).rejects.toThrow(/ck_response_correction_target/u);
  });

  it('refuses a claimant institution verifying its own claim', async () => {
    const reportId = await responseId('LPR-2026-000101');
    await expect(
      insertVerification(reportId, DISHUB, 'confirmed', DISHUB),
    ).rejects.toThrow(/ck_resolution_independence/u);
  });

  it('accepts an independent institution verdict and blocks a second one', async () => {
    const reportId = await responseId('LPR-2026-000101');
    await insertVerification(reportId, POLRES, 'confirmed');
    await expect(
      insertVerification(reportId, POLRES, 'refuted'),
    ).rejects.toThrow(/uq_resolution_verifier/u);
  });

  it('rejects updating a recorded verification', async () => {
    await expect(
      pool.query(
        `UPDATE resolution_verifications SET verdict = 'refuted' WHERE true`,
      ),
    ).rejects.toThrow(/append-only/u);
  });

  it('freezes the SLA once and ignores a second write', async () => {
    const reportId = await responseId('LPR-2026-000102');
    const first = await asApp(
      'admin',
      {},
      async (tx) =>
        repository.freezeSla(tx, {
          reportId,
          policyVersion: 'sla-v1',
          priority: 'normal',
          acknowledgeHours: 24,
          respondHours: 72,
          resolveHours: 168,
          acknowledgeDue: new Date('2026-11-11T00:00:00.000Z'),
          respondDue: new Date('2026-11-13T00:00:00.000Z'),
          resolveDue: new Date('2026-11-17T00:00:00.000Z'),
        }),
      true,
    );
    expect(first).toBe(true);
    const second = await asApp(
      'admin',
      {},
      async (tx) =>
        repository.freezeSla(tx, {
          reportId,
          policyVersion: 'sla-v2',
          priority: 'critical',
          acknowledgeHours: 1,
          respondHours: 2,
          resolveHours: 3,
          acknowledgeDue: new Date('2026-01-01T00:00:00.000Z'),
          respondDue: new Date('2026-01-02T00:00:00.000Z'),
          resolveDue: new Date('2026-01-03T00:00:00.000Z'),
        }),
      true,
    );
    expect(second).toBe(false);
    const stored = await pool.query<{ policy_version: string; priority: string }>(
      `SELECT policy_version, priority FROM report_sla WHERE report_id = $1`,
      [reportId],
    );
    expect(stored.rows[0]?.policy_version).toBe('sla-v1');
    expect(stored.rows[0]?.priority).toBe('normal');
  });

  it('rejects an SLA whose deadlines are out of order', async () => {
    const reportId = await responseId('LPR-2026-000102');
    await expect(
      pool.query(
        `UPDATE report_sla SET respond_due = acknowledge_due - interval '1 hour'
         WHERE report_id = $1`,
        [reportId],
      ),
    ).rejects.toThrow(/ck_report_sla_order/u);
  });

  it('keeps responses hidden from an unrelated institution', async () => {
    const visible = await asApp(
      'partner',
      { institutionId: POLRES },
      async (tx) => repository.listResponses(tx, await responseId('LPR-2026-000101')),
    );
    expect(visible).toHaveLength(0);
  });

  it('shows responses to the owning institution', async () => {
    const visible = await asApp(
      'partner',
      { institutionId: DISHUB },
      async (tx) => repository.listResponses(tx, await responseId('LPR-2026-000101')),
    );
    expect(visible.length).toBeGreaterThanOrEqual(2);
    expect(visible[0]?.institutionName).toBe('Dishub');
  });

  it('shows responses publicly only for an approved report', async () => {
    const publicRows = await asApp('public', {}, async (tx) =>
      repository.listResponses(tx, await responseId('LPR-2026-000101')),
    );
    expect(publicRows.length).toBeGreaterThanOrEqual(2);
    await pool.query(
      `UPDATE reports SET moderation = 'pending' WHERE public_id = 'LPR-2026-000101'`,
    );
    const hidden = await asApp('public', {}, async (tx) =>
      repository.listResponses(tx, await responseId('LPR-2026-000101')),
    );
    expect(hidden).toHaveLength(0);
    await pool.query(
      `UPDATE reports SET moderation = 'approved' WHERE public_id = 'LPR-2026-000101'`,
    );
  });

  it('hides responses entirely from the anonymous pool scope', async () => {
    const rows = await asApp('none', {}, async (tx) =>
      repository.listResponses(tx, await responseId('LPR-2026-000101')),
    );
    expect(rows).toHaveLength(0);
  });

  it('stops hadir_app from updating responses directly', async () => {
    await expect(
      asApp('admin', {}, async (tx) =>
        tx.execute(sql`UPDATE report_responses SET body = repeat('z', 40)`),
      ),
    ).rejects.toThrow(/permission denied|append-only|Failed query/u);
  });

  it('enforces one pending invite per email and institution', async () => {
    const emailHash = 'a'.repeat(64);
    const first = await asApp(
      'partner',
      { institutionId: DISHUB },
      async (tx) =>
        repository.createInvite(tx, {
          institutionId: DISHUB,
          emailHash,
          emailEnc: Buffer.from([0]),
          role: 'responder',
          tokenHash: Buffer.alloc(32, 1),
          invitedBy: USER_A,
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      true,
    );
    expect(first).not.toBeNull();
    const second = await asApp(
      'partner',
      { institutionId: DISHUB },
      async (tx) =>
        repository.createInvite(tx, {
          institutionId: DISHUB,
          emailHash,
          emailEnc: Buffer.from([0]),
          role: 'admin',
          tokenHash: Buffer.alloc(32, 2),
          invitedBy: USER_A,
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      true,
    );
    expect(second).toBeNull();
  });

  it('consumes an invite only once', async () => {
    const rows = await pool.query<{ id: string }>(
      `SELECT id FROM partner_invites WHERE consumed_at IS NULL LIMIT 1`,
    );
    const inviteId = rows.rows[0]?.id;
    expect(inviteId).toBeDefined();
    const first = await asApp(
      'partner',
      { institutionId: DISHUB },
      async (tx) => repository.consumeInvite(tx, inviteId as string),
      true,
    );
    expect(first).toBe(true);
    const second = await asApp(
      'partner',
      { institutionId: DISHUB },
      async (tx) => repository.consumeInvite(tx, inviteId as string),
      true,
    );
    expect(second).toBe(false);
  });

  it('counts only active admins when deciding survivor safety', async () => {
    const admins = await asApp('partner', { institutionId: DISHUB }, async (tx) =>
      repository.countActiveAdmins(tx, DISHUB),
    );
    expect(admins).toBe(2);
    await asApp(
      'partner',
      { institutionId: DISHUB },
      async (tx) => repository.revokeMembership(tx, await membershipId(USER_C)),
      true,
    );
    const after = await asApp('partner', { institutionId: DISHUB }, async (tx) =>
      repository.countActiveAdmins(tx, DISHUB),
    );
    expect(after).toBe(1);
  });

  it('revokes every session of a removed member', async () => {
    const membership = await membershipId(USER_B);
    await pool.query(
      `INSERT INTO partner_sessions (user_id, membership_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day'), ($1, $2, $4, now() + interval '1 day')`,
      [USER_B, membership, Buffer.alloc(32, 7), Buffer.alloc(32, 8)],
    );
    const revoked = await asApp(
      'partner',
      { institutionId: DISHUB },
      async (tx) => repository.revokeSessionsForUser(tx, USER_B),
      true,
    );
    expect(revoked).toBe(2);
    const open = await count(
      `SELECT count(*)::text AS n FROM partner_sessions WHERE user_id = '${USER_B}' AND revoked_at IS NULL`,
    );
    expect(open).toBe(0);
  });

  const membershipId = async (userId: string): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM partner_memberships WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1`,
      [userId],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('Keanggotaan tidak ditemukan.');
    }
    return id;
  };
});
