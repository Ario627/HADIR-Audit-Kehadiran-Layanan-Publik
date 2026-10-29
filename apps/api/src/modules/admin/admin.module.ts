import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { AdminRepository } from '../../db/repositories/admin.repository';
import { ChainRepository } from '../../db/repositories/chain.repository';
import { PlatformAdminRepository } from '../../db/repositories/platform-admin.repository';
import { ReportsRepository } from '../../db/repositories/reports.repository';
import { TransparencyModule } from '../transparency/transparency.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformGuard } from './platform.guard';

@Module({
  imports: [AuditModule, TransparencyModule],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminService,
    PlatformAuthService,
    PlatformGuard,
    PlatformAdminRepository,
    AdminRepository,
    ChainRepository,
    ReportsRepository,
  ],
  exports: [PlatformAuthService],
})
export class AdminModule {}
