import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  CommitmentHistoryQuery,
  CommitmentQuery,
  ContextQuery,
  EvidenceQuery,
  Uuid,
} from '@hadir/contracts';
import { z } from 'zod';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { ok } from '../../common/http/envelope';
import { EvidenceService } from './evidence.service';

const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';
const CONTEXT_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const EVIDENCE_CACHE = 'public, max-age=120, stale-while-revalidate=600';

const StopParam = z.object({ stopId: Uuid });

@Controller()
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get('commitments')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async commitments(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(CommitmentQuery, query);
    const items = await this.evidence.listCommitments(input);
    return ok({ items, count: items.length }, requestIdOf(request));
  }

  @Get('commitments/history')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async history(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(CommitmentHistoryQuery, query);
    const items = await this.evidence.commitmentHistory(input);
    return ok({ items, count: items.length }, requestIdOf(request));
  }

  @Get('context')
  @Header('Cache-Control', CONTEXT_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async context(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(ContextQuery, query);
    const timeline = await this.evidence.context(input);
    return ok(timeline, requestIdOf(request));
  }

  @Get('stops/:stopId/evidence')
  @Header('Cache-Control', EVIDENCE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.coverageRead)
  async evidencePack(
    @Param('stopId') stopId: string,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(StopParam, { stopId });
    const input = parseOrThrow(EvidenceQuery, query);
    const pack = await this.evidence.evidencePack(params.stopId, input);
    return ok(pack, requestIdOf(request));
  }
}
