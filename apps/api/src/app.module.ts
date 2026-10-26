import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RateLimitGuard } from './common/http/rate-limit.guard';
import { RateLimitModule } from './common/http/rate-limit.module';
import { CsrfGuard } from './common/security/csrf.guard';
import { HealthController } from './health/health.controller';
import { DbModule } from './db/db.module';

@Module({
  imports: [RateLimitModule, DbModule],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}