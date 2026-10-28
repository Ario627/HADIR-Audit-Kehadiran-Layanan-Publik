import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { RateLimitGuard } from './common/http/rate-limit.guard';
import { RateLimitModule } from './common/http/rate-limit.module';
import { CsrfGuard } from './common/security/csrf.guard';
import { HealthController } from './health/health.controller';
import { DbModule } from './db/db.module';
import { DevicesModule } from './modules/devices/devices.module';
import { StopsModule } from './modules/stops/stops.module';
import { EpisodesModule } from './modules/episodes/episodes.module';
import { QrLandingModule } from './modules/qr-landing/qr-landing.module';
import { EstimatesModule } from './modules/estimates/estimates.module';
import { MetaController } from './modules/meta/meta.controller';
import { TriageModule } from './modules/triage/triage.module';
import { ReportsModule } from './modules/reports/reports.module';
import { RunwayModule } from './modules/runway/runway.module';
import { PartnerModule } from './modules/partner/partner.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { AdminModule } from './modules/admin/admin.module';
import { TransparencyModule } from './modules/transparency/transparency.module';
import { InternalModule } from './modules/internal/internal.module';

@Module({
  imports: [
    DbModule,
    RateLimitModule,
    IdempotencyModule,
    DevicesModule,
    StopsModule,
    EpisodesModule,
    QrLandingModule,
    EstimatesModule,
    TriageModule,
    ReportsModule,
    RunwayModule,
    PartnerModule,
    UploadsModule,
    AdminModule,
    TransparencyModule,
    InternalModule,
  ],
  controllers: [AppController, HealthController, MetaController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}