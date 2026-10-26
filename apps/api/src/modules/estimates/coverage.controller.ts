import { Controller, Get, Header, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CoverageQuery, CoverageSummaryQuery } from '@hadir/contracts';
import { parseBbox } from '../../common/geo/bbox';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { EstimatesService } from './estimates.service';

const COVERAGE_CACHE = 'public, s-maxage=900, stale-while-revalidate=3600';

@Controller('coverage')
export class CoverageController {
  constructor(private readonly estimates: EstimatesService) {}

  @Get('summary')
  @Header('Cache-Control', COVERAGE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.coverageRead)
  async summary(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(CoverageSummaryQuery, query);
    const result = await this.estimates.coverageSummary({
      period: input.period,
      routeId: null,
      bbox: input.bbox === undefined ? null : parseBbox(input.bbox),
    });
    return ok(result, requestIdOf(request));
  }

  @Get()
  @Header('Cache-Control', COVERAGE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.coverageRead)
  async coverage(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(CoverageQuery, query);
    const result = await this.estimates.coverage({
      period: input.period,
      routeId: input.routeId ?? null,
      bbox: input.bbox === undefined ? null : parseBbox(input.bbox),
    });
    return ok(result, requestIdOf(request));
  }
}
