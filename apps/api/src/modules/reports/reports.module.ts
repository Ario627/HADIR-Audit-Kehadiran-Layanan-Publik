import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import { ReportsRepository } from '../../db/repositories/reports.repository';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuditModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRepository, DevicesRepository],
  exports: [ReportsService],
})
export class ReportsModule {}
