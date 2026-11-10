import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AnchorTimelineQuery } from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { ok } from '../../common/http/envelope';
import { AppError } from '../../common/errors/app-error';
import { TransparencyService } from './transparency.service';

const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';
const PROOF_CACHE = 'public, max-age=60, stale-while-revalidate=300';

function parseSeq(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim().length === 0) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
    throw new AppError('VALIDATION_FAILED', {
      detail: 'Parameter seq tidak valid.',
      errors: [{ field: 'seq', code: 'invalid_seq', message: 'seq harus bilangan bulat positif.' }],
    });
  }
  return parsed;
}

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

  @Get('anchors')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.transparencyRead)
  async timeline(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(AnchorTimelineQuery, query);
    const timeline = await this.transparency.timeline(input);
    return ok(timeline, requestIdOf(request));
  }

  @Get('keys')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.transparencyRead)
  async keys(@Req() request: Request) {
    const keys = await this.transparency.publicKeys();
    return ok(keys, requestIdOf(request));
  }

  @Get('proof/:publicId')
  @Header('Cache-Control', PROOF_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.transparencyRead)
  async proof(
    @Param('publicId') publicId: string,
    @Query('seq') seq: string | undefined,
    @Req() request: Request,
  ) {
    const proof = await this.transparency.inclusionProof(publicId, parseSeq(seq));
    return ok(proof, requestIdOf(request));
  }
}
