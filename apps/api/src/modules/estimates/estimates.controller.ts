import { createHash } from 'node:crypto';
import { Controller, Get, Header, HttpStatus, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { EstimateQuery, Uuid } from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { EstimatesService } from './estimates.service';

const ESTIMATE_CACHE = 'public, s-maxage=300, stale-while-revalidate=3600';

function etagFor(payload: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('base64url')
    .slice(0, 27);
  return `W/"${digest}"`;
}

function matchesEtag(header: string, etag: string): boolean {
  const bare = etag.replace(/^W\//, '');
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value.replace(/^W\//, '') === bare);
}

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
    @Res({ passthrough: true }) response: Response,
  ) {
    const stopId = parseOrThrow(Uuid, id);
    const input = parseOrThrow(EstimateQuery, query);
    const estimate = await this.estimates.estimate(stopId, input);
    const body = ok(estimate, requestIdOf(request));
    const etag = etagFor(body.data);
    response.setHeader('ETag', etag);

    const ifNoneMatch = request.header('if-none-match');
    if (ifNoneMatch !== undefined && matchesEtag(ifNoneMatch, etag)) {
      response.status(HttpStatus.NOT_MODIFIED);
      return;
    }
    return body;
  }
}