import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';

const BOUNDARY_URL = process.env.HADIR_BOUNDARY_DATABASE_URL;
const IF_PRESENT = BOUNDARY_URL === undefined ? describe.skip : describe;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(HERE, 'fixtures/partner-app.sql');
const RLS = resolve(HERE, '../src/db/migrations/0017_read_scopes.sql');

const SECRET = process.env.SESSION_SECRET ?? 'test-only-secret-0000000000000000000000000';
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface RouteCase {
  method: Method;
  path: string;
  auth: 'public' | 'device' | 'partner' | 'admin' | 'internal' | 'none';
  note: string;
}

const ACCOUNT_DEPENDENT: readonly RouteCase[] = [
  { method: 'post', path: '/v1/devices', auth: 'none', note: 'bootstrap perangkat' },
  { method: 'post', path: '/v1/episodes', auth: 'device', note: 'mulai episode' },
  { method: 'patch', path: '/v1/episodes/0192f0c4-0000-7000-8000-000000000001', auth: 'device', note: 'ubah episode' },
  { method: 'post', path: '/v1/episodes/0192f0c4-0000-7000-8000-000000000001/heartbeat', auth: 'device', note: 'heartbeat' },
  { method: 'post', path: '/v1/triage', auth: 'device', note: 'triage' },
  { method: 'get', path: '/v1/triage/0192f0c4-0000-7000-8000-000000000001', auth: 'device', note: 'baca triage' },
  { method: 'post', path: '/v1/reports', auth: 'device', note: 'buat laporan' },
  { method: 'get', path: '/v1/reports/mine', auth: 'device', note: 'laporan saya' },
  { method: 'post', path: '/v1/uploads', auth: 'device', note: 'tiket unggah' },
  {
    method: 'post',
    path: '/v1/reports/LPR-2026-000001/appeals',
    auth: 'device',
    note: 'ajukan banding',
  },
  {
    method: 'get',
    path: '/v1/reports/LPR-2026-000001/appeals',
    auth: 'device',
    note: 'banding laporan',
  },
  { method: 'get', path: '/v1/appeals/mine', auth: 'device', note: 'banding saya' },
  { method: 'put', path: '/v1/uploads/0192f0c4-0000-7000-8000-000000000001', auth: 'device', note: 'kirim berkas' },
  { method: 'post', path: '/v1/partner/sessions', auth: 'none', note: 'login mitra' },
  { method: 'post', path: '/v1/partner/otp', auth: 'none', note: 'minta OTP' },
  { method: 'post', path: '/v1/partner/password', auth: 'none', note: 'setel kata sandi' },
  { method: 'post', path: '/v1/admin/sessions', auth: 'none', note: 'login admin' },
  { method: 'post', path: '/v1/admin/commitments', auth: 'admin', note: 'buat janji layanan' },
  {
    method: 'post',
    path: '/v1/admin/commitments/0192f0c4-0000-7000-8000-000000000001/verify',
    auth: 'admin',
    note: 'verifikasi janji',
  },
  {
    method: 'post',
    path: '/v1/admin/commitments/0192f0c4-0000-7000-8000-000000000001/revoke',
    auth: 'admin',
    note: 'cabut janji',
  },
  { method: 'post', path: '/v1/admin/incidents', auth: 'admin', note: 'buat insiden' },
  { method: 'get', path: '/v1/admin/sla/breaches', auth: 'admin', note: 'pelanggaran SLA' },
  {
    method: 'post',
    path: '/v1/admin/reports/LPR-2026-000001/resolution',
    auth: 'admin',
    note: 'verifikasi penyelesaian',
  },
  {
    method: 'get',
    path: '/v1/admin/reports/LPR-2026-000001/panel',
    auth: 'admin',
    note: 'panel laporan',
  },
  {
    method: 'get',
    path: '/v1/admin/reports/LPR-2026-000001/panel/candidates',
    auth: 'admin',
    note: 'kandidat panel',
  },
  {
    method: 'post',
    path: '/v1/admin/reports/LPR-2026-000001/panel',
    auth: 'admin',
    note: 'tambah panel',
  },
  {
    method: 'delete',
    path: '/v1/admin/reports/LPR-2026-000001/panel/0192f0c4-0000-7000-8000-0000000000a2',
    auth: 'admin',
    note: 'cabut panel',
  },
  { method: 'get', path: '/v1/admin/appeals', auth: 'admin', note: 'antrean banding' },
  {
    method: 'post',
    path: '/v1/admin/appeals/0192f0c4-0000-7000-8000-000000000001/decision',
    auth: 'admin',
    note: 'putus banding',
  },
  {
    method: 'get',
    path: '/v1/admin/cities/0192f0c4-0000-7000-8000-0000000000c0/sla',
    auth: 'admin',
    note: 'SLA kota',
  },
  {
    method: 'put',
    path: '/v1/admin/cities/0192f0c4-0000-7000-8000-0000000000c0/sla',
    auth: 'admin',
    note: 'setel SLA kota',
  },
];

