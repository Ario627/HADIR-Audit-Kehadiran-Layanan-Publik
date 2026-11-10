import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AccountabilityRepository } from '../../db/repositories/accountability.repository';
import { AdminModule } from '../admin/admin.module';
import { ReportsModule } from '../reports/reports.module';
import { AccountabilityController } from './accountability.controller';
import { AdminAccountabilityController } from './accountability-partner.controller';
import { AccountabilityService } from './accountability.service';

@Module({
  imports: [AuditModule, AdminModule, ReportsModule],
  controllers: [AccountabilityController, AdminAccountabilityController],
  providers: [AccountabilityService, AccountabilityRepository],
  exports: [AccountabilityService, AccountabilityRepository],
})
export class AccountabilityModule {}
