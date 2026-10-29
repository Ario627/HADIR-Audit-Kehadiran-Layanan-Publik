import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RunwayListQuery, Uuid } from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { RunwayService } from './runway.service';

const RUNWAY_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

@Controller()
export class RunwayController {
  constructor(private readonly runway: RunwayService) {}

  @Get('runway')
  @Header('Cache-Control', RUNWAY_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async list(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(RunwayListQuery, query);
    const items = await this.runway.list(input);
    return ok(items, requestIdOf(request));
  }

  @Get('services/:routeId/runway/events')
  @Header('Cache-Control', RUNWAY_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async events(@Param('routeId') routeId: string, @Req() request: Request) {
    const id = parseOrThrow(Uuid, routeId);
    const events = await this.runway.events(id);
    return ok(events, requestIdOf(request));
  }

  @Get('services/:routeId/runway')
  @Header('Cache-Control', RUNWAY_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async byRoute(@Param('routeId') routeId: string, @Req() request: Request) {
    const id = parseOrThrow(Uuid, routeId);
    const runway = await this.runway.byRoute(id);
    return ok(runway, requestIdOf(request));
  }
}