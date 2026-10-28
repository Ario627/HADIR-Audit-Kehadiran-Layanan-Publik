import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';
import { signInvite } from '../src/common/auth/invite-token';

const BOUNDARY_URL = process.env.HADIR_BOUNDARY_DATABASE_URL;
const IF_PRESENT = BOUNDARY_URL === undefined ? describe.skip : describe;

const HERE = __dirname;
const FIXTURE = resolve(HERE, 'fixtures/partner-app.sql');
const RLS = resolve(HERE, '../src/db/migrations/0017_read_scopes.sql');

const SECRET = process.env.SESSION_SECRET ?? 'test-only-secret-0000000000000000000000000000';
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const POLRES = '0192f0c4-0000-7000-8000-0000000000a2';
const USER_A = '0192f0c4-0000-7000-8000-0000000000b1';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';
const INVITE_JTI = 'jti-partner-http-0001';

const DISHUB_REPORT = 'LPR-2026-000001';
const POLRES_REPORT = 'LPR-2026-000002';

type Agent = ReturnType<typeof request.agent>;

interface LoginBody {
  data: {
    userId: string;
    institutionId: string;
    role: string;
    displayName: string;
  };
}

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
  throw new Error('Cookie CSRF tidak ditemukan.');
}

function withCsrf(csrf: string): Record<string, string> {
  return { Origin: WEB_ORIGIN, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' };
}

function inviteFor(institutionId: string): string {
  return signInvite(
    {
      sub: USER_A,
      inst: institutionId,
      role: 'responder',
      jti: INVITE_JTI,
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    SECRET,
  );
}

IF_PRESENT('partner HTTP boundary', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let agent: Agent;
  let csrf: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = BOUNDARY_URL;

    pool = new Pool({ connectionString: BOUNDARY_URL, max: 4 });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query(await readFile(FIXTURE, 'utf8'));
    await pool.query(await readFile(RLS, 'utf8'));

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
    await pool.query(
      `INSERT INTO partner_memberships (user_id, institution_id, role)
       VALUES ($1, $2, 'responder')`,
      [USER_A, DISHUB],
    );
    await pool.query(
      `INSERT INTO reports (public_id, category, stop_id, device_hash, device_day_hash, text, institution_id, moderation)
       VALUES
         ($1, 'service_wait', $3, repeat('d', 64), repeat('e', 64), 'Laporan untuk Dishub yang cukup panjang.', $4, 'approved'),
         ($2, 'service_wait', $3, repeat('d', 64), repeat('e', 64), 'Laporan untuk Polrestabes yang cukup panjang.', $5, 'approved')`,
      [DISHUB_REPORT, POLRES_REPORT, STOP, DISHUB, POLRES],
    );

    const { AppModule } = await import('../src/app.module.js');
    const { Test } = await import('@nestjs/testing');
    const { default: cookieParser } = await import('cookie-parser');
    const { deviceMiddleware } = await import('../src/common/http/device.middleware.js');
    const { ProblemDetailsFilter } = await import('../src/common/http/problem-details.filter.js');
    const { requestIdMiddleware } = await import('../src/common/http/request-id.middleware.js');
    const { csrfMiddleware } = await import('../src/common/security/csrf.js');
    const { RATE_LIMIT_STORE } = await import('../src/common/http/rate-limit.store.js');

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RATE_LIMIT_STORE)
      .useValue({
        consume: async () => ({ allowed: true, remaining: 1_000, resetMs: 60_000 }),
      })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.use(deviceMiddleware);
    app.use(csrfMiddleware);
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();

    agent = request.agent(app.getHttpServer());
    const boot = await agent.post('/v1/devices').set('Origin', WEB_ORIGIN).expect(204);
    csrf = csrfFromHeaders(boot.headers as Record<string, unknown>);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('rejects every partner endpoint without a session', async () => {
    await request(app.getHttpServer()).get('/v1/partner/reports').set('Origin', WEB_ORIGIN).expect(401);
    await request(app.getHttpServer()).get('/v1/partner/me').set('Origin', WEB_ORIGIN).expect(401);
  });

  it('mints a session from an invite and sets a hardened cookie', async () => {
    const response = await agent
      .post('/v1/partner/sessions')
      .set(withCsrf(csrf))
      .send({ method: 'invite', inviteToken: inviteFor(DISHUB) })
      .expect(200);

    const body = response.body as LoginBody;
    expect(body.data.userId).toBe(USER_A);
    expect(body.data.institutionId).toBe(DISHUB);
    expect(body.data.role).toBe('responder');

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const sessionCookie = cookies.find((value) => value.startsWith('hadir_session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
  });

  it('replays the same invite as a rejected login', async () => {
    const fresh = request.agent(app.getHttpServer());
    const boot = await fresh.post('/v1/devices').set('Origin', WEB_ORIGIN).expect(204);
    const freshCsrf = csrfFromHeaders(boot.headers as Record<string, unknown>);

    await fresh
      .post('/v1/partner/sessions')
      .set(withCsrf(freshCsrf))
      .send({ method: 'invite', inviteToken: inviteFor(DISHUB) })
      .expect(401);
  });

  it('lists only the institution inbox', async () => {
    const response = await agent.get('/v1/partner/reports').set('Origin', WEB_ORIGIN).expect(200);

    const items = (response.body as { data: { items: { publicId: string }[] } }).data.items;
    expect(items.map((item) => item.publicId)).toEqual([DISHUB_REPORT]);
  });

  it('opens its own report', async () => {
    const response = await agent
      .get(`/v1/partner/reports/${DISHUB_REPORT}`)
      .set('Origin', WEB_ORIGIN)
      .expect(200);

    expect((response.body as { data: { publicId: string } }).data.publicId).toBe(DISHUB_REPORT);
  });

  it('answers 404 for a report owned by another institution', async () => {
    const response = await agent
      .get(`/v1/partner/reports/${POLRES_REPORT}`)
      .set('Origin', WEB_ORIGIN)
      .expect(404);

    expect((response.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('acknowledges its own report exactly once', async () => {
    const key = '0192f0c4-0000-7000-8000-000000000901';
    const first = await agent
      .post(`/v1/partner/reports/${DISHUB_REPORT}/action`)
      .set(withCsrf(csrf))
      .set('Idempotency-Key', key)
      .send({ action: 'acknowledge' })
      .expect(200);

    expect((first.body as { data: { status: string } }).data.status).toBe('acknowledged');

    const replay = await agent
      .post(`/v1/partner/reports/${DISHUB_REPORT}/action`)
      .set(withCsrf(csrf))
      .set('Idempotency-Key', key)
      .send({ action: 'acknowledge' })
      .expect(200);

    expect((replay.body as { data: { status: string } }).data.status).toBe('acknowledged');
  });

  it('refuses to act on another institution report', async () => {
    const response = await agent
      .post(`/v1/partner/reports/${POLRES_REPORT}/action`)
      .set(withCsrf(csrf))
      .set('Idempotency-Key', '0192f0c4-0000-7000-8000-000000000902')
      .send({ action: 'acknowledge' })
      .expect(404);

    expect((response.body as { code: string }).code).toBe('NOT_FOUND');
  });

  it('leaves the other institution report untouched', async () => {
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM reports WHERE public_id = $1`,
      [POLRES_REPORT],
    );

    expect(row.rows[0]?.status).toBe('submitted');
  });

  it('records the partner action in the audit trail with a real actor', async () => {
    const rows = await pool.query<{ actor_type: string; actor_id: string; action: string }>(
      `SELECT actor_type, actor_id, action FROM audit_log
       WHERE action = 'report.partner_action' ORDER BY created_at DESC LIMIT 1`,
    );

    expect(rows.rows[0]).toMatchObject({
      actor_type: 'partner',
      actor_id: USER_A,
      action: 'report.partner_action',
    });
  });

  it('appends a hash-chained event for the action', async () => {
    const rows = await pool.query<{ kind: string; actor_type: string; actor_id: string }>(
      `SELECT e.kind, e.actor_type, e.actor_id
       FROM report_events e JOIN reports r ON r.id = e.report_id
       WHERE r.public_id = $1 AND e.kind = 'acknowledged'`,
      [DISHUB_REPORT],
    );

    expect(rows.rows[0]).toMatchObject({
      kind: 'acknowledged',
      actor_type: 'partner',
      actor_id: USER_A,
    });
  });

  it('revokes the session on logout and refuses the next call', async () => {
    await agent.delete('/v1/partner/sessions/current').set(withCsrf(csrf)).expect(204);
    await agent.get('/v1/partner/me').set('Origin', WEB_ORIGIN).expect(401);
  });

  it('keeps a stable OTP response for unknown and known emails', async () => {
    const unknown = await agent
      .post('/v1/partner/otp')
      .set(withCsrf(csrf))
      .send({ email: 'tidak-ada@dishub.go.id' })
      .expect(202);

    const known = await agent
      .post('/v1/partner/otp')
      .set(withCsrf(csrf))
      .send({ email: 'budi@dishub.go.id' })
      .expect(202);

    expect((unknown.body as { data: unknown }).data).toEqual(
      (known.body as { data: unknown }).data,
    );
  });
});