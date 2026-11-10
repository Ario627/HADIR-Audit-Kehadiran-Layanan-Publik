import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { GovernanceRepository } from '../../db/repositories/governance.repository';
import { ReportsRepository } from '../../db/repositories/reports.repository';
import { AdminModule } from '../admin/admin.module';
import { PartnerModule } from '../partner/partner.module';
import { ReportsModule } from '../reports/reports.module';
import {
  GovernanceAdminController,
  GovernanceCitizenAppealController,
  GovernanceMyAppealController,
  GovernancePanelController,
  GovernancePublicController,
} from './governance.controller';
import { GovernanceService } from './governance.service';

@Module({
  imports: [AuditModule, AdminModule, ReportsModule, PartnerModule],
  controllers: [
    GovernancePublicController,
    GovernanceCitizenAppealController,
    GovernanceMyAppealController,
    GovernancePanelController,
    GovernanceAdminController,
  ],
  providers: [GovernanceService, GovernanceRepository, ReportsRepository],
  exports: [GovernanceService, GovernanceRepository],
})
export class GovernanceModule {}
