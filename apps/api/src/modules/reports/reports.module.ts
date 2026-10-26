import { Module } from '@nestjs/common';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import { ReportsRepository } from '../../db/repositories/reports.repository';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRepository, DevicesRepository],
  exports: [ReportsService],
})
export class ReportsModule {}
