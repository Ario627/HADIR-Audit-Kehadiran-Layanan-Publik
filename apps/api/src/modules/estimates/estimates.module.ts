import { Module } from '@nestjs/common';
import { EstimatesRepository } from '../../db/repositories/estimates.repository';
import { StopsModule } from '../stops/stops.module';
import { CoverageController } from './coverage.controller';
import { EstimatesController } from './estimates.controller';
import { EstimatesService } from './estimates.service';

@Module({
  imports: [StopsModule],
  controllers: [EstimatesController, CoverageController],
  providers: [EstimatesService, EstimatesRepository],
  exports: [EstimatesService],
})
export class EstimatesModule {}