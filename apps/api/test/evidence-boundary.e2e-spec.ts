import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database, Transaction } from '../src/db/client';
import { EvidenceRepository } from '../src/db/repositories/evidence.repository';

const DATABASE_URL = process.env.HADIR_BOUNDARY_DATABASE_URL;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'fixtures/admin-boundary.sql');
const MIGRATIONS = resolve(HERE, '../src/db/migrations');

const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';
const ROUTE = '0192f0c4-0000-7000-8000-0000000000e1';
const ADMIN_ID = '0192f0c4-0000-7000-8000-0000000000d1';
const CITY = '0192f0c4-0000-7000-8000-0000000000f1';
const OTHER_CITY = '0192f0c4-0000-7000-8000-0000000000f2';

const describeBoundary = DATABASE_URL === undefined ? describe.skip : describe;

describeBoundary('commitment and provenance boundary against real PostgreSQL', () => {
  let pool: Pool;
  let repository: EvidenceRepository;

  const asApp = async <T>(
    scope: 'admin' | 'public' | 'none',
    work: (tx: Transaction) => Promise<T>,
    commit = false,
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE hadir_app');
      await client.query(`SELECT set_config('app.scope', $1, true)`, [scope]);
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

  const countRows = async (view: string): Promise<number> => {
    const result = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM ${view}`,
    );
    return Number(result.rows[0]?.n ?? '0');
  };

  const insertCommitment = async (overrides: {
    validFrom: string;
    validUntil: string | null;
    status?: 'draft' | 'verified';
    dayScope?: 'all' | 'weekday';
    stopId?: string | null;
  }): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO service_commitments (
         institution_id, route_id, stop_id, kind, day_scope, headway_min,
         source_document_url, valid_from, valid_until, status, verified_at, verified_by
       ) VALUES ($1, NULL, $2, 'headway', $3, 10,
         'https://dinhub.test/sk.pdf', $4::date, $5::date, $6::commitment_status,
         CASE WHEN $6::text = 'verified' THEN now() ELSE NULL END,
         CASE WHEN $6::text = 'verified' THEN $7::uuid ELSE NULL END)
       RETURNING id`,
      [
        DISHUB,
        overrides.stopId === undefined ? STOP : overrides.stopId,
        overrides.dayScope ?? 'all',
        overrides.validFrom,
        overrides.validUntil,
        overrides.status ?? 'verified',
        ADMIN_ID,
      ],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) {
      throw new Error('Insert janji layanan gagal.');
    }
    return id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    repository = new EvidenceRepository();

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
      CREATE TABLE routes (
        id uuid PRIMARY KEY DEFAULT uuidv7(),
        code text NOT NULL,
        name text NOT NULL,
        mode text NOT NULL DEFAULT 'angkot',
        created_at timestamp with time zone NOT NULL DEFAULT now()
      )
    `);
    await pool.query(
      await readFile(resolve(MIGRATIONS, '0026_commitments_provenance_context.sql'), 'utf8'),
    );

    await pool.query(`INSERT INTO institutions (id, name) VALUES ($1, 'Dishub')`, [
      DISHUB,
    ]);
    await pool.query(
      `INSERT INTO stops (id, code, name) VALUES ($1, 'BMS-A12', 'Halte UMP')`,
      [STOP],
    );
    await pool.query(
      `INSERT INTO routes (id, code, name) VALUES ($1, 'A12', 'UMP - Terminal')`,
      [ROUTE],
    );
    await pool.query(
      `INSERT INTO platform_admins (id, email, display_name, role, password_hash, totp_secret_enc)
       VALUES ($1, 'ops@hadir.id', 'Operator', 'superadmin', '\\x00'::bytea, '\\x01'::bytea)`,
      [ADMIN_ID],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('rejects two overlapping verified commitments for the same scope', async () => {
    await pool.query('TRUNCATE service_commitments');
    await insertCommitment({ validFrom: '2026-01-01', validUntil: '2026-06-30' });
    await expect(
      insertCommitment({ validFrom: '2026-03-01', validUntil: '2026-12-31' }),
    ).rejects.toThrow(/ex_commitment_overlap/u);
  });

  it('accepts adjacent commitments that do not overlap', async () => {
    await pool.query('TRUNCATE service_commitments');
    await insertCommitment({ validFrom: '2026-01-01', validUntil: '2026-06-30' });
    const second = await insertCommitment({
      validFrom: '2026-07-01',
      validUntil: null,
    });
    expect(second).toHaveLength(36);
  });

  it('allows overlapping drafts without tripping the exclusion constraint', async () => {
    await pool.query('TRUNCATE service_commitments');
    await insertCommitment({
      validFrom: '2026-01-01',
      validUntil: '2026-06-30',
      status: 'draft',
    });
    const second = await insertCommitment({
      validFrom: '2026-03-01',
      validUntil: '2026-12-31',
      status: 'draft',
    });
    expect(second).toHaveLength(36);
  });

  it('separates day scopes in the exclusion constraint', async () => {
    await pool.query('TRUNCATE service_commitments');
    await insertCommitment({ validFrom: '2026-01-01', validUntil: '2026-12-31' });
    const weekday = await insertCommitment({
      validFrom: '2026-01-01',
      validUntil: '2026-12-31',
      dayScope: 'weekday',
    });
    expect(weekday).toHaveLength(36);
  });

  it('rejects a commitment with neither route nor stop', async () => {
    await expect(
      insertCommitment({
        validFrom: '2026-01-01',
        validUntil: null,
        stopId: null,
      }),
    ).rejects.toThrow(/ck_commitment_scope/u);
  });

  it('hides drafts and revoked rows from the public view', async () => {
    await pool.query('TRUNCATE service_commitments');
    await insertCommitment({ validFrom: '2026-01-01', validUntil: null });
    await insertCommitment({
      validFrom: '2027-01-01',
      validUntil: null,
      status: 'draft',
    });
    const total = await countRows('service_commitments');
    const publicRows = await countRows('service_commitments_public');
    expect(total).toBe(2);
    expect(publicRows).toBe(1);
  });

  it('creates, verifies and reads back a commitment through the repository', async () => {
    await pool.query('TRUNCATE service_commitments');
    const created = await asApp(
      'admin',
      async (tx) =>
        repository.createCommitment(tx, {
          institutionId: DISHUB,
          routeId: null,
          stopId: STOP,
          kind: 'headway',
          dayScope: 'all',
          headwayMin: 12,
          spanStart: null,
          spanEnd: null,
          sourceDocumentUrl: 'https://dinhub.test/sk-2026.pdf',
          sourceDocumentTitle: 'SK Kepala Dishub 2026',
          sourceDocumentVersion: 'v2',
          validFrom: '2026-01-01',
          validUntil: null,
          notes: null,
        }),
      true,
    );
    expect(created.status).toBe('draft');
    expect(created.institutionName).toBe('Dishub');

    const verified = await asApp(
      'admin',
      async (tx) => repository.verifyCommitment(tx, created.id, ADMIN_ID),
      true,
    );
    expect(verified?.status).toBe('verified');
    expect(verified?.verifiedAt).toBeInstanceOf(Date);

    const listed = await asApp('public', async (tx) =>
      repository.listCommitments(tx, {
        routeId: null,
        stopId: STOP,
        onDate: '2026-05-01',
        dayScope: null,
        limit: 10,
      }),
    );
    expect(listed.map((row) => row.id)).toContain(created.id);
  });

  it('refuses to verify twice', async () => {
    await pool.query('TRUNCATE service_commitments');
    const id = await insertCommitment({
      validFrom: '2026-01-01',
      validUntil: null,
      status: 'draft',
    });
    const first = await asApp(
      'admin',
      async (tx) => repository.verifyCommitment(tx, id, ADMIN_ID),
      true,
    );
    expect(first).not.toBeNull();
    const second = await asApp(
      'admin',
      async (tx) => repository.verifyCommitment(tx, id, ADMIN_ID),
      true,
    );
    expect(second).toBeNull();
  });

  it('hides notices that are not public visible', async () => {
    await pool.query(
      `INSERT INTO notices (kind, stop_id, text, source_url, starts_at, ends_at, impact, public_visible)
       VALUES
         ('detour', $1, 'Pengalihan karena perbaikan jalan.', 'https://dinhub.test/1',
          '2026-10-12T07:00:00Z', '2026-10-12T10:00:00Z', 'major', true),
         ('repair', $1, 'Catatan internal belum terbit.', 'https://dinhub.test/2',
          '2026-10-13T07:00:00Z', '2026-10-13T10:00:00Z', 'minor', false)`,
      [STOP],
    );
    const total = await countRows('notices');
    const publicRows = await countRows('notices_public');
    expect(total).toBe(2);
    expect(publicRows).toBe(1);
  });

  it('lists context events through the public view only', async () => {
    const rows = await asApp('public', async (tx) =>
      repository.listContext(tx, {
        stopId: STOP,
        routeId: null,
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: new Date('2026-11-01T00:00:00.000Z'),
        limit: 20,
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.impact).toBe('major');
    expect(rows[0]?.text).toContain('Pengalihan');
  });

  it('acknowledges an incident exactly once', async () => {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM notices WHERE public_visible LIMIT 1`,
    );
    const noticeId = result.rows[0]?.id;
    expect(noticeId).toBeDefined();
    const first = await asApp(
      'admin',
      async (tx) => repository.acknowledgeIncident(tx, noticeId as string, DISHUB),
      true,
    );
    expect(first).toBe(true);
    const second = await asApp(
      'admin',
      async (tx) => repository.acknowledgeIncident(tx, noticeId as string, DISHUB),
      true,
    );
    expect(second).toBe(false);
  });

  const digest = (fill: number): Buffer => Buffer.alloc(32, fill);

  it('deduplicates identical analysis snapshots', async () => {
    await pool.query('TRUNCATE analysis_snapshots');
    const input = {
      subjectKind: 'stop_estimate' as const,
      subjectRef: STOP,
      methodVersion: 'km-v1',
      parameters: { tauSeconds: 2700 },
      datasetDigest: digest(1),
      outputDigest: digest(2),
      inputRows: 42,
      windowStart: new Date('2026-10-12T00:00:00.000Z'),
      windowEnd: new Date('2026-10-18T23:59:59.999Z'),
      evidenceLevel: 'indication',
      direction: 'no_excess',
      warnings: ['small_sample'],
      provenance: { schemaVersion: 1 },
    };
    const first = await asApp(
      'public',
      async (tx) => repository.insertSnapshot(tx, input),
      true,
    );
    expect(first).not.toBeNull();
    expect(first?.inputRows).toBe(42);
    expect(first?.warnings).toEqual(['small_sample']);

    const second = await asApp(
      'public',
      async (tx) => repository.insertSnapshot(tx, input),
      true,
    );
    expect(second).toBeNull();
  });

  it('reads back the latest snapshot for a subject', async () => {
    const snapshot = await asApp('public', async (tx) =>
      repository.findLatestSnapshot(tx, 'stop_estimate', STOP),
    );
    expect(snapshot?.subjectRef).toBe(STOP);
    expect(snapshot?.datasetDigest.toString('hex')).toBe(digest(1).toString('hex'));
  });

  it('rejects a snapshot digest of the wrong length', async () => {
    await expect(
      asApp(
        'public',
        async (tx) =>
          repository.insertSnapshot(tx, {
            subjectKind: 'stop_estimate',
            subjectRef: STOP,
            methodVersion: 'km-v1',
            parameters: {},
            datasetDigest: Buffer.alloc(31, 9),
            outputDigest: digest(3),
            inputRows: 1,
            windowStart: new Date('2026-10-12T00:00:00.000Z'),
            windowEnd: new Date('2026-10-12T23:59:59.999Z'),
            evidenceLevel: 'indication',
            direction: 'inconclusive',
            warnings: [],
            provenance: {},
          }),
        true,
      ),
    ).rejects.toThrow();
  });

  it('reads the holiday calendar and resolves the holiday scope', async () => {
    await pool.query('TRUNCATE holiday_calendar');
    await pool.query(
      `INSERT INTO holiday_calendar (city_id, holiday_date, name, source_url)
       VALUES (NULL, '2026-12-25'::date, 'Hari Raya', 'https://dinhub.test/libur')`,
    );

    const national = await asApp('public', async (tx) =>
      repository.listHolidays(tx, { from: '2026-12-01', to: '2026-12-31', cityId: null }),
    );
    expect(national).toHaveLength(1);
    expect(national[0]?.date).toBe('2026-12-25');
    expect(national[0]?.cityId).toBeNull();

    const otherMonth = await asApp('public', async (tx) =>
      repository.listHolidays(tx, { from: '2026-11-01', to: '2026-11-30', cityId: null }),
    );
    expect(otherMonth).toEqual([]);
  });

  it('keeps a city holiday out of another city calendar', async () => {
    await pool.query('TRUNCATE holiday_calendar');
    await pool.query(
      `INSERT INTO cities (id, code, name) VALUES ($1, 'SMG', 'Semarang'), ($2, 'JKT', 'Jakarta')
       ON CONFLICT DO NOTHING`,
      [CITY, OTHER_CITY],
    );
    await pool.query(
      `UPDATE stops SET city_id = $1 WHERE id = $2`,
      [CITY, STOP],
    );
    await pool.query(
      `INSERT INTO holiday_calendar (city_id, holiday_date, name, source_url)
       VALUES ($1, '2026-12-24'::date, 'Cuti bersama kota', 'https://dinhub.test/cuti')`,
      [CITY],
    );

    const sameCity = await asApp('public', async (tx) =>
      repository.listHolidays(tx, { from: '2026-12-01', to: '2026-12-31', cityId: CITY }),
    );
    expect(sameCity.map((row) => row.date)).toEqual(['2026-12-24']);

    const otherCity = await asApp('public', async (tx) =>
      repository.listHolidays(tx, {
        from: '2026-12-01',
        to: '2026-12-31',
        cityId: OTHER_CITY,
      }),
    );
    expect(otherCity).toEqual([]);

    const stopCity = await asApp('public', async (tx) =>
      repository.findStopCityId(tx, STOP),
    );
    expect(stopCity).toBe(CITY);
  });

  it('creates a notice through the repository and keeps it non public when asked', async () => {
    const created = await asApp(
      'admin',
      async (tx) =>
        repository.createIncident(tx, {
          kind: 'suspension',
          impact: 'service_stopped',
          text: 'Layanan dihentikan sementara karena banjir.',
          sourceUrl: 'https://dinhub.test/bencana/1',
          stopId: STOP,
          routeId: null,
          cityId: null,
          startsAt: new Date('2026-10-20T00:00:00.000Z'),
          endsAt: new Date('2026-10-20T06:00:00.000Z'),
          publicVisible: false,
        }),
      true,
    );
    expect(created).toHaveLength(36);
    const visible = await pool.query<{ impact: string }>(
      `SELECT impact FROM notices_public WHERE id = $1`,
      [created],
    );
    expect(visible.rows).toHaveLength(0);
    const raw = await pool.query<{ impact: string }>(
      `SELECT impact::text AS impact FROM notices WHERE id = $1`,
      [created],
    );
    expect(raw.rows[0]?.impact).toBe('service_stopped');
  });
});
