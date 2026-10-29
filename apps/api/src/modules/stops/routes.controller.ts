import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ListRoutesQuery, Uuid } from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { StopsService } from './stops.service';

const ROUTE_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

@Controller('routes')
export class RoutesController {
  constructor(private readonly stops: StopsService) {}

  @Get()
  @Header('Cache-Control', ROUTE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async list(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(ListRoutesQuery, query);
    const result = await this.stops.listRoutes(input);
    return ok(result.items, requestIdOf(request), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }

  @Get(':id/stops')
  @Header('Cache-Control', ROUTE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async stopsOnRoute(@Param('id') id: string, @Req() request: Request) {
    const routeId = parseOrThrow(Uuid, id);
    const result = await this.stops.listRouteStops(routeId);
    return ok(result, requestIdOf(request));
  }

  @Get(':id')
  @Header('Cache-Control', ROUTE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async detail(@Param('id') id: string, @Req() request: Request) {
    const routeId = parseOrThrow(Uuid, id);
    const route = await this.stops.getRoute(routeId);
    return ok(route, requestIdOf(request));
  }
}