const AUTHENTICATED: readonly RouteCase[] = [
  { method: 'get', path: '/v1/partner/me', auth: 'partner', note: 'profil mitra' },
  { method: 'get', path: '/v1/partner/reports', auth: 'partner', note: 'inbox mitra' },
  { method: 'get', path: '/v1/partner/reports/LPR-2026-000001', auth: 'partner', note: 'detail mitra' },
  { method: 'post', path: '/v1/partner/reports/LPR-2026-000001/action', auth: 'partner', note: 'aksi mitra' },
  { method: 'get', path: '/v1/partner/exports', auth: 'partner', note: 'daftar export' },
  { method: 'post', path: '/v1/partner/exports', auth: 'partner', note: 'minta export' },
  { method: 'get', path: '/v1/partner/analytics', auth: 'partner', note: 'analitik mitra' },
  { method: 'get', path: '/v1/partner/passkeys', auth: 'partner', note: 'daftar passkey' },
  {
    method: 'get',
    path: '/v1/partner/reports/LPR-2026-000001/accountability',
    auth: 'partner',
    note: 'berkas kasus mitra',
  },
  {
    method: 'post',
    path: '/v1/partner/reports/LPR-2026-000001/responses',
    auth: 'partner',
    note: 'terbitkan tanggapan instansi',
  },
  { method: 'get', path: '/v1/partner/members', auth: 'partner', note: 'daftar anggota' },
  {
    method: 'get',
    path: '/v1/partner/members/invites',
    auth: 'partner',
    note: 'daftar undangan',
  },
  {
    method: 'post',
    path: '/v1/partner/members/invites',
    auth: 'partner',
    note: 'buat undangan',
  },
  {
    method: 'delete',
    path: '/v1/partner/members/invites/0192f0c4-0000-7000-8000-000000000001',
    auth: 'partner',
    note: 'cabut undangan',
  },
  {
    method: 'patch',
    path: '/v1/partner/members/0192f0c4-0000-7000-8000-000000000001',
    auth: 'partner',
    note: 'ubah peran anggota',
  },
  {
    method: 'delete',
    path: '/v1/partner/members/0192f0c4-0000-7000-8000-000000000001',
    auth: 'partner',
    note: 'cabut anggota',
  },
  { method: 'get', path: '/v1/partner/panel/reports', auth: 'partner', note: 'panel saya' },
  {
    method: 'get',
    path: '/v1/partner/panel/reports/LPR-2026-000001',
    auth: 'partner',
    note: 'detail panel',
  },
  {
    method: 'post',
    path: '/v1/partner/panel/reports/LPR-2026-000001/verdict',
    auth: 'partner',
    note: 'vonis panel',
  },
  { method: 'get', path: '/v1/admin/me', auth: 'admin', note: 'profil admin' },
  { method: 'get', path: '/v1/admin/audit', auth: 'admin', note: 'audit log' },
  { method: 'get', path: '/v1/admin/notices', auth: 'admin', note: 'daftar pengumuman' },
  { method: 'get', path: '/v1/admin/rup', auth: 'admin', note: 'daftar RUP' },
  { method: 'get', path: '/v1/admin/flags', auth: 'admin', note: 'daftar flag' },
  { method: 'get', path: '/v1/admin/retention', auth: 'admin', note: 'kebijakan retensi' },
  { method: 'get', path: '/v1/admin/retention/runs', auth: 'admin', note: 'riwayat retensi' },
];

const PUBLIC: readonly RouteCase[] = [
  { method: 'get', path: '/v1/stops', auth: 'public', note: 'daftar halte' },
  { method: 'get', path: '/v1/stops/by-code/BMS-A12', auth: 'public', note: 'halte lewat kode' },
  { method: 'get', path: '/v1/coverage', auth: 'public', note: 'cakupan' },
  { method: 'get', path: '/v1/meta', auth: 'public', note: 'metadata' },
  { method: 'get', path: '/v1/reports', auth: 'public', note: 'papan bukti' },
  { method: 'get', path: '/v1/transparency/keys', auth: 'public', note: 'kunci anchor' },
  { method: 'get', path: '/v1/transparency/anchors', auth: 'public', note: 'timeline anchor' },
  { method: 'get', path: '/v1/transparency/anchor/2026-10-01', auth: 'public', note: 'anchor harian' },
  { method: 'get', path: '/v1/transparency/proof/LPR-2026-000001', auth: 'public', note: 'bukti inklusi' },
  {
    method: 'get',
    path: '/v1/reports/LPR-2026-000001/case',
    auth: 'public',
    note: 'berkas kasus publik',
  },
  {
    method: 'get',
    path: '/v1/reports/LPR-2026-000001/panel',
    auth: 'public',
    note: 'panel publik',
  },
  { method: 'get', path: '/v1/institutions', auth: 'public', note: 'daftar instansi' },
  {
    method: 'get',
    path: '/v1/institutions/0192f0c4-0000-7000-8000-0000000000a1/scorecard',
    auth: 'public',
    note: 'scorecard instansi',
  },
  { method: 'get', path: '/v1/commitments', auth: 'public', note: 'janji layanan' },
  { method: 'get', path: '/v1/commitments/history', auth: 'public', note: 'riwayat janji' },
  { method: 'get', path: '/v1/context', auth: 'public', note: 'konteks operasional' },
  {
    method: 'get',
    path: '/v1/stops/0192f0c4-0000-7000-8000-0000000000c1/evidence',
    auth: 'public',
    note: 'paket bukti halte',
  },
];

