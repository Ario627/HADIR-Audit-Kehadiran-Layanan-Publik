import { createHmac } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { deviceMiddleware } from './../src/common/http/device.middleware';
import { ProblemDetailsFilter } from './../src/common/http/problem-details.filter';
import { requestIdMiddleware } from './../src/common/http/request-id.middleware';
import { csrfMiddleware } from './../src/common/security/csrf';

const WEB_ORIGIN = 'http://localhost:5173';
const QR_EPOCH = '202610';
const QR_KEY_ID = 'k1';
const QR_SECRET = Buffer.alloc(32, 7);

type TestAgent = ReturnType<typeof request.agent>;

interface StopItem {
  code: string;
  isDemo: boolean;
}

interface EpisodeResponse {
  id: string;
  outcome: string | null;
  durationS: number | null;
}

function uuidv7(index: number): string {
  return `0192f0c4-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
}

function qrSignature(stopCode: string): string {
  return createHmac('sha256', QR_SECRET)
    .update(`v1|${stopCode}|${QR_EPOCH}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
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

async function bootstrapDevice(agent: TestAgent): Promise<string> {
  const response = await agent.post('/v1/devices').set('Origin', WEB_ORIGIN).expect(204);
  return csrfFromHeaders(response.headers as Record<string, unknown>);
}

function withCsrf(csrf: string): Record<string, string> {
  return {
    Origin: WEB_ORIGIN,
    'X-CSRF-Token': csrf,
  };
}

function startPayload(index: number) {
  return {
    stopCode: 'BMS-A12',
    startMode: 'manual',
    clientStartedAt: new Date().toISOString(),
    clientEventId: uuidv7(index),
  };
}

function endPayload(index: number) {
  return {
    outcome: 'boarded',
    clientEndedAt: new Date().toISOString(),
    clientEventId: uuidv7(index),
  };
}

describe('HADIR API (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.use(deviceMiddleware);
    app.use(csrfMiddleware);
    app.useGlobalFilters(new ProblemDetailsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports health without the version prefix', async () => {
    const response = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(response.body).toMatchObject({ status: 'ok' });
  });

  it('lists seeded stops', async () => {
    const response = await request(app.getHttpServer()).get('/v1/stops').expect(200);
    const stops = response.body.data as StopItem[];
    expect(stops.length).toBeGreaterThanOrEqual(12);
    expect(stops.find((stop) => stop.code === 'BMS-A12')).toMatchObject({
      code: 'BMS-A12',
      isDemo: true,
    });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('accepts a signed QR landing', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/s/BMS-A12?e=${QR_EPOCH}&k=${QR_KEY_ID}&s=${qrSignature('BMS-A12')}`)
      .expect(200);
    expect(response.body.data).toMatchObject({
      qr: { valid: true, epoch: QR_EPOCH, keyId: QR_KEY_ID },
      privacy: { locationUsed: false },
    });
  });

  it('rejects an invalid QR signature', async () => {
    const response = await request(app.getHttpServer())
      .get(`/v1/s/BMS-A12?e=${QR_EPOCH}&k=${QR_KEY_ID}&s=${'A'.repeat(22)}`)
      .expect(422);
    expect(response.body.code).toBe('QR_INVALID');
  });

  it('runs an episode end to end', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await bootstrapDevice(agent);

    const started = await agent
      .post('/v1/episodes')
      .set(withCsrf(csrf))
      .set('Idempotency-Key', uuidv7(10))
      .send(startPayload(11))
      .expect(201);
    const episode = started.body.data as EpisodeResponse;
    expect(episode.outcome).toBeNull();

    const ended = await agent
      .patch(`/v1/episodes/${episode.id}`)
      .set(withCsrf(csrf))
      .set('Idempotency-Key', uuidv7(12))
      .send(endPayload(13))
      .expect(200);
    const finished = ended.body.data as EpisodeResponse;
    expect(finished.outcome).toBe('boarded');
    expect(finished.durationS).toBeGreaterThanOrEqual(0);
  });

  it('rejects a second active episode for the same device', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await bootstrapDevice(agent);

    await agent
      .post('/v1/episodes')
      .set(withCsrf(csrf))
      .set('Idempotency-Key', uuidv7(20))
      .send(startPayload(21))
      .expect(201);

    const conflict = await agent
      .post('/v1/episodes')
      .set(withCsrf(csrf))
      .set('Idempotency-Key', uuidv7(22))
      .send(startPayload(23))
      .expect(409);
    expect(conflict.body.code).toBe('EPISODE_ALREADY_ACTIVE');
  });

  it('replays an idempotent start request', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await bootstrapDevice(agent);
    const payload = startPayload(30);
    const key = uuidv7(31);

    const first = await agent
      .post('/v1/episodes')
      .set(withCsrf(csrf))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    const second = await agent
      .post('/v1/episodes')
      .set(withCsrf(csrf))
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    expect(second.body.data.id).toBe((first.body.data as EpisodeResponse).id);
  });

  it('requires an Idempotency-Key for episode start', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await bootstrapDevice(agent);

    const response = await agent
      .post('/v1/episodes')
      .set(withCsrf(csrf))
      .send(startPayload(40))
      .expect(400);
    expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('rejects a mutation without CSRF token', async () => {
    const agent = request.agent(app.getHttpServer());
    await bootstrapDevice(agent);

    const response = await agent
      .post('/v1/episodes')
      .set('Origin', WEB_ORIGIN)
      .send(startPayload(50))
      .expect(403);
    expect(response.body.code).toBe('CSRF_MISSING');
  });

  it('returns an honest empty estimate for simulated data', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/stops/BMS-A12/estimate?window=7d')
      .expect(200);
    expect(response.body.data.metrics.n).toBe(0);
    expect(response.body.data.evidence).toBe('none');
    expect(response.body.data.direction).toBe('inconclusive');
  });

  it('returns 422 with field errors for an invalid payload', async () => {
    const agent = request.agent(app.getHttpServer());
    const csrf = await bootstrapDevice(agent);

    const response = await agent
      .post('/v1/episodes')
      .set(withCsrf(csrf))
      .set('Idempotency-Key', uuidv7(60))
      .send({ stopCode: 'X', startMode: 'qr' })
      .expect(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.errors.length).toBeGreaterThan(0);
  });
});
