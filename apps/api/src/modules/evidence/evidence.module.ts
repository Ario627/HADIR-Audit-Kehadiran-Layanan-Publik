import { Module } from '@nestjs/common';
import { EvidenceRepository } from '../../db/repositories/evidence.repository';
import { AdminModule } from '../admin/admin.module';
import { EstimatesModule } from '../estimates/estimates.module';
import { StopsModule } from '../stops/stops.module';
import { EvidenceController } from './evidence.controller';
import { EvidenceAdminController } from './evidence-admin.controller';
import { EvidenceService } from './evidence.service';

@Module({
  imports: [AdminModule, StopsModule, EstimatesModule],
  controllers: [EvidenceController, EvidenceAdminController],
  providers: [EvidenceService, EvidenceRepository],
  exports: [EvidenceService],
})
export class EvidenceModule {}
