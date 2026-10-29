import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AdminAuditQuery,
  AdminChainVerifyInput,
  AdminFlagInput,
  AdminModerationInput,
  AdminNoticeInput,
  AdminNoticeQuery,
  AdminRupImportInput,
  AdminRupQuery,
} from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PlatformOnly } from '../../common/auth/platform-roles.decorator';
import { ok } from '../../common/http/envelope';
import { AdminService } from './admin.service';
import { PlatformGuard, platformSessionOf } from './platform.guard';

const NO_STORE = 'no-store, private, max-age=0';

@Controller('admin')
@UseGuards(PlatformGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('notices')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('moderator')
  async createNotice(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(AdminNoticeInput, body);
    const created = await this.admin.createNotice(
      input,
      platformSessionOf(request),
      requestIdOf(request),
    );
    return ok(created, requestIdOf(request));
  }

  @Get('notices')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async listNotices(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(AdminNoticeQuery, query);
    const result = await this.admin.listNotices(input);
    return ok(result, requestIdOf(request));
  }

  @Get('audit')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async audit(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(AdminAuditQuery, query);
    const result = await this.admin.listAudit(input);
    return ok(result, requestIdOf(request));
  }

  @Patch('reports/:publicId/moderation')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('moderator')
  async moderate(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = parseOrThrow(AdminModerationInput, body);
    const result = await this.admin.moderate(
      publicId,
      input,
      platformSessionOf(request),
      requestIdOf(request),
    );
    return ok(result, requestIdOf(request));
  }

  @Post('flags/:key')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async setFlag(
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const input = parseOrThrow(AdminFlagInput, body);
    const result = await this.admin.setFlag(
      key,
      input,
      platformSessionOf(request),
      requestIdOf(request),
    );
    return ok(result, requestIdOf(request));
  }

  @Get('flags')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async listFlags(@Req() request: Request) {
    const result = await this.admin.listFlags();
    return ok(result, requestIdOf(request));
  }

  @Post('chain/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async verifyChain(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(AdminChainVerifyInput, body);
    const result = await this.admin.verifyChain(
      input,
      platformSessionOf(request),
      requestIdOf(request),
    );
    return ok(result, requestIdOf(request));
  }

  @Post('anchor/:date')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async sealAnchor(@Param('date') date: string, @Req() request: Request) {
    const result = await this.admin.sealAnchor(
      date,
      platformSessionOf(request),
      requestIdOf(request),
    );
    return ok(result, requestIdOf(request));
  }

  @Post('rup/import')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('moderator')
  async importRup(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(AdminRupImportInput, body);
    const result = await this.admin.importRup(
      input,
      platformSessionOf(request),
      requestIdOf(request),
    );
    return ok(result, requestIdOf(request));
  }

  @Get('rup')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async listRup(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(AdminRupQuery, query);
    const result = await this.admin.listRup(input);
    return ok(result, requestIdOf(request));
  }
}
