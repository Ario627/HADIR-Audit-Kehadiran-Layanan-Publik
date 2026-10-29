import { Module } from '@nestjs/common';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, DevicesRepository],
})
export class DevicesModule {}