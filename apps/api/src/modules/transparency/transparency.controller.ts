import { Controller, Get, Header, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { ok } from '../../common/http/envelope';
import { TransparencyService } from './transparency.service';

const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

@Controller('transparency')
export class TransparencyController {
  constructor(private readonly transparency: TransparencyService) {}

  @Get('anchor/:date')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.transparencyRead)
  async anchor(@Param('date') date: string, @Req() request: Request) {
    const anchor = await this.transparency.readAnchor(date);
    return ok(anchor, requestIdOf(request));
  }
}
