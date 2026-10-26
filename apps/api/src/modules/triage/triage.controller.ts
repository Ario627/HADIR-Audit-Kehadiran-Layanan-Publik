import { Body, Controller, Get, Header, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TriageInput, Uuid } from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { idempotencyKeyOf } from '../../common/http/idempotency-key';
import { contextOf, deviceOf, requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { TriageService } from './triage.service';

const NO_STORE = 'no-store';
const RULES_CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';

@Controller('triage')
export class TriageController {
  constructor(private readonly triage: TriageService) {}

  @Post()
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.triage)
  async decide(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(TriageInput, body);
    const key = idempotencyKeyOf(request);
    const device = deviceOf(request);
    const context = contextOf(request);
    const result = await this.triage.triage(input, key, device, {
      requestId: context.requestId,
      deviceHash: device.hash,
    });
    return ok(result, requestIdOf(request));
  }

  @Get('rules')
  @Header('Cache-Control', RULES_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.triageRead)
  rules(@Req() request: Request) {
    return ok(this.triage.rules(), requestIdOf(request));
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.triageRead)
  async session(@Param('id') id: string, @Req() request: Request) {
    const sessionId = parseOrThrow(Uuid, id);
    const device = deviceOf(request);
    const session = await this.triage.getSession(sessionId, device);
    return ok(session, requestIdOf(request));
  }
}
