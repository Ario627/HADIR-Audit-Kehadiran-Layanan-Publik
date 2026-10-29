import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { QrQuery, StopCode } from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { QrLandingService } from './qr-landing.service';

@Controller('s')
export class QrLandingController {
  constructor(private readonly landingService: QrLandingService) {}

  @Get(':stopCode')
  @Header('Cache-Control', 'no-store')
  @RateLimit(RATE_LIMIT_POLICIES.qrLanding)
  async landing(
    @Param('stopCode') rawStopCode: string,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    const stopCode = parseOrThrow(StopCode, rawStopCode);
    const proof = parseOrThrow(QrQuery, query);
    const result = await this.landingService.landing(stopCode, {
      epoch: proof.e,
      keyId: proof.k,
      signature: proof.s,
    });
    return ok(result, requestIdOf(request));
  }
}