const INTERNAL: readonly RouteCase[] = [
  { method: 'get', path: '/internal/healthz', auth: 'internal', note: 'health internal' },
  { method: 'post', path: '/internal/estimate', auth: 'internal', note: 'estimasi internal' },
  { method: 'get', path: '/internal/metrics', auth: 'internal', note: 'metrik' },
];

const EVERYTHING: readonly RouteCase[] = [
  ...ACCOUNT_DEPENDENT,
  ...AUTHENTICATED,
  ...PUBLIC,
  ...INTERNAL,
];

function csrfFromHeaders(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  for (const cookie of cookies) {
    if (typeof cookie !== 'string') {
      continue;
    }
    const match = /(?:^|,\s*)hadir_csrf=([^;]+)/.exec(cookie);
    if (match?.[1] !== undefined) {
      return decodeURIComponent(match[1]);
    }
  }
  return '';
}

function withCsrf(token: string): Record<string, string> {
  return { Origin: WEB_ORIGIN, 'X-CSRF-Token': token };
}

function send(
  app: NestExpressApplication,
  route: RouteCase,
): request.Test {
  const agent = request(app.getHttpServer());
  const base =
    route.method === 'get'
      ? agent.get(route.path)
      : route.method === 'post'
        ? agent.post(route.path)
        : route.method === 'patch'
          ? agent.patch(route.path)
          : route.method === 'put'
            ? agent.put(route.path)
            : agent.delete(route.path);
  return base.set('Origin', WEB_ORIGIN);
}

