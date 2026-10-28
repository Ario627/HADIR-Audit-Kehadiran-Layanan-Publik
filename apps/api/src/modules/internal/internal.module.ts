import { Module } from '@nestjs/common';
import { OutboxRepository } from '../../db/repositories/outbox.repository';
import { EstimatesModule } from '../estimates/estimates.module';
import { StopsModule } from '../stops/stops.module';
import { InternalController } from './internal.controller';
import { InternalGuard } from './internal.guard';
import { MetricsService } from './metrics.service';

@Module({
  imports: [EstimatesModule, StopsModule],
  controllers: [InternalController],
  providers: [InternalGuard, MetricsService, OutboxRepository],
})
export class InternalModule {}
