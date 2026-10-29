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
import { PartnerOtpRequest, PartnerPasswordChange, PartnerSessionInput } from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { contextOf, requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PartnerOnly, RequireFresh } from '../../common/auth/roles.decorator';
import { SessionGuard, partnerSessionOf } from '../../common/auth/session.guard';
import { ok } from '../../common/http/envelope';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerService } from './partner.service';
import { PartnerOtpService } from './partner-otp.service';
import { hashRequestFingerprint } from './partner.fingerprint';

const NO_STORE = 'no-store, private, max-age=0';

@Controller('partner')
@UseGuards(SessionGuard)
export class PartnerController {
  constructor(
    private readonly service: PartnerService,
    private readonly auth: PartnerAuthService,
    private readonly otp: PartnerOtpService,
  ) {}

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerLogin)
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseOrThrow(PartnerSessionInput, body);
    const context = contextOf(request);
    const issued = await this.service.login(input, {
      requestId: context.requestId,
      ...hashRequestFingerprint(request),
    });
    response.cookie(this.auth.cookieName(), issued.token, this.auth.sessionCookieOptions());
    return ok(this.service.me(issued.session), requestIdOf(request));
  }

  @Post('otp')
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerOtp)
  async requestOtp(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(PartnerOtpRequest, body);
    const context = contextOf(request);
    const identity = await this.service.resolveIdentity(input.email);
    const issued = await this.otp.issue({
      email: input.email,
      userId: identity?.userId ?? null,
      requestId: context.requestId,
      ipHash: hashRequestFingerprint(request).ipHash,
    });
    return ok(
      { expiresInSeconds: issued.expiresInSeconds, resendInSeconds: issued.resendInSeconds },
      requestIdOf(request),
    );
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerPassword)
  @PartnerOnly('viewer')
  @RequireFresh()
  async changePassword(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(PartnerPasswordChange, body);
    const session = partnerSessionOf(request);
    const revoked = await this.service.changePassword(
      session,
      input.currentPassword,
      input.newPassword,
      { requestId: requestIdOf(request), ...hashRequestFingerprint(request) },
    );
    return ok({ changed: true, revokedSessions: revoked }, requestIdOf(request));
  }

  @Get('me')
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('viewer')
  me(@Req() request: Request) {
    return ok(this.service.me(partnerSessionOf(request)), requestIdOf(request));
  }

  @Delete('sessions/current')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('viewer')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.service.logout(partnerSessionOf(request), requestIdOf(request));
    response.clearCookie(this.auth.cookieName(), { path: '/' });
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('admin')
  @RequireFresh()
  async revokeAll(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = partnerSessionOf(request);
    const revoked = await this.service.revokeUserSessions(session.userId, requestIdOf(request));
    response.clearCookie(this.auth.cookieName(), { path: '/' });
    return ok({ revoked }, requestIdOf(request));
  }

  @Get('roles')
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('viewer')
  roles(@Req() request: Request) {
    const session = partnerSessionOf(request);
    return ok({ role: session.role, institutionId: session.institutionId }, requestIdOf(request));
  }

  @Get('session')
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('viewer')
  session(@Req() request: Request) {
    const session = partnerSessionOf(request);
    if (session.sessionId.length === 0) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Sesi mitra tidak valid.' });
    }
    return ok({ createdAt: session.createdAt.toISOString() }, requestIdOf(request));
  }
}