IF_PRESENT('authorization matrix', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let csrf: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = BOUNDARY_URL;
    process.env.SESSION_SECRET = SECRET;
    process.env.WEB_ORIGIN = WEB_ORIGIN;
    process.env.DEV_TOOLS = 'false';
    process.env.INTERNAL_SHARED_SECRET = 'internal-matrix-secret-000000000000';

    pool = new Pool({ connectionString: BOUNDARY_URL, max: 4 });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query(await readFile(FIXTURE, 'utf8'));
    await pool.query('GRANT USAGE ON SCHEMA public TO hadir_app');
    await pool.query(await readFile(RLS, 'utf8'));

    const { AppModule } = await import('../src/app.module');
    const { Test } = await import('@nestjs/testing');
    const { default: cookieParser } = await import('cookie-parser');
    const { deviceMiddleware } = await import('../src/common/http/device.middleware');
    const { ProblemDetailsFilter } = await import('../src/common/http/problem-details.filter');
    const { requestIdMiddleware } = await import('../src/common/http/request-id.middleware');
    const { csrfMiddleware } = await import('../src/common/security/csrf');
    const { RATE_LIMIT_STORE } = await import('../src/common/http/rate-limit.store');

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue({
        consume: async () => ({ allowed: true, remaining: 1_000, resetMs: 60_000 }),
      })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz', 'internal/healthz', 'internal/estimate', 'internal/metrics'] });
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.use(deviceMiddleware);
    app.use(csrfMiddleware);
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();

    const boot = await request(app.getHttpServer())
      .post('/v1/devices')
      .set('Origin', WEB_ORIGIN)
      .expect(204);
    csrf = csrfFromHeaders(boot.headers as Record<string, unknown>);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  describe('routes that must never answer 404 because of path shape', () => {
    it('registers every documented route', async () => {
      const unrouted: string[] = [];
      for (const route of EVERYTHING) {
        const response = await send(app, route).set(withCsrf(csrf));
        const body = JSON.stringify(response.body ?? {});
        if (response.status === 404 && body.includes('Cannot ')) {
          unrouted.push(`${route.method.toUpperCase()} ${route.path}`);
        }
      }
      expect(unrouted).toEqual([]);
    });

    it('answers data-dependent 404s with a problem body, not a routing fallthrough', async () => {
      const response = await send(app, {
        method: 'get',
        path: '/v1/transparency/proof/LPR-2026-000001',
        auth: 'public',
        note: 'laporan tidak ada',
      });
      expect(response.status).toBe(404);
      expect((response.body as Record<string, unknown>).code).toBe('NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain('Cannot ');
    });

    it('rejects the doubled prefix explicitly', async () => {
      for (const route of AUTHENTICATED) {
        const broken = { ...route, path: route.path.replace('/v1/', '/v1/v1/') };
        const response = await send(app, broken).set(withCsrf(csrf));
        expect(response.status).toBe(404);
      }
    });
  });

  describe('unauthenticated access', () => {
    it('refuses every partner route without a session', async () => {
      for (const route of AUTHENTICATED.filter((entry) => entry.auth === 'partner')) {
        const response = await send(app, route).set(withCsrf(csrf));
        expect([401, 403]).toContain(response.status);
      }
    });

    it('refuses every admin route without a session', async () => {
      for (const route of AUTHENTICATED.filter((entry) => entry.auth === 'admin')) {
        const response = await send(app, route).set(withCsrf(csrf));
        expect([401, 403]).toContain(response.status);
      }
    });

    it('refuses every internal route without credentials', async () => {
      for (const route of INTERNAL) {
        const response = await send(app, route);
        expect([401, 403, 404, 503]).toContain(response.status);
      }
    });

    it('never leaks a partner payload unauthenticated', async () => {
      for (const route of AUTHENTICATED) {
        const response = await send(app, route).set(withCsrf(csrf));
        const body = JSON.stringify(response.body ?? {});
        expect(body).not.toContain('"data"');
      }
    });
  });

  describe('public surface', () => {
    it('serves public reads without a session', async () => {
      for (const route of PUBLIC) {
        const response = await send(app, route);
        expect(response.status).not.toBe(401);
        expect(response.status).not.toBe(403);
      }
    });

    it('never requires CSRF for a GET', async () => {
      for (const route of PUBLIC) {
        const response = await send(app, route);
        expect(response.status).not.toBe(403);
      }
    });
  });

  describe('CSRF enforcement', () => {
    const mutating = EVERYTHING.filter(
      (route) =>
        route.method !== 'get' &&
        route.auth !== 'internal' &&
        route.path !== '/v1/devices',
    );

    it('rejects a mutation that carries no CSRF token', async () => {
      for (const route of mutating) {
        const response = await send(app, route);
        expect([401, 403]).toContain(response.status);
      }
    });

    it('rejects a mutation from an unexpected origin', async () => {
      for (const route of mutating) {
        const response = await send(app, route)
          .set('Origin', 'https://evil.example')
          .set('X-CSRF-Token', csrf);
        expect([401, 403]).toContain(response.status);
      }
    });
  });

  describe('device boundary', () => {
    it('refuses citizen writes without a bootstrap device cookie', async () => {
      const fresh = request.agent(app.getHttpServer());
      const boot = await fresh.post('/v1/devices').set('Origin', WEB_ORIGIN);
      expect(boot.status).toBe(204);
      const freshCsrf = csrfFromHeaders(boot.headers as Record<string, unknown>);

      for (const route of ACCOUNT_DEPENDENT.filter((entry) => entry.auth === 'device')) {
        const agent = request(app.getHttpServer());
        const base =
          route.method === 'post'
            ? agent.post(route.path)
            : route.method === 'patch'
              ? agent.patch(route.path)
              : agent.put(route.path);
        const response = await base.set(withCsrf(freshCsrf));
        expect([401, 403, 404]).toContain(response.status);
      }
    });
  });

  describe('error envelope shape', () => {
    it('always returns a problem details body with a request id', async () => {
      for (const route of AUTHENTICATED) {
        const response = await send(app, route).set(withCsrf(csrf));
        const body = response.body as Record<string, unknown>;
        expect(typeof body.code).toBe('string');
        expect(typeof body.status).toBe('number');
        expect(typeof body.requestId).toBe('string');
        expect(String(body.instance)).toContain('/v1/');
      }
    });

    it('never echoes a stack trace', async () => {
      for (const route of EVERYTHING) {
        const response = await send(app, route).set(withCsrf(csrf));
        expect(JSON.stringify(response.body ?? {})).not.toContain('at Object');
      }
    });
  });

  describe('matrix hygiene', () => {
    it('documents at least forty distinct routes', () => {
      const keys = new Set(EVERYTHING.map((route) => `${route.method}:${route.path}`));
      expect(keys.size).toBe(EVERYTHING.length);
      expect(EVERYTHING.length).toBeGreaterThanOrEqual(40);
    });

    it('has a note for every route', () => {
      for (const route of EVERYTHING) {
        expect(route.note.length).toBeGreaterThan(3);
      }
    });
  });
});
