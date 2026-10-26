import { Module } from '@nestjs/common';
import { StopsRepository } from '../../db/repositories/stops.repository';
import { StopsController } from './stops.controller';
import { StopsService } from './stops.service';

@Module({
  controllers: [StopsController],
  providers: [StopsService, StopsRepository],
  exports: [StopsService],
})
export class StopsModule {}