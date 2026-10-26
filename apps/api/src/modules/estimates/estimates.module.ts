import { Module } from '@nestjs/common';
import { EstimatesRepository } from '../../db/repositories/estimates.repository';
import { StopsModule } from '../stops/stops.module';
import { EstimatesController } from './estimates.controller';
import { EstimatesService } from './estimates.service';

@Module({
  imports: [StopsModule],
  controllers: [EstimatesController],
  providers: [EstimatesService, EstimatesRepository],
})
export class EstimatesModule {}