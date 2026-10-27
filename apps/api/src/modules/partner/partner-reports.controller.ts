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
import { PartnerActionInput, PartnerInboxQuery } from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { contextOf, requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PartnerOnly } from '../../common/auth/roles.decorator';
import { SessionGuard, partnerSessionOf } from '../../common/auth/session.guard';
import { ok } from '../../common/http/envelope';
import { idempotencyKeyOf } from '../../common/http/idempotency-key';
import { ReportsService } from '../reports/reports.service';

const NO_STORE = 'no-store, private, max-age=0';

@Controller('v1/partner/reports')
@UseGuards(SessionGuard)
export class PartnerReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async inbox(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(PartnerInboxQuery, query);
    const result = await this.reports.listInbox(input, partnerSessionOf(request));
    return ok(result, requestIdOf(request));
  }

  @Get(':publicId')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async detail(@Param('publicId') publicId: string, @Req() request: Request) {
    const result = await this.reports.inboxDetail(publicId, partnerSessionOf(request));
    return ok(result, requestIdOf(request));
  }

  @Post(':publicId/action')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerAction)
  @PartnerOnly('responder')
  async act(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = parseOrThrow(PartnerActionInput, body);
    const context = contextOf(request);
    const session = partnerSessionOf(request);
    const result = await this.reports.partnerAction(publicId, input, idempotencyKeyOf(request), session, {
      requestId: context.requestId,
      deviceHash: session.userId,
    });
    return ok(result, requestIdOf(request));
  }
}
