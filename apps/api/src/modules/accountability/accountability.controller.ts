import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Request } from 'express';
import { Uuid } from '@hadir/contracts';
import { z } from 'zod';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { deviceOf, requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { ok } from '../../common/http/envelope';
import { AccountabilityService } from './accountability.service';

const CASE_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const CASE_PRIVATE = 'private, no-store';

const PublicIdParam = z.object({
  publicId: z.string().min(6).max(40).regex(/^(LPR-[0-9]{4}-[0-9]{6})$/u),
});

const ResponseParam = z.object({ responseId: Uuid });

@Controller('reports')
export class AccountabilityController {
  constructor(private readonly accountability: AccountabilityService) {}

  @Get(':publicId/case')
  @RateLimit(RATE_LIMIT_POLICIES.reportsRead)
  async caseFile(
    @Param('publicId') publicId: string,
    @Query() _query: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const device = deviceOf(request);
    const ownScope = device.isNew ? undefined : device.hash;
    response.setHeader('Cache-Control', ownScope === undefined ? CASE_CACHE : CASE_PRIVATE);
    response.setHeader('Vary', 'Cookie');
    const result = await this.accountability.caseFile(
      params.publicId,
      ...(ownScope === undefined ? [] : [ownScope]),
    );
    return ok(result, requestIdOf(request));
  }

  @Get(':publicId/responses/:responseId/attestation')
  @Header('Cache-Control', CASE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportsRead)
  async responseAttestation(
    @Param('publicId') publicId: string,
    @Param('responseId') responseId: string,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const target = parseOrThrow(ResponseParam, { responseId });
    const result = await this.accountability.responseAttestation(
      params.publicId,
      target.responseId,
    );
    return ok(result, requestIdOf(request));
  }
}
