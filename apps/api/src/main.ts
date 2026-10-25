import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server } from 'node:http';
import { AppModule } from './app.module';
import { env } from './common/config/env';
import { deviceMiddleware } from './common/http/device.middleware';
import { ProblemDetailsFilter } from './common/http/problem-details.filter';
import { requestIdMiddleware } from './common/http/request-id.middleware';
import { csrfMiddleware } from './common/security/csrf';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });
  const instance = app.getHttpAdapter().getInstance();
  const server = app.getHttpServer() as Server;

  instance.set('trust proxy', env.TRUST_PROXY_HOPS > 0 ? env.TRUST_PROXY_HOPS : false);
  instance.set('etag', false);
  instance.set('query parser', 'simple');
  instance.set('json escape', true);
  instance.disable('x-powered-by');
  server.requestTimeout = env.REQUEST_TIMEOUT_MS;
  server.headersTimeout = env.HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = env.KEEP_ALIVE_TIMEOUT_MS;
  server.maxHeadersCount = env.MAX_HEADERS_COUNT;
  server.maxRequestsPerSocket = env.MAX_REQUESTS_PER_SOCKET;
  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      strictTransportSecurity: env.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  );
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(deviceMiddleware);
  app.use(csrfMiddleware);
  app.useBodyParser('json', {
    limit: env.BODY_LIMIT,
    strict: true,
    type: ['application/json', 'application/*+json'],
  });
  app.enableCors({
    origin: [...env.webOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Accept-Language',
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'If-None-Match',
      'X-CSRF-Token',
      'X-Request-Id',
    ],
    exposedHeaders: [
      'ETag',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
      'Warning',
      'X-Request-Id',
    ],
    maxAge: 600,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  await app.listen(env.PORT, env.HOST);
  logger.log(`HADIR API berjalan di http://${env.HOST}:${env.PORT}`);
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error('API gagal dimulai.', error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});