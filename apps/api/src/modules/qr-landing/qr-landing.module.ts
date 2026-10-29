import { Module } from '@nestjs/common';
import { QrModule } from '../../common/security/qr.module';
import { StopsModule } from '../stops/stops.module';
import { QrLandingController } from './qr-landing.controller';
import { QrLandingService } from './qr-landing.service';

@Module({
  imports: [QrModule, StopsModule],
  controllers: [QrLandingController],
  providers: [QrLandingService],
})
export class QrLandingModule {}