import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { deviceMiddleware } from './../src/common/http/device.middleware';
import { ProblemDetailsFilter } from './../src/common/http/problem-details.filter';
import { requestIdMiddleware } from './../src/common/http/request-id.middleware';

describe('HADIR API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.use(deviceMiddleware);
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

  it('lists the demo stops', async () => {
    const response = await request(app.getHttpServer()).get('/v1/stops').expect(200);
    expect(response.body.data).toHaveLength(6);
    expect(response.body.data[0]).toMatchObject({ code: 'BMS-A12', isDemo: true });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('runs a QR episode end to end', async () => {
    const agent = request.agent(app.getHttpServer());

    const started = await agent
      .post('/v1/episodes')
      .send({
        stopCode: 'BMS-A12',
        startMode: 'qr',
        clientStartedAt: new Date().toISOString(),
        clientEventId: '0192f0c4-0000-7000-8000-000000000001',
      })
      .expect(201);

    expect(started.body.data).toMatchObject({ presence: 'qr_only', outcome: null });
    const episodeId = started.body.data.id as string;

    const ended = await agent
      .patch(`/v1/episodes/${episodeId}`)
      .send({
        outcome: 'boarded',
        clientEndedAt: new Date().toISOString(),
        clientEventId: '0192f0c4-0000-7000-8000-000000000002',
      })
      .expect(200);

    expect(ended.body.data.outcome).toBe('boarded');
    expect(ended.body.data.durationS).toBeGreaterThanOrEqual(0);
  });

  it('rejects a second active episode for the same device', async () => {
    const agent = request.agent(app.getHttpServer());
    const payload = {
      stopCode: 'BMS-A13',
      startMode: 'qr',
      clientStartedAt: new Date().toISOString(),
      clientEventId: '0192f0c4-0000-7000-8000-000000000003',
    };

    await agent.post('/v1/episodes').send(payload).expect(201);
    const conflict = await agent
      .post('/v1/episodes')
      .send({ ...payload, clientEventId: '0192f0c4-0000-7000-8000-000000000004' })
      .expect(409);

    expect(conflict.body.code).toBe('EPISODE_ALREADY_ACTIVE');
  });

  it('returns an honest empty estimate for a stop without measurements', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/stops/BMS-A12/estimate?window=7d')
      .expect(200);
    expect(response.body.data.metrics.n).toBe(0);
    expect(response.body.data.evidence).toBe('none');
    expect(response.body.data.direction).toBe('inconclusive');
  });

  it('returns 422 with field errors for an invalid payload', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/episodes')
      .send({ stopCode: 'X', startMode: 'qr' })
      .expect(422);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.errors.length).toBeGreaterThan(0);
  });
});
