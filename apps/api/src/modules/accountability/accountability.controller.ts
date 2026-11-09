import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { ok } from '../../common/http/envelope';
import { AccountabilityService } from './accountability.service';

const CASE_CACHE = 'public, max-age=60, stale-while-revalidate=300';

const PublicIdParam = z.object({
  publicId: z.string().min(6).max(40).regex(/^(LPR-[0-9]{4}-[0-9]{6})$/u),
});

@Controller('reports')
export class AccountabilityController {
  constructor(private readonly accountability: AccountabilityService) {}

  @Get(':publicId/case')
  @Header('Cache-Control', CASE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportsRead)
  async caseFile(
    @Param('publicId') publicId: string,
    @Query() _query: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const result = await this.accountability.caseFile(params.publicId);
    return ok(result, requestIdOf(request));
  }
}
