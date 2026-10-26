import { Module } from '@nestjs/common';
import { RunwayRepository } from '../../db/repositories/runway.repository';
import { RunwayController } from './runway.controller';
import { RunwayService } from './runway.service';

@Module({
  controllers: [RunwayController],
  providers: [RunwayService, RunwayRepository],
  exports: [RunwayService],
})
export class RunwayModule {}