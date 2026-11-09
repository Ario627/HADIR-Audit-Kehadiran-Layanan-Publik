import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PartnerInviteCreate, PartnerMemberUpdate, Uuid } from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PartnerOnly } from '../../common/auth/roles.decorator';
import { SessionGuard, partnerSessionOf } from '../../common/auth/session.guard';
import { ok } from '../../common/http/envelope';
import { PartnerMembersService } from './partner-members.service';

const NO_STORE = 'no-store, private, max-age=0';
const IdParam = z.object({ membershipId: Uuid });
const InviteParam = z.object({ inviteId: Uuid });

@Controller('partner/members')
@UseGuards(SessionGuard)
export class PartnerMembersController {
  constructor(private readonly members: PartnerMembersService) {}

  @Get()
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async list(@Req() request: Request) {
    const result = await this.members.list(partnerSessionOf(request));
    return ok(result, requestIdOf(request));
  }

  @Get('invites')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('admin')
  async invites(@Req() request: Request) {
    const result = await this.members.listInvites(partnerSessionOf(request));
    return ok({ items: result, count: result.length }, requestIdOf(request));
  }

  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerAction)
  @PartnerOnly('admin')
  async invite(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(PartnerInviteCreate, body);
    const result = await this.members.invite(input, partnerSessionOf(request));
    return ok(result, requestIdOf(request));
  }

  @Delete('invites/:inviteId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerAction)
  @PartnerOnly('admin')
  async revokeInvite(
    @Param('inviteId') inviteId: string,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(InviteParam, { inviteId });
    const result = await this.members.revokeInvite(
      params.inviteId,
      partnerSessionOf(request),
    );
    return ok(result, requestIdOf(request));
  }

  @Patch(':membershipId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerAction)
  @PartnerOnly('admin')
  async changeRole(
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(IdParam, { membershipId });
    const input = parseOrThrow(PartnerMemberUpdate, body);
    const result = await this.members.changeRole(
      params.membershipId,
      input.role,
      partnerSessionOf(request),
    );
    return ok(result, requestIdOf(request));
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerAction)
  @PartnerOnly('admin')
  async revoke(
    @Param('membershipId') membershipId: string,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(IdParam, { membershipId });
    const result = await this.members.revoke(
      params.membershipId,
      partnerSessionOf(request),
    );
    return ok(result, requestIdOf(request));
  }
}
