import { Module } from '@nestjs/common';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import { TriageRepository } from '../../db/repositories/triage.repository';
import { EstimatesModule } from '../estimates/estimates.module';
import { RunwayModule } from '../runway/runway.module';
import { StopsModule } from '../stops/stops.module';
import { TriageController } from './triage.controller';
import { TriageService } from './triage.service';

@Module({
  imports: [StopsModule, EstimatesModule, RunwayModule],
  controllers: [TriageController],
  providers: [TriageService, TriageRepository, DevicesRepository],
  exports: [TriageService],
})
export class TriageModule {}
