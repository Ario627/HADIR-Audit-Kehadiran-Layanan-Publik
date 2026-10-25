import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('healthz')
  health() {
    return { status: 'ok', uptimeS: Math.round(process.uptime()) };
  }

  @Get('readyz')
  ready() {
    return { status: 'ready' };
  }
}
