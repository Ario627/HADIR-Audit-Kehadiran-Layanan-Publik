import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CommitmentCreate,
  CommitmentModerate,
  IncidentCreate,
  Uuid,
} from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { PlatformOnly } from '../../common/auth/platform-roles.decorator';
import { ok } from '../../common/http/envelope';
import { PlatformGuard, platformSessionOf } from '../admin/platform.guard';
import { EvidenceService } from './evidence.service';

const NO_STORE = 'no-store, private, max-age=0';
const IdParam = z.object({ id: Uuid });

@Controller('admin')
@UseGuards(PlatformGuard)
export class EvidenceAdminController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post('commitments')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('moderator')
  async createCommitment(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(CommitmentCreate, body);
    const session = platformSessionOf(request);
    const created = await this.evidence.createCommitment(session.adminId, input);
    return ok(created, requestIdOf(request));
  }

  @Post('commitments/:id/verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async verifyCommitment(@Param('id') id: string, @Req() request: Request) {
    const params = parseOrThrow(IdParam, { id });
    const session = platformSessionOf(request);
    const verified = await this.evidence.verifyCommitment(session.adminId, params.id);
    return ok(verified, requestIdOf(request));
  }

  @Post('commitments/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async revokeCommitment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(IdParam, { id });
    const input = parseOrThrow(CommitmentModerate, body);
    const session = platformSessionOf(request);
    const revoked = await this.evidence.revokeCommitment(
      session.adminId,
      params.id,
      input.reason ?? 'Dicabut tanpa alasan tertulis.',
    );
    return ok(revoked, requestIdOf(request));
  }

  @Post('incidents')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('moderator')
  async createIncident(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(IncidentCreate, body);
    const created = await this.evidence.createIncident(input);
    return ok(created, requestIdOf(request));
  }
}
