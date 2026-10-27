import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { OTP_DELIVERY, LogOtpDelivery } from '../../common/auth/otp-delivery';
import { PartnerCredentialRepository } from '../../db/repositories/partner-credential.repository';
import { PartnerRepository } from '../../db/repositories/partner.repository';
import { ReportsModule } from '../reports/reports.module';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerCredentialService } from './partner-credential.service';
import { PartnerOtpService } from './partner-otp.service';
import { PartnerPasskeyController } from './partner-passkey.controller';
import { PartnerPasskeyService } from './partner-passkey.service';
import { PartnerReportsController } from './partner-reports.controller';
import { PartnerController } from './partner.controller';
import { PartnerService } from './partner.service';

@Module({
  imports: [AuditModule, ReportsModule],
  controllers: [PartnerController, PartnerPasskeyController, PartnerReportsController],
  providers: [
    PartnerService,
    PartnerAuthService,
    PartnerCredentialService,
    PartnerOtpService,
    PartnerPasskeyService,
    PartnerRepository,
    PartnerCredentialRepository,
    { provide: OTP_DELIVERY, useClass: LogOtpDelivery },
  ],
  exports: [PartnerAuthService],
})
export class PartnerModule {}
