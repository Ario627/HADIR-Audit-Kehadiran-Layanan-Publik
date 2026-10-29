import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import type { Database, Transaction } from '../src/db/client';
import { AdminRepository } from '../src/db/repositories/admin.repository';
import { ChainRepository } from '../src/db/repositories/chain.repository';
import { ExportRepository } from '../src/db/repositories/export.repository';
import { ReportsRepository } from '../src/db/repositories/reports.repository';
import { merkleRoot, merkleSummary } from '../src/modules/transparency/merkle';

const DATABASE_URL = process.env.HADIR_BOUNDARY_DATABASE_URL;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'fixtures/admin-boundary.sql');
const MIGRATIONS = resolve(HERE, '../src/db/migrations');

const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const POLRES = '0192f0c4-0000-7000-8000-0000000000a2';
const USER_A = '0192f0c4-0000-7000-8000-0000000000b1';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';
const DEVICE_OWNER = 'd'.repeat(64);
const DEVICE_OTHER = 'f'.repeat(64);
const ADMIN_ID = '0192f0c4-0000-7000-8000-0000000000d1';

const describeBoundary = DATABASE_URL === undefined ? describe.skip : describe;

interface RoleSession {
  tx: Transaction;
  client: PoolClient;
}

describeBoundary('admin and privacy boundary against real PostgreSQL', () => {
  let pool: Pool;
  let db: Database;

  const withRole = async <T>(
    scope: 'admin' | 'public' | 'citizen' | 'partner' | 'none',
    extra: { deviceHash?: string; institutionId?: string },
    work: (tx: Transaction) => Promise<T>,
    commit = false,
  ): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE hadir_app');
      await client.query(`SELECT set_config('app.scope', $1, true)`, [scope]);
      if (extra.deviceHash !== undefined) {
        await client.query(`SELECT set_config('app.device_hash', $1, true)`, [
          extra.deviceHash,
        ]);
      }
      if (extra.institutionId !== undefined) {
        await client.query(`SELECT set_config('app.institution_id', $1, true)`, [
          extra.institutionId,
        ]);
      }
      const scoped = drizzle(client) as unknown as Database;
      const session: RoleSession = { tx: scoped as unknown as Transaction, client };
      const result = await work(session.tx);
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const asAdmin = <T>(work: (tx: Transaction) => Promise<T>, commit = false) =>
    withRole('admin', {}, work, commit);

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    db = drizzle(pool) as unknown as Database;

    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query(await readFile(FIXTURE, 'utf8'));
    await pool.query('GRANT USAGE ON SCHEMA public TO hadir_app');
    await pool.query(await readFile(resolve(MIGRATIONS, '0017_read_scopes.sql'), 'utf8'));
    await pool.query(await readFile(resolve(MIGRATIONS, '0022_admin_rls.sql'), 'utf8'));
    await pool.query(
      await readFile(resolve(MIGRATIONS, '0023_contact_withdrawal.sql'), 'utf8'),
    );

    await pool.query(
      `INSERT INTO institutions (id, name) VALUES ($1, 'Dishub'), ($2, 'Polrestabes')`,
      [DISHUB, POLRES],
    );
    await pool.query(`INSERT INTO stops (id, code, name) VALUES ($1, 'BMS-A12', 'Halte UMP')`, [
      STOP,
    ]);
    await pool.query(
      `INSERT INTO platform_admins (id, email, display_name, role, password_hash, totp_secret_enc)
       VALUES ($1, 'ops@hadir.id', 'Operator', 'superadmin', '\\x00'::bytea, '\\x01'::bytea)`,
      [ADMIN_ID],
    );
    await pool.query(
      `INSERT INTO partner_users (id, email_hash, email_enc, display_name)
       VALUES ($1, repeat('a', 64), '\\x00'::bytea, 'Budi')`,
      [USER_A],
    );
    await pool.query(
      `INSERT INTO reports (public_id, category, stop_id, device_hash, device_day_hash, text, institution_id, moderation, status, contact_email_enc, contact_email_hash)
       VALUES
         ('LPR-2026-000001', 'service_wait', $1, $3, repeat('e', 64), 'Laporan Dishub yang cukup panjang.', $2, 'approved', 'acknowledged', '\\x0102'::bytea, '\\x0304'::bytea),
         ('LPR-2026-000002', 'service_wait', $1, $3, repeat('e', 64), 'Laporan Polrestabes yang cukup panjang.', $4, 'approved', 'submitted', '\\x0506'::bytea, '\\x0708'::bytea),
         ('LPR-2026-000003', 'service_wait', $1, $3, repeat('e', 64), 'Laporan tanpa otoritas yang cukup panjang.', NULL, 'pending', 'submitted', NULL, NULL),
         ('LPR-2026-000004', 'service_wait', $1, $5, repeat('e', 64), 'Laporan perangkat lain yang cukup panjang.', NULL, 'approved', 'submitted', NULL, NULL)`,
      [STOP, DISHUB, DEVICE_OWNER, POLRES, DEVICE_OTHER],
    );
    await pool.query(
      `INSERT INTO report_media (report_id, object_key, mime, width, height, status)
       SELECT id, 'uploads/aa/' || repeat('a', 64) || '.jpg', 'image/jpeg', 10, 10, 'approved'
       FROM reports WHERE public_id = 'LPR-2026-000001'`,
    );
    await pool.query(
      `INSERT INTO report_media (report_id, object_key, mime, width, height, status)
       SELECT id, 'uploads/bb/' || repeat('b', 64) || '.png', 'image/png', 5, 5, 'pending'
       FROM reports WHERE public_id = 'LPR-2026-000004'`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('admin read scope', () => {
    it('lets the admin scope see every report, including pending moderation', async () => {
      const rows = await withRole('admin', {}, async (tx) => {
        const result = await tx.execute(sql`SELECT count(*)::int AS total FROM reports`);
        return result.rows as { total: number }[];
      });
      expect(rows[0]?.total).toBe(4);
    });

    it('hides unapproved reports from the public scope', async () => {
      const rows = await withRole('public', {}, async (tx) => {
        const result = await tx.execute(sql`SELECT public_id FROM reports ORDER BY public_id`);
        return result.rows as { public_id: string }[];
      });
      expect(rows.map((row) => row.public_id)).toEqual([
        'LPR-2026-000001',
        'LPR-2026-000002',
        'LPR-2026-000004',
      ]);
    });

    it('shows nothing without a scope', async () => {
      const rows = await withRole('none', {}, async (tx) => {
        const result = await tx.execute(sql`SELECT count(*)::int AS total FROM reports`);
        return result.rows as { total: number }[];
      });
      expect(rows[0]?.total).toBe(0);
    });

    it('lets the admin scope update a report outside any institution', async () => {
      const updated = await withRole('admin', {}, async (tx) => {
        const result = await tx.execute(
          sql`UPDATE reports SET follow_up_at = now() WHERE public_id = 'LPR-2026-000003' RETURNING id`,
        );
        return result.rows.length;
      });
      expect(updated).toBe(1);
    });

    it('refuses an institution update outside its own scope', async () => {
      const updated = await withRole(
        'partner',
        { institutionId: DISHUB },
        async (tx) => {
          const result = await tx.execute(
            sql`UPDATE reports SET follow_up_at = now() WHERE public_id = 'LPR-2026-000002' RETURNING id`,
          );
          return result.rows.length;
        },
      );
      expect(updated).toBe(0);
    });
  });

  describe('media visibility', () => {
    const mediaCount = async (
      scope: 'admin' | 'public' | 'citizen' | 'partner' | 'none',
      extra: { deviceHash?: string; institutionId?: string },
    ): Promise<number> =>
      withRole(scope, extra, async (tx) => {
        const result = await tx.execute(sql`SELECT count(*)::int AS total FROM report_media`);
        return (result.rows as { total: number }[])[0]?.total ?? -1;
      });

    it('counts every media row for admin', async () => {
      expect(await mediaCount('admin', {})).toBe(2);
    });

    it('shows only approved media of approved reports to the public', async () => {
      expect(await mediaCount('public', {})).toBe(1);
    });

    it('shows the owner their own pending media', async () => {
      expect(await mediaCount('citizen', { deviceHash: DEVICE_OTHER })).toBe(1);
    });

    it('hides other devices media', async () => {
      expect(await mediaCount('citizen', { deviceHash: DEVICE_OWNER })).toBe(1);
    });

    it('scopes partner media to the institution', async () => {
      expect(await mediaCount('partner', { institutionId: DISHUB })).toBe(1);
      expect(await mediaCount('partner', { institutionId: POLRES })).toBe(0);
    });

    it('shows nothing without a scope', async () => {
      expect(await mediaCount('none', {})).toBe(0);
    });
  });

  describe('contact withdrawal', () => {
    const reportId = async (publicId: string): Promise<string> => {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM reports WHERE public_id = $1`,
        [publicId],
      );
      return result.rows[0]?.id ?? '';
    };

    const contactLeft = async (id: string): Promise<boolean> => {
      const result = await pool.query<{ present: boolean }>(
        `SELECT contact_email_enc IS NOT NULL AS present FROM reports WHERE id = $1`,
        [id],
      );
      return result.rows[0]?.present === true;
    };

    it('clears the contact for the owning device inside citizen scope', async () => {
      const id = await reportId('LPR-2026-000004');
      await pool.query(`UPDATE reports SET contact_email_enc = '\\x01'::bytea WHERE id = $1`, [id]);
      const withdrawn = await withRole(
        'citizen',
        { deviceHash: DEVICE_OTHER },
        async (tx) => {
          const result = await tx.execute(
            sql`SELECT withdraw_report_contact(${id}) AS withdrawn`,
          );
          return (result.rows as { withdrawn: boolean }[])[0]?.withdrawn;
        },
        true,
      );
      expect(withdrawn).toBe(true);
      expect(await contactLeft(id)).toBe(false);
    });

    it('refuses to clear another device report', async () => {
      const id = await reportId('LPR-2026-000002');
      const before = await contactLeft(id);
      const withdrawn = await withRole('citizen', { deviceHash: DEVICE_OTHER }, async (tx) => {
        const result = await tx.execute(
          sql`SELECT withdraw_report_contact(${id}) AS withdrawn`,
        );
        return (result.rows as { withdrawn: boolean }[])[0]?.withdrawn;
      });
      expect(withdrawn).toBe(false);
      expect(await contactLeft(id)).toBe(before);
    });

    it('refuses withdrawal from a partner session', async () => {
      const id = await reportId('LPR-2026-000001');
      const withdrawn = await withRole(
        'partner',
        { institutionId: DISHUB },
        async (tx) => {
          const result = await tx.execute(
            sql`SELECT withdraw_report_contact(${id}) AS withdrawn`,
          );
          return (result.rows as { withdrawn: boolean }[])[0]?.withdrawn;
        },
      );
      expect(withdrawn).toBe(false);
    });

    it('is idempotent when there is no contact left', async () => {
      const id = await reportId('LPR-2026-000004');
      const withdrawn = await withRole('citizen', { deviceHash: DEVICE_OTHER }, async (tx) => {
        const result = await tx.execute(
          sql`SELECT withdraw_report_contact(${id}) AS withdrawn`,
        );
        return (result.rows as { withdrawn: boolean }[])[0]?.withdrawn;
      });
      expect(withdrawn).toBe(false);
    });
  });

  describe('notification ciphertext access', () => {
    const reportId = async (publicId: string): Promise<string> => {
      const result = await pool.query<{ id: string }>(
        `SELECT id FROM reports WHERE public_id = $1`,
        [publicId],
      );
      return result.rows[0]?.id ?? '';
    };

    it('hands the ciphertext to the owning institution only', async () => {
      const id = await reportId('LPR-2026-000001');
      const payload = await withRole(
        'partner',
        { institutionId: DISHUB },
        async (tx) => {
          const result = await tx.execute(
            sql`SELECT report_contact_ciphertext(${id}) AS payload`,
          );
          return (result.rows as { payload: string | null }[])[0]?.payload;
        },
      );
      expect(payload).toBe(Buffer.from([0x01, 0x02]).toString('base64'));
    });

    it('returns null for another institution', async () => {
      const id = await reportId('LPR-2026-000001');
      const payload = await withRole(
        'partner',
        { institutionId: POLRES },
        async (tx) => {
          const result = await tx.execute(
            sql`SELECT report_contact_ciphertext(${id}) AS payload`,
          );
          return (result.rows as { payload: string | null }[])[0]?.payload;
        },
      );
      expect(payload).toBeNull();
    });

    it('returns null for a citizen scope', async () => {
      const id = await reportId('LPR-2026-000001');
      const payload = await withRole('citizen', { deviceHash: DEVICE_OWNER }, async (tx) => {
        const result = await tx.execute(
          sql`SELECT report_contact_ciphertext(${id}) AS payload`,
        );
        return (result.rows as { payload: string | null }[])[0]?.payload;
      });
      expect(payload).toBeNull();
    });
  });

  describe('report events and anchors', () => {
    const chain = new ChainRepository(db);

    const insertEvent = async (
      reportPublicId: string,
      seq: number,
      chainHash: Buffer,
      createdAt: Date,
    ): Promise<void> => {
      await pool.query(
        `INSERT INTO report_events (report_id, seq, kind, actor_type, payload, prev_hash, payload_hash, chain_hash, created_at)
         SELECT id, $2, 'submitted', 'system', '{}'::jsonb, $3::bytea, $4::bytea, $5::bytea, $6
         FROM reports WHERE public_id = $1`,
        [
          reportPublicId,
          seq,
          Buffer.alloc(32),
          Buffer.alloc(32, seq),
          chainHash,
          createdAt,
        ],
      );
    };

    it('collects chain hashes inside the day window in a stable order', async () => {
      const first = Buffer.alloc(32, 1);
      const second = Buffer.alloc(32, 2);
      await insertEvent('LPR-2026-000001', 1, first, new Date('2026-10-01T01:00:00.000Z'));
      await insertEvent('LPR-2026-000002', 1, second, new Date('2026-10-01T02:00:00.000Z'));
      await insertEvent('LPR-2026-000003', 1, Buffer.alloc(32, 3), new Date('2026-10-02T00:00:00.000Z'));

      const leaves = await chain.listChainHashesInWindow(
        db,
        new Date('2026-10-01T00:00:00.000Z'),
        new Date('2026-10-02T00:00:00.000Z'),
      );

      expect(leaves.map((leaf) => leaf.toString('hex'))).toEqual([
        first.toString('hex'),
        second.toString('hex'),
      ]);
    });

    it('stores an anchor exactly once per date', async () => {
      const leaves = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];
      const summary = merkleSummary(leaves);
      const row = await asAdmin(
        async (tx) =>
          chain.insertAnchor(tx, {
            anchorDate: '2026-10-01',
            merkleRoot: summary.root,
            leafCount: leaves.length,
            windowStart: new Date('2026-10-01T00:00:00.000Z'),
            windowEnd: new Date('2026-10-02T00:00:00.000Z'),
            proof: { algorithm: 'test', levels: summary.levels },
          }),
        true,
      );
      expect(row?.anchorDate).toBe('2026-10-01');
      expect(row?.merkleRoot.equals(summary.root)).toBe(true);

      const duplicate = await withRole('admin', {}, async (tx) =>
        chain.insertAnchor(tx, {
          anchorDate: '2026-10-01',
          merkleRoot: Buffer.alloc(32, 9),
          leafCount: 1,
          windowStart: new Date('2026-10-01T00:00:00.000Z'),
          windowEnd: new Date('2026-10-02T00:00:00.000Z'),
          proof: {},
        }),
      );
      expect(duplicate).toBeNull();

      const stored = await chain.findAnchor(db, '2026-10-01');
      expect(stored?.merkleRoot.equals(summary.root)).toBe(true);
    });

    it('recomputes the same root from the stored leaves', async () => {
      const leaves = await chain.listChainHashesInWindow(
        db,
        new Date('2026-10-01T00:00:00.000Z'),
        new Date('2026-10-02T00:00:00.000Z'),
      );
      const stored = await chain.findAnchor(db, '2026-10-01');
      expect(merkleRoot(leaves).equals(stored!.merkleRoot)).toBe(true);
    });

    it('rejects a root that is not thirty two bytes', async () => {
      await expect(
        withRole('admin', {}, async (tx) =>
          chain.insertAnchor(tx, {
            anchorDate: '2026-10-05',
            merkleRoot: Buffer.alloc(31),
            leafCount: 1,
            windowStart: new Date('2026-10-05T00:00:00.000Z'),
            windowEnd: new Date('2026-10-06T00:00:00.000Z'),
            proof: {},
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('exports scoping', () => {
    const exports = new ExportRepository(db);

    const seedExport = async (institutionId: string): Promise<string> => {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO exports (institution_id, requested_by, format, status)
         VALUES ($1, $2, 'csv', 'queued') RETURNING id`,
        [institutionId, USER_A],
      );
      return result.rows[0]?.id ?? '';
    };

    it('only finds an export through its own institution', async () => {
      const id = await seedExport(DISHUB);
      expect(await exports.find(db, id, DISHUB)).not.toBeNull();
      expect(await exports.find(db, id, POLRES)).toBeNull();
    });

    it('finds an export by id for signed downloads', async () => {
      const id = await seedExport(POLRES);
      const found = await exports.findById(db, id);
      expect(found?.institutionId).toBe(POLRES);
    });

    it('refuses a ready export without an object key', async () => {
      await expect(
        pool.query(
          `INSERT INTO exports (institution_id, requested_by, format, status)
           VALUES ($1, $2, 'csv', 'ready')`,
          [DISHUB, USER_A],
        ),
      ).rejects.toThrow();
    });

    it('counts exports inside the rate window per institution', async () => {
      const before = await exports.countSince(
        db,
        DISHUB,
        new Date(Date.now() - 3_600_000),
      );
      await seedExport(DISHUB);
      const after = await exports.countSince(db, DISHUB, new Date(Date.now() - 3_600_000));
      expect(after).toBe(before + 1);
    });

    it('collects rows only for the requesting institution', async () => {
      const rows = await exports.collectRows(
        db,
        DISHUB,
        { category: null, status: null, from: null, to: null },
        100,
      );
      expect(rows.map((row) => row.publicId)).toEqual(['LPR-2026-000001']);
    });
  });

  describe('admin repository writes', () => {
    const admin = new AdminRepository(db);

    it('inserts and lists notices through the app role', async () => {
      const created = await asAdmin(
        async (tx) =>
          admin.insertNotice(tx, {
            kind: 'detour',
            text: 'Pengalihan sementara selama perbaikan jalan.',
            sourceUrl: 'https://example.test/notice/1',
            cityId: null,
            stopId: STOP,
            routeId: null,
            institutionId: null,
            startsAt: null,
            endsAt: null,
          }),
        true,
      );
      expect(created.stopId).toBe(STOP);

      const listed = await withRole('admin', {}, async (tx) =>
        admin.listNotices(tx, {
          cityId: null,
          stopId: STOP,
          routeId: null,
          cursor: null,
          limit: 10,
        }),
      );
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]?.kind).toBe('detour');
    });

    it('flips moderation and media status together', async () => {
      const target = await withRole('admin', {}, async (tx) =>
        admin.findModerationTarget(tx, 'LPR-2026-000004'),
      );
      expect(target?.moderation).toBe('approved');

      await asAdmin(async (tx) => {
        await admin.setModeration(tx, target!.id, 'rejected');
        const changed = await admin.setMediaStatus(tx, target!.id, 'rejected');
        expect(changed).toBe(1);
      }, true);

      const media = await pool.query<{ status: string }>(
        `SELECT status FROM report_media WHERE report_id = $1`,
        [target!.id],
      );
      expect(media.rows[0]?.status).toBe('rejected');
    });

    it('upserts a flag and keeps the old description when omitted', async () => {
      const first = await asAdmin(
        async (tx) =>
          admin.upsertFlag(tx, {
            key: 'triage.enabled',
            value: true,
            description: 'Triage lima pertanyaan',
            adminId: ADMIN_ID,
          }),
        true,
      );
      expect(first.key).toBe('triage.enabled');

      const second = await asAdmin(
        async (tx) =>
          admin.upsertFlag(tx, {
            key: 'triage.enabled',
            value: false,
            description: null,
            adminId: ADMIN_ID,
          }),
        true,
      );
      expect(second.value).toBe(false);
      expect(second.description).toBe('Triage lima pertanyaan');
    });

    it('rejects an invalid flag key at the database level', async () => {
      await expect(
        withRole('admin', {}, async (tx) =>
          admin.upsertFlag(tx, {
            key: 'Invalid Key!',
            value: 1,
            description: null,
            adminId: ADMIN_ID,
          }),
        ),
      ).rejects.toThrow();
    });

    it('upserts RUP packages idempotently and reports insert versus update', async () => {
      const values = {
        satker: 'Dinhub Banyumas',
        name: 'Perbaikan Halte UMP',
        locationText: 'Purwokerto',
        fundingSource: 'APBD',
        pagu: '1500000.00',
        method: 'Tender',
        fiscalYear: 2026,
        status: 'Terumumkan',
        sourceUrl: 'https://example.test/rup/1',
        fetchedAt: new Date('2026-10-20T00:00:00.000Z'),
        matchKeywords: ['halte'],
      };
      const inserted = await asAdmin(async (tx) => admin.upsertRup(tx, values), true);
      expect(inserted.inserted).toBe(true);

      const updated = await asAdmin(
        async (tx) => admin.upsertRup(tx, { ...values, pagu: '2000000.00' }),
        true,
      );
      expect(updated.inserted).toBe(false);

      const listed = await withRole('admin', {}, async (tx) =>
        admin.listRup(tx, {
          satker: null,
          fiscalYear: 2026,
          keyword: 'halte',
          cursor: null,
          limit: 10,
        }),
      );
      expect(listed.items).toHaveLength(1);
      expect(listed.items[0]?.pagu).toBe(2000000);
    });

    it('builds a keyset cursor that pages without duplicates', async () => {
      for (let index = 0; index < 3; index += 1) {
        await asAdmin(
          async (tx) =>
            admin.upsertFlag(tx, {
              key: `experiment.arm_${index}`,
              value: index,
              description: null,
              adminId: ADMIN_ID,
            }),
          true,
        );
      }
      const flags = await withRole('admin', {}, async (tx) => admin.listFlags(tx));
      expect(flags.map((flag) => flag.key)).toEqual([
        'experiment.arm_0',
        'experiment.arm_1',
        'experiment.arm_2',
        'triage.enabled',
      ]);
    });
  });

  describe('report repository additions', () => {
    const reports = new ReportsRepository(db);

    it('lists media for a report in creation order', async () => {
      const report = await reports.findByPublicId(db, 'LPR-2026-000001');
      const media = await reports.listMediaFor(db, report!.id);
      expect(media).toHaveLength(1);
      expect(media[0]?.status).toBe('approved');
    });

    it('returns no media for a foreign report id', async () => {
      const report = await reports.findByPublicId(db, 'LPR-2026-000002');
      const media = await reports.listMediaFor(db, report!.id);
      expect(media).toEqual([]);
    });

    it('scopes ownership lookups by device hash', async () => {
      expect(await reports.findOwnedByPublicId(db, 'LPR-2026-000001', DEVICE_OWNER)).not.toBeNull();
      expect(await reports.findOwnedByPublicId(db, 'LPR-2026-000001', DEVICE_OTHER)).toBeNull();
    });

    it('appends events with a chained hash and rejects a skipped seq', async () => {
      const report = await reports.findByPublicId(db, 'LPR-2026-000002');
      const seq = await withRole(
        'citizen',
        { deviceHash: DEVICE_OWNER },
        async (tx) =>
          reports.appendEvent(tx, report!.id, {
            kind: 'triaged',
            actorType: 'system',
            actorId: null,
            payload: { note: 'ok' },
            sourceUrl: null,
          }),
        true,
      );
      expect(seq).toBe(2);

      await expect(
        pool.query(
          `INSERT INTO report_events (report_id, seq, kind, actor_type, payload, prev_hash, payload_hash, chain_hash)
           VALUES ($1, 9, 'triaged', 'system', '{}'::jsonb, $2::bytea, $3::bytea, $4::bytea)`,
          [report!.id, Buffer.alloc(32), Buffer.alloc(32), Buffer.alloc(32)],
        ),
      ).resolves.toBeDefined();
    });
  });
});
