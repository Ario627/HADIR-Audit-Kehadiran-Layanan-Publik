import { Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { deviceOf } from '../../common/http/request-context';
import { SkipCsrf } from '../../common/security/csrf.guard';
import { DevicesService } from './devices.service';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipCsrf()
  @RateLimit(RATE_LIMIT_POLICIES.deviceBootstrap)
  async bootstrap(@Req() request: Request): Promise<void> {
    const device = deviceOf(request);
    await this.devices.bootstrap(device.hash);
  }
}