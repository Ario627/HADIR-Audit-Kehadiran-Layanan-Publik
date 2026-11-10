import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database, Transaction } from '../src/db/client';
import { GovernanceRepository } from '../src/db/repositories/governance.repository';

const DATABASE_URL = process.env.HADIR_BOUNDARY_DATABASE_URL;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'fixtures/admin-boundary.sql');
const MIGRATIONS = resolve(HERE, '../src/db/migrations');

const CITY = '0192f0c4-0000-7000-8000-0000000000c0';
const OTHER_CITY = '0192f0c4-0000-7000-8000-0000000000c9';
const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const POLRES = '0192f0c4-0000-7000-8000-0000000000a2';
const OTHER_CITY_INSTITUTION = '0192f0c4-0000-7000-8000-0000000000a3';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';
const ADMIN_ID = '0192f0c4-0000-7000-8000-0000000000d1';
const DEVICE = 'd'.repeat(64);
const OTHER_DEVICE = 'f'.repeat(64);

const describeBoundary = DATABASE_URL === undefined ? describe.skip : describe;

describeBoundary('governance boundary against real PostgreSQL', () => {
  let pool: Pool;
  let repository: GovernanceRepository;

  const asApp = async <T>(
    scope: 'admin' | 'public' | 'partner' | 'citizen' | 'none',
    extra: {
      institutionId?: string;
      deviceHash?: string;
    },
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

  const reportId = async (publicId: string): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM reports WHERE public_id = $1`,
      [publicId],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('Laporan tidak ditemukan.');
    }
    return id;
  };

  const grantPanel = async (
    publicId: string,
    institutionId: string,
    cityId: string,
    role: 'observer' | 'verifier' = 'verifier',
  ): Promise<void> => {
    await pool.query(
      `INSERT INTO report_panel_grants (
         report_id, institution_id, claimant_institution_id, city_id, role, status,
         invited_by, decided_at
       ) VALUES ($1, $2, $3, $4, $5::panel_role, 'active', $6, now())`,
      [await reportId(publicId), institutionId, DISHUB, cityId, role, ADMIN_ID],
    );
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    repository = new GovernanceRepository();

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
      CREATE TABLE cities (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        code text NOT NULL UNIQUE,
        name text NOT NULL
      )
    `);
    await pool.query(
      'ALTER TABLE institutions ADD COLUMN city_id uuid REFERENCES cities(id)',
    );
    await pool.query('ALTER TABLE stops ADD COLUMN city_id uuid REFERENCES cities(id)');
    await pool.query('ALTER TABLE reports ADD COLUMN city_id uuid REFERENCES cities(id)');
    await pool.query(`
      CREATE TYPE resolution_method AS ENUM (
        'citizen_confirmation', 'field_inspection', 'observation_data', 'panel_review'
      )
    `);
    await pool.query(`
      CREATE TYPE resolution_verdict AS ENUM ('confirmed', 'refuted', 'inconclusive')
    `);
    await pool.query(`
      CREATE TYPE verifier_kind AS ENUM (
        'citizen', 'independent_institution', 'platform', 'automatic'
      )
    `);
    await pool.query(`
      CREATE TABLE resolution_verifications (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        method resolution_method NOT NULL,
        verdict resolution_verdict NOT NULL,
        verifier_kind verifier_kind NOT NULL,
        verifier_institution_id uuid REFERENCES institutions(id) ON DELETE RESTRICT,
        verifier_user_id uuid,
        claimant_institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
        note text,
        evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
        verified_at timestamp with time zone NOT NULL DEFAULT now(),
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE report_responses (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        institution_id uuid NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
        kind text NOT NULL DEFAULT 'initial',
        body text NOT NULL DEFAULT 'x',
        evidence_urls text[] NOT NULL DEFAULT '{}'::text[],
        corrects_response_id uuid,
        published_at timestamp with time zone NOT NULL DEFAULT now(),
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE report_sla (
        report_id uuid PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
        policy_version text NOT NULL,
        priority text NOT NULL,
        acknowledge_hours numeric(6, 2) NOT NULL,
        respond_hours numeric(6, 2) NOT NULL,
        resolve_hours numeric(6, 2) NOT NULL,
        acknowledge_due timestamp with time zone NOT NULL,
        respond_due timestamp with time zone NOT NULL,
        resolve_due timestamp with time zone NOT NULL,
        frozen_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      GRANT SELECT ON cities TO hadir_app;
      GRANT SELECT, INSERT, UPDATE ON partner_users, resolution_verifications,
        report_sla TO hadir_app
    `);
    await pool.query(`
      CREATE TYPE media_status AS ENUM ('pending', 'ready', 'quarantined', 'deleted')
    `);
    await pool.query(`ALTER TABLE report_media ALTER COLUMN status DROP DEFAULT`);
    await pool.query(`
      ALTER TABLE report_media
        ALTER COLUMN status TYPE media_status USING status::media_status
    `);
    await pool.query(`
      ALTER TABLE report_media ALTER COLUMN status SET DEFAULT 'pending'::media_status
    `);
    await pool.query(
      await readFile(resolve(MIGRATIONS, '0024z_media_status_moderation.sql'), 'utf8'),
    );
    await pool.query(
      await readFile(resolve(MIGRATIONS, '0029_panel_appeals_city_sla.sql'), 'utf8'),
    );
    await pool.query(
      await readFile(resolve(MIGRATIONS, '0030_response_attestation.sql'), 'utf8'),
    );
    await pool.query('ALTER TABLE reports ENABLE ROW LEVEL SECURITY');
    await pool.query('ALTER TABLE report_media ENABLE ROW LEVEL SECURITY');
    await pool.query('ALTER TABLE report_responses ENABLE ROW LEVEL SECURITY');
    await pool.query('ALTER TABLE resolution_verifications ENABLE ROW LEVEL SECURITY');

    await pool.query(
      `INSERT INTO cities (id, code, name) VALUES ($1, 'SMG', 'Semarang'), ($2, 'JKT', 'Jakarta')`,
      [CITY, OTHER_CITY],
    );
    await pool.query(
      `INSERT INTO institutions (id, city_id, name) VALUES ($1, $3, 'Dishub'), ($2, $3, 'Polrestabes'), ($4, $5, 'Dishub JKT')`,
      [DISHUB, POLRES, CITY, OTHER_CITY_INSTITUTION, OTHER_CITY],
    );
    await pool.query(
      `INSERT INTO stops (id, code, name, city_id) VALUES ($1, 'BMS-A12', 'Halte UMP', $2)`,
      [STOP, CITY],
    );
    await pool.query(
      `INSERT INTO platform_admins (id, email, display_name, role, password_hash, totp_secret_enc)
       VALUES ($1, 'ops@hadir.id', 'Operator', 'superadmin', '\\x00'::bytea, '\\x01'::bytea)`,
      [ADMIN_ID],
    );
    await pool.query(
      `INSERT INTO reports (
         public_id, category, stop_id, device_hash, device_day_hash, text,
         institution_id, moderation, status
       ) VALUES
         ('LPR-2026-000201', 'service_wait', $1, $3, repeat('e',64),
          'Laporan panel yang cukup panjang untuk diuji.', $2, 'approved', 'claimed_resolved'),
         ('LPR-2026-000202', 'service_wait', $1, $4, repeat('e',64),
          'Laporan banding yang cukup panjang untuk diuji.', $2, 'approved', 'verified_resolved')`,
      [STOP, DISHUB, DEVICE, OTHER_DEVICE],
    );
    await pool.query(`UPDATE reports SET city_id = $1`, [CITY]);
    await pool.query(
      `INSERT INTO report_events (report_id, seq, kind, actor_type, actor_id,
         prev_hash, payload_hash, chain_hash)
       SELECT r.id, 1, 'submitted', 'citizen', NULL, repeat('0',64)::bytea,
              repeat('1',32)::bytea, repeat('2',32)::bytea
       FROM reports r`,
    );
    await pool.query(
      `INSERT INTO report_events (report_id, seq, kind, actor_type, actor_id,
         prev_hash, payload_hash, chain_hash)
       SELECT r.id, 2, 'verified_resolved', 'partner', NULL, repeat('2',32)::bytea,
              repeat('3',32)::bytea, repeat('4',32)::bytea
       FROM reports r WHERE r.public_id = 'LPR-2026-000202'`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('accepts a same-city panel grant', async () => {
    await grantPanel('LPR-2026-000201', POLRES, CITY);
    const grants = await asApp('admin', {}, async (tx) =>
      repository.listPanelGrants(tx, await reportId('LPR-2026-000201')),
    );
    expect(grants).toHaveLength(1);
    expect(grants[0]?.role).toBe('verifier');
    expect(grants[0]?.claimantInstitutionName).toBe('Dishub');
  });

  it('refuses the claimant institution as a panel member', async () => {
    await expect(grantPanel('LPR-2026-000201', DISHUB, CITY)).rejects.toThrow(
      /ck_panel_independence/u,
    );
  });

  it('refuses a panel member from another city', async () => {
    await expect(
      grantPanel('LPR-2026-000201', OTHER_CITY_INSTITUTION, OTHER_CITY),
    ).rejects.toThrow(/kota panel harus sama/u);
  });

  it('lets the panel verifier see the report but not another city', async () => {
    const seen = await asApp(
      'partner',
      { institutionId: POLRES },
      async (tx) => repository.findReportContext(tx, 'LPR-2026-000201'),
    );
    expect(seen?.publicId).toBe('LPR-2026-000201');
    const foreign = await asApp(
      'partner',
      { institutionId: OTHER_CITY_INSTITUTION },
      async (tx) => repository.findReportContext(tx, 'LPR-2026-000201'),
    );
    expect(foreign).toBeNull();
  });

  it('detects an active verifier and refuses a non-member', async () => {
    const yes = await asApp('partner', { institutionId: POLRES }, async (tx) =>
      repository.findActiveVerifier(tx, await reportId('LPR-2026-000201'), POLRES),
    );
    expect(yes).toBe(true);
    const no = await asApp('partner', { institutionId: OTHER_CITY_INSTITUTION }, async (tx) =>
      repository.findActiveVerifier(
        tx,
        await reportId('LPR-2026-000201'),
        OTHER_CITY_INSTITUTION,
      ),
    );
    expect(no).toBe(false);
  });

  it('applies a panel verdict through the SECURITY DEFINER function', async () => {
    const applied = await asApp(
      'partner',
      { institutionId: POLRES },
      async (tx) =>
        repository.applyPanelVerdict(
          tx,
          await reportId('LPR-2026-000201'),
          'verified_resolved',
          {
            method: 'field_inspection',
            verdict: 'confirmed',
            note: 'Sudah dicek langsung di halte.',
            evidenceUrls: ['https://bukti.test/lapangan.jpg'],
          },
        ),
      true,
    );
    expect(applied).toBe('verified_resolved');
    const stored = await pool.query<{ status: string }>(
      `SELECT status::text AS status FROM reports WHERE public_id = 'LPR-2026-000201'`,
    );
    expect(stored.rows[0]?.status).toBe('verified_resolved');
  });

  it('refuses a verdict from an institution that is not a panel verifier', async () => {
    await expect(
      asApp('partner', { institutionId: OTHER_CITY_INSTITUTION }, async (tx) =>
        repository.applyPanelVerdict(
          tx,
          await reportId('LPR-2026-000201'),
          'disputed',
          {
            method: 'panel_review',
            verdict: 'refuted',
            note: null,
            evidenceUrls: [],
          },
        ),
      ),
    ).rejects.toThrow(/bukan verifier panel|Failed query/u);
  });

  it('refuses a verdict from the claimant institution', async () => {
    await expect(
      asApp('partner', { institutionId: DISHUB }, async (tx) =>
        repository.applyPanelVerdict(tx, await reportId('LPR-2026-000202'), 'disputed', {
          method: 'panel_review',
          verdict: 'refuted',
          note: null,
          evidenceUrls: [],
        }),
      ),
    ).rejects.toThrow(/bukan verifier panel|Failed query/u);
  });

  it('records an independent verification row when the panel applies a verdict', async () => {
    const target = await reportId('LPR-2026-000201');
    const rows = await pool.query<{
      verifier_kind: string;
      verdict: string;
      method: string;
      verifier_institution_id: string;
      claimant_institution_id: string;
      note: string | null;
    }>(
      `SELECT verifier_kind::text AS verifier_kind, verdict::text AS verdict,
              method::text AS method, verifier_institution_id, claimant_institution_id, note
       FROM resolution_verifications WHERE report_id = $1`,
      [target],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.verifier_kind).toBe('independent_institution');
    expect(rows.rows[0]?.verdict).toBe('confirmed');
    expect(rows.rows[0]?.method).toBe('field_inspection');
    expect(rows.rows[0]?.verifier_institution_id).toBe(POLRES);
    expect(rows.rows[0]?.claimant_institution_id).toBe(DISHUB);
    expect(rows.rows[0]?.note).toContain('dicek langsung');
  });

  it('refuses a panel verdict with an unsupported method', async () => {
    await expect(
      pool.query(
        `SELECT panel_apply_verdict($1::uuid, 'disputed'::report_status,
           'citizen_confirmation'::resolution_method, 'refuted'::resolution_verdict, NULL, '{}'::text[])`,
        [await reportId('LPR-2026-000202')],
      ),
    ).rejects.toThrow();
  });

  it('applies the same-city rule on update as well as insert', async () => {
    await expect(
      pool.query(
        `UPDATE report_panel_grants SET city_id = $1 WHERE institution_id = $2`,
        [OTHER_CITY, POLRES],
      ),
    ).rejects.toThrow(/kota panel harus sama/u);
  });

  it('refuses an appeal from a device that does not own the report', async () => {
    await expect(
      pool.query(
        `INSERT INTO report_appeals (report_id, device_hash, grounds, statement)
         VALUES ($1, $2, 'resolution', 'Banding dari perangkat lain yang tidak berhak.')`,
        [await reportId('LPR-2026-000202'), DEVICE],
      ),
    ).rejects.toThrow(/perangkat pelapor/u);
  });

  it('accepts a rightful appeal and blocks a duplicate ground', async () => {
    const target = await reportId('LPR-2026-000202');
    await expect(
      pool.query(
        `INSERT INTO report_appeals (report_id, device_hash, grounds, statement)
         VALUES ($1, $2, 'resolution', 'Masalah masih terjadi setelah klaim selesai.')`,
        [target, OTHER_DEVICE],
      ),
    ).resolves.toBeDefined();
    await expect(
      pool.query(
        `INSERT INTO report_appeals (report_id, device_hash, grounds, statement)
         VALUES ($1, $2, 'resolution', 'Banding kedua dengan alasan yang sama persis.')`,
        [target, OTHER_DEVICE],
      ),
    ).rejects.toThrow(/uq_appeal_ground/u);
  });

  it('allows a second appeal on a different ground', async () => {
    await expect(
      pool.query(
        `INSERT INTO report_appeals (report_id, device_hash, grounds, statement)
         VALUES ($1, $2, 'service', 'Tidak ada tindak lanjut sama sekali hingga kini.')`,
        [await reportId('LPR-2026-000202'), OTHER_DEVICE],
      ),
    ).resolves.toBeDefined();
  });

  it('refuses rewriting the statement of a submitted appeal', async () => {
    await expect(
      pool.query(
        `UPDATE report_appeals SET statement = repeat('z', 40) WHERE grounds = 'resolution'`,
      ),
    ).rejects.toThrow(/tidak boleh diubah/u);
  });

  it('refuses deleting an appeal', async () => {
    await expect(pool.query(`DELETE FROM report_appeals WHERE true`)).rejects.toThrow(
      /append-only/u,
    );
  });

  it('lets the admin decide an appeal without touching the statement', async () => {
    const result = await pool.query<{ id: string }>(
      `UPDATE report_appeals
       SET status = 'overturned', decided_by = $1, decided_at = now(),
           decision_note = 'Terbukti masih ada antrean panjang di lapangan.',
           outcome_transition = 'disputed'
       WHERE grounds = 'resolution'
       RETURNING id`,
      [ADMIN_ID],
    );
    expect(result.rows).toHaveLength(1);
  });

  it('refuses an appeal decision without a note', async () => {
    await expect(
      pool.query(
        `UPDATE report_appeals SET status = 'upheld', decided_at = now()
         WHERE grounds = 'service'`,
      ),
    ).rejects.toThrow(/ck_appeal_outcome|ck_appeal_decision|ck_appeal_note/u);
  });

  it('hides appeals from the anonymous pool scope', async () => {
    const rows = await asApp('none', {}, async (tx) =>
      repository.listAppeals(tx, await reportId('LPR-2026-000202')),
    );
    expect(rows).toHaveLength(0);
  });

  it('shows own appeals to the reporting device only', async () => {
    const own = await asApp('citizen', { deviceHash: OTHER_DEVICE }, async (tx) =>
      repository.listAppealsForDevice(tx, OTHER_DEVICE, 10),
    );
    expect(own).toHaveLength(2);
    const stranger = await asApp('citizen', { deviceHash: DEVICE }, async (tx) =>
      repository.listAppealsForDevice(tx, DEVICE, 10),
    );
    expect(stranger).toHaveLength(0);
  });

  it('stores and reads a city SLA override', async () => {
    const saved = await asApp(
      'admin',
      {},
      async (tx) =>
        repository.upsertCitySlaOverride(tx, {
          cityId: CITY,
          priority: 'high',
          acknowledgeHours: 4,
          respondHours: 12,
          resolveHours: 48,
          sourceUrl: 'https://walikota.test/perwali/1',
          note: null,
        }),
      true,
    );
    expect(saved).toBe(true);
    const rows = await asApp('public', {}, async (tx) =>
      repository.listCitySlaOverrides(tx, CITY),
    );
    expect(rows[0]?.priority).toBe('high');
    expect(rows[0]?.resolveHours).toBe(48);
  });

  it('rejects an override whose deadlines are out of order', async () => {
    await expect(
      pool.query(
        `INSERT INTO city_sla_overrides (
           city_id, priority, acknowledge_hours, respond_hours, resolve_hours, source_url
         ) VALUES ($1, 'normal', 10, 4, 20, 'https://walikota.test/perwali/2')`,
        [CITY],
      ),
    ).rejects.toThrow(/ck_city_sla_order/u);
  });

  it('computes scorecard counts from real rows', async () => {
    const counts = await asApp('public', {}, async (tx) =>
      repository.scorecardCounts(tx, DISHUB, 90),
    );
    expect(counts.reportsReceived).toBeGreaterThanOrEqual(2);
    expect(counts.reportsAcknowledged).toBe(0);
    expect(counts.appealsOverturned).toBeGreaterThanOrEqual(1);
  });
});
