import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  ResolutionVerifyInput,
  ResponseCreate,
  SlaBreachQuery,
} from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PlatformOnly } from '../../common/auth/platform-roles.decorator';
import { PartnerOnly } from '../../common/auth/roles.decorator';
import { SessionGuard, partnerSessionOf } from '../../common/auth/session.guard';
import { ok } from '../../common/http/envelope';
import { PlatformGuard, platformSessionOf } from '../admin/platform.guard';
import { AccountabilityService } from './accountability.service';

const NO_STORE = 'no-store, private, max-age=0';

const PublicIdParam = z.object({
  publicId: z.string().min(6).max(40).regex(/^(LPR-[0-9]{4}-[0-9]{6})$/u),
});

@Controller('partner/reports')
@UseGuards(SessionGuard)
export class PartnerAccountabilityController {
  constructor(private readonly accountability: AccountabilityService) {}

  @Get(':publicId/accountability')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async caseFile(@Param('publicId') publicId: string, @Req() request: Request) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const session = partnerSessionOf(request);
    const result = await this.accountability.partnerCaseFile(params.publicId, session);
    return ok(result, requestIdOf(request));
  }

  @Post(':publicId/responses')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerAction)
  @PartnerOnly('responder')
  async respond(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const input = parseOrThrow(ResponseCreate, body);
    const result = await this.accountability.addResponse(
      params.publicId,
      input,
      partnerSessionOf(request),
    );
    return ok(result, requestIdOf(request));
  }

}

@Controller('admin')
@UseGuards(PlatformGuard)
export class AdminAccountabilityController {
  constructor(private readonly accountability: AccountabilityService) {}

  @Get('sla/breaches')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async breaches(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(SlaBreachQuery, query);
    const items = await this.accountability.breaches(input.limit, input.minEscalation);
    return ok({ items, count: items.length }, requestIdOf(request));
  }

  @Post('reports/:publicId/resolution')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async verifyResolution(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const input = parseOrThrow(ResolutionVerifyInput, body);
    const session = platformSessionOf(request);
    const result = await this.accountability.verifyResolution(params.publicId, input, {
      adminId: session.adminId,
    });
    return ok(result, requestIdOf(request));
  }
}
