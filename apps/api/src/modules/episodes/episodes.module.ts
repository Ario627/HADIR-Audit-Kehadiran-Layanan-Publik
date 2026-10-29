import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module';
import { QrService } from '../../common/security/qr.service';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import { EpisodesRepository } from '../../db/repositories/episodes.repository';
import { EpisodesController } from './episodes.controller';
import { EpisodesService } from './episodes.service';

@Module({
  imports: [IdempotencyModule],
  controllers: [EpisodesController],
  providers: [EpisodesService, EpisodesRepository, DevicesRepository, QrService],
})
export class EpisodesModule {}