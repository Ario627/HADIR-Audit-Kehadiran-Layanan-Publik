import { createHmac } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Pool } from 'pg';
import request from 'supertest';
import { signInvite } from '../src/common/auth/invite-token';

const DATABASE_URL = process.env.HADIR_BOUNDARY_DATABASE_URL;
const IF_PRESENT = DATABASE_URL === undefined ? describe.skip : describe;

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(HERE, '../src/db/migrations');

const SECRET = process.env.SESSION_SECRET ?? 'test-only-secret-0000000000000000000000000';
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:5173';

const CITY = '0192f0c4-0000-7000-8000-0000000000c0';
const DISHUB = '0192f0c4-0000-7000-8000-0000000000a1';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';
const ROUTE = '0192f0c4-0000-7000-8000-0000000000e1';
const RUNWAY = '0192f0c4-0000-7000-8000-0000000000f1';
const USER = '0192f0c4-0000-7000-8000-0000000000b1';
const STOP_CODE = 'BMS-A12';
const QR_EPOCH = '202610';
const QR_KEY_ID = 'k1';
const QR_SECRET = Buffer.from('demo-qr-secret-for-rehearsal-only').toString('base64');
const QR_KEYRING = JSON.stringify({ [QR_EPOCH]: { id: QR_KEY_ID, secret: QR_SECRET } });

