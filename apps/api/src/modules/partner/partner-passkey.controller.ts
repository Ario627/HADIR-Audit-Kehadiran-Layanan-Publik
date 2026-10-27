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
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  PasskeyAuthenticationFinish,
  PasskeyRegistrationFinish,
} from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PartnerOnly } from '../../common/auth/roles.decorator';
import { SessionGuard, partnerSessionOf } from '../../common/auth/session.guard';
import { ok } from '../../common/http/envelope';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerPasskeyService } from './partner-passkey.service';
import { PartnerService } from './partner.service';
import { hashRequestFingerprint } from './partner.fingerprint';

const NO_STORE = 'no-store, private, max-age=0';

@Controller('v1/partner/passkeys')
@UseGuards(SessionGuard)
export class PartnerPasskeyController {
  constructor(
    private readonly passkeys: PartnerPasskeyService,
    private readonly auth: PartnerAuthService,
    private readonly partners: PartnerService,
  ) {}

  @Post('registration/options')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('viewer')
  async registrationOptions(@Req() request: Request) {
    const session = partnerSessionOf(request);
    const result = await this.passkeys.beginRegistration(session.userId, session.displayName);
    return ok(result, requestIdOf(request));
  }

  @Post('registration/verify')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('viewer')
  async registrationVerify(@Body() body: unknown, @Req() request: Request) {
    const session = partnerSessionOf(request);
    const input = parseOrThrow(PasskeyRegistrationFinish, body);
    await this.passkeys.finishRegistration(
      session.userId,
      input.challengeId,
      input.response as never,
      { requestId: requestIdOf(request), ...hashRequestFingerprint(request) },
    );
    return ok({ registered: true }, requestIdOf(request));
  }

  @Post('authentication/options')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerLogin)
  async authenticationOptions(@Req() request: Request) {
    const session = partnerSessionOf(request);
    const result = await this.passkeys.beginAuthentication(session.userId);
    if (!result.allowed) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Belum ada passkey terdaftar.',
      });
    }
    return ok(result, requestIdOf(request));
  }

  @Post('authentication/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('viewer')
  async authenticationVerify(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(PasskeyAuthenticationFinish, body);
    const userId = await this.passkeys.finishAuthentication(
      input.challengeId,
      input.response as never,
      { requestId: requestIdOf(request), ...hashRequestFingerprint(request) },
    );
    if (userId === null) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Passkey tidak dapat diverifikasi.' });
    }
    return ok({ verified: true, userId }, requestIdOf(request));
  }

  @Get()
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('viewer')
  async list(@Req() request: Request) {
    const session = partnerSessionOf(request);
    const result = await this.passkeys.list(session.userId);
    return ok({ passkeys: result }, requestIdOf(request));
  }

  @Delete(':passkeyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', NO_STORE)
  @PartnerOnly('admin')
  async remove(@Req() request: Request, @Param('passkeyId') passkeyId: string) {
    const session = partnerSessionOf(request);
    await this.passkeys.remove(session.userId, passkeyId);
  }
}
