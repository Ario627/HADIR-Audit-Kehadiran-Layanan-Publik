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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  PartnerAnalyticsQuery,
  PartnerExportInput,
  PartnerExportListQuery,
  Uuid,
} from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PartnerOnly } from '../../common/auth/roles.decorator';
import { SessionGuard, partnerSessionOf } from '../../common/auth/session.guard';
import { ok } from '../../common/http/envelope';
import { AppError } from '../../common/errors/app-error';
import { PartnerAnalyticsService } from './partner-analytics.service';
import { PartnerExportsService } from './partner-exports.service';

const NO_STORE = 'no-store, private, max-age=0';

@Controller('partner')
@UseGuards(SessionGuard)
export class PartnerExportsController {
  constructor(
    private readonly exportsService: PartnerExportsService,
    private readonly analytics: PartnerAnalyticsService,
  ) {}

  @Post('exports')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerExport)
  @PartnerOnly('responder')
  async create(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(PartnerExportInput, body);
    const session = partnerSessionOf(request);
    const ticket = await this.exportsService.create(
      input,
      session,
      requestIdOf(request),
    );
    return ok(ticket, requestIdOf(request));
  }

  @Get('exports')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async list(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(PartnerExportListQuery, query);
    const items = await this.exportsService.list(partnerSessionOf(request), input.limit);
    return ok({ items }, requestIdOf(request));
  }

  @Get('exports/:exportId')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async detail(@Param('exportId') exportId: string, @Req() request: Request) {
    const id = parseOrThrow(Uuid, exportId);
    const detail = await this.exportsService.detail(id, partnerSessionOf(request));
    return ok(detail, requestIdOf(request));
  }

  @Get('exports/:exportId/download')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  async download(
    @Param('exportId') exportId: string,
    @Query() query: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const id = parseOrThrow(Uuid, exportId);
    const params = query as Record<string, unknown>;
    const exp = typeof params.exp === 'string' ? Number(params.exp) : NaN;
    const sig = typeof params.sig === 'string' ? params.sig : '';
    if (!Number.isFinite(exp) || sig.length === 0) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Tautan unduh tidak valid.' });
    }

    const object = await this.exportsService.readObjectWithSignature({
      exportId: id,
      expiresAtMs: exp,
      signature: sig,
      now: new Date(),
    });

    response.setHeader(
      'Content-Type',
      object.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="hadir-export-${id}.${object.format === 'csv' ? 'csv' : 'json'}"`,
    );
    response.setHeader('Content-Length', String(object.bytes.length));
    response.status(HttpStatus.OK).end(object.bytes);
  }

  @Get('analytics')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async summary(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(PartnerAnalyticsQuery, query);
    const result = await this.analytics.compute(input, partnerSessionOf(request));
    return ok(result, requestIdOf(request));
  }
}
