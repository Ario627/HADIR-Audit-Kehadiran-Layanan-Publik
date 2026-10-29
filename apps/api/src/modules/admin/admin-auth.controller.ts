import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminLoginInput } from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { contextOf, requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PlatformOnly } from '../../common/auth/platform-roles.decorator';
import { ok } from '../../common/http/envelope';
import { hashRequestFingerprint } from '../partner/partner.fingerprint';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformGuard, platformSessionOf } from './platform.guard';

const NO_STORE = 'no-store, private, max-age=0';

@Controller('admin')
@UseGuards(PlatformGuard)
export class AdminAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminLogin)
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseOrThrow(AdminLoginInput, body);
    const context = contextOf(request);
    const fingerprint = hashRequestFingerprint(request);
    const issued = await this.auth.login({
      email: input.email,
      password: input.password,
      totp: input.totp,
      requestId: context.requestId,
      ipHash: fingerprint.ipHash,
      userAgentHash: fingerprint.userAgentHash,
    });
    response.cookie(this.auth.cookieName(), issued.token, this.auth.cookieOptions());
    return ok(
      {
        adminId: issued.session.adminId,
        email: issued.session.email,
        displayName: issued.session.displayName,
        role: issued.session.role,
        expiresAt: issued.session.expiresAt.toISOString(),
      },
      requestIdOf(request),
    );
  }

  @Get('me')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async me(@Req() request: Request) {
    const session = platformSessionOf(request);
    return ok(
      {
        adminId: session.adminId,
        email: session.email,
        displayName: session.displayName,
        role: session.role,
        expiresAt: session.expiresAt.toISOString(),
      },
      requestIdOf(request),
    );
  }

  @Delete('sessions/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('moderator')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const session = platformSessionOf(request);
    await this.auth.logout(session, requestIdOf(request));
    response.clearCookie(this.auth.cookieName(), this.auth.clearedCookieOptions());
  }
}
