import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ListStopsQuery, Uuid } from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { StopsService } from './stops.service';

const LIST_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';
const DETAIL_CACHE = 'public, s-maxage=3600';

@Controller('stops')
export class StopsController {
  constructor(private readonly stops: StopsService) {}

  @Get()
  @Header('Cache-Control', LIST_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async list(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(ListStopsQuery, query);
    const result = await this.stops.list(input);
    return ok(result.items, requestIdOf(request), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }

  @Get('by-code/:code/authorities')
  @Header('Cache-Control', DETAIL_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async authorities(@Param('code') code: string, @Req() request: Request) {
    const rows = await this.stops.authoritiesByCode(code.toUpperCase());
    return ok(rows, requestIdOf(request));
  }

  @Get('by-code/:code')
  @Header('Cache-Control', DETAIL_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async byCode(@Param('code') code: string, @Req() request: Request) {
    const stop = await this.stops.getByCode(code.toUpperCase());
    return ok(stop, requestIdOf(request));
  }

  @Get(':id')
  @Header('Cache-Control', DETAIL_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async detail(@Param('id') id: string, @Req() request: Request) {
    const stopId = parseOrThrow(Uuid, id);
    const stop = await this.stops.getById(stopId);
    return ok(stop, requestIdOf(request));
  }
}