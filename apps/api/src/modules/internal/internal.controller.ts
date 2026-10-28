import {
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { InternalEstimateRequest } from '@hadir/contracts';
import { env } from '../../common/config/env';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { EstimatesService } from '../estimates/estimates.service';
import { StopsService } from '../stops/stops.service';
import { MetricsService } from './metrics.service';
import { InternalGuard } from './internal.guard';

const NO_STORE = 'no-store, private, max-age=0';
const STARTED_AT = Date.now();

@Controller('internal')
@UseGuards(InternalGuard)
export class InternalController {
  constructor(
    private readonly estimates: EstimatesService,
    private readonly stops: StopsService,
    private readonly metrics: MetricsService,
  ) {}

  @Get('healthz')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  health() {
    return {
      status: 'ok' as const,
      version: env.DB_APPLICATION_NAME,
      uptimeS: Math.floor((Date.now() - STARTED_AT) / 1000),
    };
  }

  @Post('estimate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.internalEstimate)
  async estimate(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(InternalEstimateRequest, body);
    const stop = await this.stops.getByCode(input.stopCode);
    const estimate = await this.estimates.estimate(stop.id, {
      window: input.window,
      ...(input.routeId === undefined ? {} : { routeId: input.routeId }),
    });
    return ok(
      { estimate, methodVersion: estimate.methodVersion },
      requestIdOf(request),
    );
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  async prometheus(): Promise<string> {
    return this.metrics.render();
  }
}
