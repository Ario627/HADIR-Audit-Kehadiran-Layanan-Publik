import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { OTP_DELIVERY, LogOtpDelivery } from '../../common/auth/otp-delivery';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { PartnerCredentialRepository } from '../../db/repositories/partner-credential.repository';
import { PartnerRepository } from '../../db/repositories/partner.repository';
import { OutboxRepository } from '../../db/repositories/outbox.repository';
import { ExportRepository } from '../../db/repositories/export.repository';
import { ReportsModule } from '../reports/reports.module';
import { UploadsModule } from '../uploads/uploads.module';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerCredentialService } from './partner-credential.service';
import { PartnerOtpService } from './partner-otp.service';
import { PartnerPasskeyController } from './partner-passkey.controller';
import { PartnerPasskeyService } from './partner-passkey.service';
import { PartnerExportsController } from './partner-exports.controller';
import { PartnerExportsService } from './partner-exports.service';
import { PartnerAnalyticsService } from './partner-analytics.service';
import { PartnerReportsController } from './partner-reports.controller';
import { PartnerReportsService } from './partner-reports.service';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

@Module({
  imports: [AuditModule, ReportsModule, IdempotencyModule, UploadsModule],
  controllers: [
    PartnerController,
    PartnerPasskeyController,
    PartnerReportsController,
    PartnerExportsController,
  ],
  providers: [
    PartnerService,
    PartnerAuthService,
    PartnerCredentialService,
    PartnerOtpService,
    PartnerPasskeyService,
    PartnerReportsService,
    PartnerExportsService,
    PartnerAnalyticsService,
    PartnerRepository,
    PartnerCredentialRepository,
    OutboxRepository,
    ExportRepository,
    { provide: OTP_DELIVERY, useClass: LogOtpDelivery },
  ],
  exports: [PartnerAuthService],
})
export class PartnerModule {}
