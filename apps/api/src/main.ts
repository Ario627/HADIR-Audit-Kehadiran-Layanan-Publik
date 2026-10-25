import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { env } from './common/config/env';
import { deviceMiddleware } from './common/http/device.middleware';
import { ProblemDetailsFilter } from './common/http/problem-details.filter';
import { requestIdMiddleware } from './common/http/request-id.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  app.setGlobalPrefix('v1', { exclude: ['healthz', 'readyz'] });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(deviceMiddleware);
  app.useBodyParser('json', { limit: '256kb' });
  app.enableCors({
    origin: env.webOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
    maxAge: 600,
  });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  console.log(`HADIR API listening on http://localhost:${env.PORT}`);
}

void bootstrap();
