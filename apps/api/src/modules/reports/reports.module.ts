import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import { ReportsRepository } from '../../db/repositories/reports.repository';
import { ReportsController } from './reports.controller';
import { ReportsMediaService } from './reports.media.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuditModule, IdempotencyModule, UploadsModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsMediaService, ReportsRepository, DevicesRepository],
  exports: [ReportsService, ReportsRepository],
})
export class ReportsModule {}
