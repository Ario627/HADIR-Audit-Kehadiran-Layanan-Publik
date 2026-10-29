import { Controller, Get } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { DbHealthService } from '../db/db.module';

@Controller()
export class HealthController {
  constructor(private readonly db: DbHealthService) {}

  @Get('healthz')
  health() {
    return { status: 'ok', uptimeS: Math.round(process.uptime()) };
  }

  @Get('readyz')
  async ready() {
    const database = await this.db.check();
    if (!database.ok) {
      throw new AppError('SERVICE_UNAVAILABLE', {
        detail: 'Database belum siap menerima permintaan',
      });
    }
    return { status: 'ready' };
  }
}