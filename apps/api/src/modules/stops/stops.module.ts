import { Module } from '@nestjs/common';
import { StopsRepository } from '../../db/repositories/stops.repository';
import { RoutesController } from './routes.controller';
import { StopsController } from './stops.controller';
import { StopsService } from './stops.service';

@Module({
  controllers: [StopsController, RoutesController],
  providers: [StopsService, StopsRepository],
  exports: [StopsService],
})
export class StopsModule {}