function qrProof(stopCode: string): { epoch: string; keyId: string; signature: string } {
  const signature = createHmac('sha256', Buffer.from(QR_SECRET, 'base64'))
    .update(`v1|${stopCode}|${QR_EPOCH}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
  return { epoch: QR_EPOCH, keyId: QR_KEY_ID, signature };
}

type Agent = ReturnType<typeof request.agent>;

function uuidv7(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let index = 0; index < 32; index += 1) {
    out += hex[Math.floor(Math.random() * 16)];
  }
  return [
    out.slice(0, 8),
    out.slice(8, 12),
    `7${out.slice(13, 16)}`,
    `8${out.slice(17, 20)}`,
    out.slice(20, 32),
  ].join('-');
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
  return {
    Origin: WEB_ORIGIN,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}

function inviteFor(institutionId: string, role: 'responder' | 'admin' = 'responder'): string {
  return signInvite(
    {
      sub: USER,
      inst: institutionId,
      role,
      jti: `jti-demo-${uuidv7().slice(0, 8)}`,
      exp: Math.floor(Date.now() / 1000) + 900,
    },
    SECRET,
  );
}

const DAY_MS = 86_400_000;

function verdictChoicesFor(category: string): readonly string[] {
  return category === 'stop_safety' || category === 'service_no_show'
    ? ['join', 'new_report', 'data_insufficient']
    : ['data_supports', 'new_report', 'already_planned'];
}

IF_PRESENT('WIA demo rehearsal against the real migration chain', () => {
  let app: NestExpressApplication;
  let pool: Pool;
  let agent: Agent;
  let csrf: string;
  const migratedFiles: string[] = [];

  const post = (path: string, body: unknown, key?: string) => {
    const call = agent.post(path).set(withCsrf(csrf));
    if (key !== undefined) {
      call.set('Idempotency-Key', key);
    }
    return call.send(body as object);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    process.env.QR_KEYRING_JSON = QR_KEYRING;

    pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent');

    const files = (await readdir(MIGRATIONS))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const body = await readFile(resolve(MIGRATIONS, file), 'utf8');
      await pool.query(body);
      migratedFiles.push(file);
    }
    await pool.query('GRANT USAGE ON SCHEMA public TO hadir_app');

    await pool.query(
      `INSERT INTO cities (id, code, name) VALUES ($1, 'SMG', 'Semarang')`,
      [CITY],
    );
    await pool.query(
      `INSERT INTO institutions (id, city_id, name, kind)
       VALUES ($1, $2, 'Dishub Kota Semarang', 'dishub')`,
      [DISHUB, CITY],
    );
    await pool.query(
      `INSERT INTO stops (id, city_id, code, name, geom, geofence_radius_m, status)
       VALUES ($1, $2, $3, 'Halte UMP', ST_SetSRID(ST_MakePoint(110.42, -7.05), 4326)::geography, 150, 'active')`,
      [STOP, CITY, STOP_CODE],
    );
    await pool.query(
      `INSERT INTO routes (
         id, city_id, code, name, mode, promised_headway_peak_min,
         promised_headway_off_min, headway_source_url, headway_valid_from, status
       ) VALUES ($1, $2, 'A12', 'UMP - Terminal', 'feeder', 10, 20,
         'https://dinhub.semarangkota.go.id/sk-headway-2026', '2026-01-01', 'active')`,
      [ROUTE, CITY],
    );
    await pool.query(
      `INSERT INTO authority_map (city_id, asset_kind, asset_ref, institution_id, source_url, verified)
       VALUES ($1, 'stop', $2, $3, 'https://dinhub.semarangkota.go.id/aset/halte', true)`,
      [CITY, STOP_CODE, DISHUB],
    );
    await pool.query(
      `INSERT INTO partner_users (id, email_hash, email_enc, display_name)
       VALUES ($1, repeat('a', 64), '\\x00'::bytea, 'Budi')`,
      [USER],
    );
    await pool.query(
      `INSERT INTO partner_memberships (user_id, institution_id, role)
       VALUES ($1, $2, 'responder')`,
      [USER, DISHUB],
    );

    await pool.query(
      `INSERT INTO service_runway (id, route_id, status, source_url, decision_doc, decision_date)
       VALUES ($1, $2, 'funded', $3, 'SK Dishub 2026/17', '2026-02-01')`,
      [RUNWAY, ROUTE, 'https://dinhub.semarangkota.go.id/runway/2026'],
    );
    const kinds = ['announced', 'budget_decided', 'funded'] as const;
    for (let index = 0; index < kinds.length; index += 1) {
      await pool.query(
        `INSERT INTO runway_events (
           runway_id, seq, kind, note, source_url, occurred_at,
           prev_hash, payload_hash, chain_hash
         ) VALUES ($1, $2, $3::runway_event_kind, $4, $5, $6,
           repeat('0', 32)::bytea, repeat('1', 32)::bytea, repeat('2', 32)::bytea)`,
        [
          RUNWAY,
          index + 1,
          kinds[index],
          `Tahapan runway ${String(index + 1)}`,
          'https://dinhub.semarangkota.go.id/runway/2026',
          new Date(Date.now() - (index + 1) * DAY_MS),
        ],
      );
    }

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
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('applies every migration in filename order without error', () => {
    expect(migratedFiles.length).toBeGreaterThanOrEqual(30);
    expect(migratedFiles).toContain('0024z_media_status_moderation.sql');
    expect(
      migratedFiles.indexOf('0024z_media_status_moderation.sql'),
    ).toBeLessThan(migratedFiles.indexOf('0025_fix_media_public_policy.sql'));
  });

  it('demo 1 — QR landing resolves a stop code', async () => {
    const landing = await request(app.getHttpServer())
      .get(
        `/v1/s/${STOP_CODE}?e=${QR_EPOCH}&k=${QR_KEY_ID}&s=${qrProof(STOP_CODE).signature}`,
      )
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    const body = landing.body as { data: { stop: { code: string }; qr: { valid: boolean } } };
    expect(body.data.stop.code).toBe(STOP_CODE);
    expect(body.data.qr.valid).toBe(true);
  });

  it('demo 1 — starts a wait ticket and finishes it', async () => {
    const started = await post(
      '/v1/episodes',
      {
        stopCode: STOP_CODE,
        startMode: 'qr',
        qr: qrProof(STOP_CODE),
        clientStartedAt: new Date(Date.now() - 60_000).toISOString(),
        clientEventId: uuidv7(),
        distanceBucket: '0-50',
        accuracyBucket: '<=20',
      },
      uuidv7(),
    ).expect(201);

    const episode = (started.body as { data: { id: string } }).data;
    expect(episode.id).toHaveLength(36);

    const active = await agent
      .get('/v1/episodes/active')
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    expect((active.body as { data: { id: string } }).data.id).toBe(episode.id);

    const ended = await agent
      .patch(`/v1/episodes/${episode.id}`)
      .set(withCsrf(csrf))
      .set('Idempotency-Key', uuidv7())
      .send({ outcome: 'boarded', clientEndedAt: new Date().toISOString(), clientEventId: uuidv7() })
      .expect(200);
    expect((ended.body as { data: { outcome: string } }).data.outcome).toBe('boarded');
  });

  it('demo 2 — the evidence board returns a sample and a labelled level', async () => {
    const board = await agent.get('/v1/stops').set('Origin', WEB_ORIGIN).expect(200);
    const items = (board.body as { data: { code: string }[] }).data;
    expect(items.map((item) => item.code)).toContain(STOP_CODE);

    const estimate = await agent
      .get(`/v1/stops/${STOP}/estimate?window=7d`)
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    const data = (estimate.body as {
      data: {
        metrics: { n: number; medianMin: number | null; rmstMin: number | null; ci: unknown };
        evidence: string;
        sample: { days: number };
      };
    }).data;
    expect(typeof data.metrics.n).toBe('number');
    expect(['none', 'indication', 'strong', 'field_verified']).toContain(data.evidence);
    expect(data.sample.days).toBeGreaterThanOrEqual(0);
  }, 20_000);

  it('demo 3 — triage returns a decision card with a verdict', async () => {
    const verdicts: string[] = [];
    for (const category of ['service_no_show', 'stop_facility', 'route_info']) {
      const response = await post(
        '/v1/triage',
        {
          stopCode: STOP_CODE,
          category,
          text: `Demontrasi triase untuk kategori ${category}.`,
          clientEventId: uuidv7(),
        },
        uuidv7(),
      ).expect(201);
      const verdict = (response.body as { data: { verdict: string } }).data.verdict;
      verdicts.push(verdict);
      expect(verdictChoicesFor(category)).toContain(verdict);
    }
    expect(new Set(verdicts).size).toBeGreaterThanOrEqual(1);
  });

  it('demo 4 — create a report and read it back on the public board', async () => {
    const created = await post(
      '/v1/reports',
      {
        category: 'service_wait',
        stopCode: STOP_CODE,
        text: 'Bus tidak datang lebih dari dua puluh menit pada jam sibuk pagi.',
        clientEventId: uuidv7(),
      },
      uuidv7(),
    ).expect(201);

    const report = (created.body as { data: { report: { publicId: string; status: string } } })
      .data.report;
    expect(report.publicId).toMatch(/^LPR-\d{4}-\d{6}$/u);

    await pool.query(`UPDATE reports SET moderation = 'approved' WHERE public_id = $1`, [
      report.publicId,
    ]);

    const detail = await agent
      .get(`/v1/reports/${report.publicId}`)
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    expect((detail.body as { data: { publicId: string } }).data.publicId).toBe(report.publicId);
  });

  it('demo 4 — an offline retry with the same key does not duplicate the report', async () => {
    const key = uuidv7();
    const eventId = uuidv7();
    const body = {
      category: 'other',
      stopCode: STOP_CODE,
      text: 'Laporan dikirim ulang dari antrean luring setelah sinyal pulih.',
      clientEventId: eventId,
    };
    const first = await post('/v1/reports', body, key).expect(201);
    const replay = await post('/v1/reports', body, key).expect(201);
    const firstId = (first.body as { data: { report: { publicId: string } } }).data.report
      .publicId;
    const replayId = (replay.body as { data: { report: { publicId: string } } }).data.report
      .publicId;
    expect(replayId).toBe(firstId);

    const count = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM reports WHERE client_event_id = $1`,
      [eventId],
    );
    expect(count.rows[0]?.total).toBe('1');
  });

  it('demo 5 — partner inbox, action and response are reachable', async () => {
    const partner = request.agent(app.getHttpServer());
    const boot = await partner.post('/v1/devices').set('Origin', WEB_ORIGIN).expect(204);
    const partnerCsrf = csrfFromHeaders(boot.headers as Record<string, unknown>);

    await partner
      .post('/v1/partner/sessions')
      .set(withCsrf(partnerCsrf))
      .send({ method: 'invite', inviteToken: inviteFor(DISHUB) })
      .expect(200);

    const inbox = await partner.get('/v1/partner/reports').set('Origin', WEB_ORIGIN).expect(200);
    const items = (inbox.body as { data: { items: { publicId: string }[] } }).data.items;
    expect(items.length).toBeGreaterThanOrEqual(1);

    const target = items[0]?.publicId ?? '';
    await partner
      .post(`/v1/partner/reports/${target}/action`)
      .set(withCsrf(partnerCsrf))
      .set('Idempotency-Key', uuidv7())
      .send({ action: 'acknowledge', note: 'Sudah kami teruskan ke unit terkait.' })
      .expect(200);

    const caseFile = await partner
      .get(`/v1/partner/reports/${target}/accountability`)
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    const tracker = (caseFile.body as { data: { milestones: { entries: { key: string }[] } } })
      .data.milestones;
    expect(tracker.entries.map((entry) => entry.key)).toContain('acknowledged');
  });

  it('demo 6 — radar exposes a source url and a dated event', async () => {
    const runway = await agent
      .get(`/v1/services/${ROUTE}/runway`)
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    const events = (runway.body as { data: { events: { occurredAt: string; sourceUrl: string }[] } })
      .data.events;
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events[0];
    expect(first?.sourceUrl).toContain('https://');
    expect(Number.isNaN(Date.parse(first?.occurredAt ?? ''))).toBe(false);
  });

  it('runtime — a transient image outage is a retryable 503, not a permanent 404', async () => {
    const { NewsService } = await import('../src/modules/news/news.service');
    const { signMediaUrl } = await import('../src/modules/news/news.token');
    const { env } = await import('../src/common/config/env');
    const news = app.get(NewsService);
    expect(news).toBeDefined();

    const imageUrl = 'https://img.antaranews.com/cache/800x533/2026/11/10/uji.jpg';
    const token = signMediaUrl(env.SESSION_SECRET, imageUrl, Date.now());
    const original = globalThis.fetch;

    try {
      globalThis.fetch = (async () =>
        new Response('sibuk', { status: 503 })) as unknown as typeof fetch;
      const transient = await request(app.getHttpServer())
        .get(`/v1/news/media/${token}`)
        .set('Origin', WEB_ORIGIN);
      expect(transient.status).toBe(503);
      expect(transient.headers['retry-after']).toBe('30');
      expect(transient.headers['cache-control']).toContain('no-store');

      globalThis.fetch = (async () =>
        new Response('hilang', { status: 404 })) as unknown as typeof fetch;
      const gone = await request(app.getHttpServer())
        .get(`/v1/news/media/${token}`)
        .set('Origin', WEB_ORIGIN);
      expect(gone.status).toBe(404);

      globalThis.fetch = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      const thrown = await request(app.getHttpServer())
        .get(`/v1/news/media/${token}`)
        .set('Origin', WEB_ORIGIN);
      expect(thrown.status).toBe(503);
    } finally {
      globalThis.fetch = original;
    }

    const forged = await request(app.getHttpServer())
      .get('/v1/news/media/not.a.token')
      .set('Origin', WEB_ORIGIN);
    expect(forged.status).toBe(404);
  });

  it('demo 7 — the public board keeps working without any session', async () => {
    const board = await request(app.getHttpServer())
      .get('/v1/reports')
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    const rows = (board.body as { data: { publicId: string }[] }).data;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.publicId).toMatch(/^LPR-\d{4}-\d{6}$/u);

    const meta = await request(app.getHttpServer())
      .get('/v1/meta')
      .set('Origin', WEB_ORIGIN)
      .expect(200);
    expect((meta.body as { methodVersion: string }).methodVersion).toBe('km-v1');
  });
});
