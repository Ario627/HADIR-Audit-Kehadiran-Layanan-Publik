import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { EstimateQuery, Uuid } from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { EstimatesService } from './estimates.service';

const ESTIMATE_CACHE = 'public, s-maxage=300, stale-while-revalidate=3600';

@Controller('stops')
export class EstimatesController {
  constructor(private readonly estimates: EstimatesService) {}

  @Get(':id/estimate')
  @Header('Cache-Control', ESTIMATE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async estimate(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    const stopId = parseOrThrow(Uuid, id);
    const input = parseOrThrow(EstimateQuery, query);
    const estimate = await this.estimates.estimate(stopId, input);
    return ok(estimate, requestIdOf(request));
  }
}