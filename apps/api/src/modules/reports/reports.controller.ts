import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CorroborateInput,
  CreateReportInput,
  ListReportsQuery,
  MyReportsQuery,
  Uuid,
  VerifyClosureInput,
} from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { idempotencyKeyOf } from '../../common/http/idempotency-key';
import { contextOf, deviceOf, requestIdOf } from '../../common/http/request-context';
import { transactionContextFor } from '../../common/http/transaction-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { ReportsMediaService } from './reports.media.service';
import { ReportsService } from './reports.service';

const NO_STORE = 'no-store';
const PUBLIC_CACHE = 'public, s-maxage=60, stale-while-revalidate=300';
const MEDIA_CACHE = 'public, max-age=300, stale-while-revalidate=3600';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly media: ReportsMediaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(
    RATE_LIMIT_POLICIES.reportHourly,
    RATE_LIMIT_POLICIES.reportDaily,
    RATE_LIMIT_POLICIES.reportCreateIp,
  )
  async create(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(CreateReportInput, body);
    const key = idempotencyKeyOf(request);
    const device = deviceOf(request);
    const context = contextOf(request);
    const result = await this.reports.create(input, key, device, transactionContextFor(context));
    return ok(result, requestIdOf(request));
  }

  @Get('mine')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.deviceRead)
  async mine(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(MyReportsQuery, query);
    const device = deviceOf(request);
    const result = await this.reports.listMine(input, device);
    return ok(result.items, requestIdOf(request), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }

  @Get('mine/:publicId/media')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.reportMediaRead)
  async mineMedia(@Param('publicId') publicId: string, @Req() request: Request) {
    const items = await this.media.list(publicId, contextOf(request).actor);
    return ok({ items }, requestIdOf(request));
  }

  @Delete('mine/:publicId/consent')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.reportAction)
  async withdrawConsent(@Param('publicId') publicId: string, @Req() request: Request) {
    const device = deviceOf(request);
    const result = await this.reports.withdrawConsent(publicId, device, requestIdOf(request));
    return ok(result, requestIdOf(request));
  }

  @Get('mine/:publicId')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.deviceRead)
  async mineDetail(@Param('publicId') publicId: string, @Req() request: Request) {
    const device = deviceOf(request);
    const report = await this.reports.mineDetail(publicId, device);
    return ok(report, requestIdOf(request));
  }

  @Get()
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportsRead)
  async list(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(ListReportsQuery, query);
    const result = await this.reports.listPublic(input);
    return ok(result.items, requestIdOf(request), {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    });
  }

  @Get(':publicId/media')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportMediaRead)
  async publicMedia(@Param('publicId') publicId: string, @Req() request: Request) {
    const items = await this.media.list(publicId, contextOf(request).actor);
    return ok({ items }, requestIdOf(request));
  }

  @Get(':publicId/media/:mediaId')
  @Header('Cache-Control', MEDIA_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportMediaRead)
  async serveMedia(
    @Param('publicId') publicId: string,
    @Param('mediaId') mediaId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const id = parseOrThrow(Uuid, mediaId);
    const object = await this.media.read(publicId, id, contextOf(request).actor);
    response.setHeader('Content-Type', object.mime);
    response.setHeader('Content-Length', String(object.bytes.length));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; sandbox",
    );
    response.status(HttpStatus.OK).end(object.bytes);
  }

  @Get(':publicId')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportsRead)
  async detail(@Param('publicId') publicId: string, @Req() request: Request) {
    const report = await this.reports.publicDetail(publicId);
    return ok(report, requestIdOf(request));
  }

  @Post(':publicId/corroborate')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.reportAction)
  async corroborate(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = parseOrThrow(CorroborateInput, body);
    const key = idempotencyKeyOf(request);
    const device = deviceOf(request);
    const context = contextOf(request);
    const result = await this.reports.corroborate(publicId, input, key, device, transactionContextFor(context));
    return ok(result, requestIdOf(request));
  }

  @Post(':publicId/verify-closure')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.reportAction)
  async verifyClosure(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = parseOrThrow(VerifyClosureInput, body);
    const key = idempotencyKeyOf(request);
    const device = deviceOf(request);
    const context = contextOf(request);
    const result = await this.reports.verifyClosure(publicId, input, key, device, transactionContextFor(context));
    return ok(result, requestIdOf(request));
  }
}
