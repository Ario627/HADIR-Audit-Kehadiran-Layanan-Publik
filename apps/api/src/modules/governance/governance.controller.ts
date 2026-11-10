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
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  AppealCreate,
  AppealDecisionInput,
  AppealQueueQuery,
  CitySlaOverrideInput,
  InstitutionScorecardList,
  PanelInviteInput,
  ScorecardQuery,
  Uuid,
} from '@hadir/contracts';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { deviceOf, requestIdOf } from '../../common/http/request-context';
import { parseOrThrow } from '../../common/http/zod';
import { ok } from '../../common/http/envelope';
import { PlatformOnly } from '../../common/auth/platform-roles.decorator';
import { PartnerOnly } from '../../common/auth/roles.decorator';
import { SessionGuard, partnerSessionOf } from '../../common/auth/session.guard';
import { PlatformGuard, platformSessionOf } from '../admin/platform.guard';
import { GovernanceService } from './governance.service';

const NO_STORE = 'no-store, private, max-age=0';
const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=3600';
const DEVICE_CACHE = 'private, max-age=0, must-revalidate';

const PublicIdParam = z.object({
  publicId: z.string().min(6).max(40).regex(/^(LPR-[0-9]{4}-[0-9]{6})$/u),
});
const UuidParam = z.object({ institutionId: Uuid });
const AppealParam = z.object({ appealId: Uuid });
const CityParam = z.object({ cityId: Uuid });
const LimitQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
const ScorecardListQuery = z
  .object({
    cityId: Uuid.optional(),
    windowDays: z.coerce.number().int().min(30).max(365).default(90),
  })
  .strict();

@Controller()
export class GovernancePublicController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('reports/:publicId/panel')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportsRead)
  async panel(@Param('publicId') publicId: string, @Req() request: Request) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const result = await this.governance.panel(params.publicId, null);
    return ok(result, requestIdOf(request));
  }

  @Get('institutions/:institutionId/scorecard')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportsRead)
  async scorecard(
    @Param('institutionId') institutionId: string,
    @Query() query: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(UuidParam, { institutionId });
    const input = parseOrThrow(ScorecardQuery, query);
    const result = await this.governance.scorecard(
      params.institutionId,
      input.windowDays,
    );
    return ok(result, requestIdOf(request));
  }

  @Get('institutions')
  @Header('Cache-Control', PUBLIC_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportsRead)
  async institutions(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(ScorecardListQuery, query);
    const result: InstitutionScorecardList = await this.governance.scorecards(
      input.cityId ?? null,
      input.windowDays,
    );
    return ok(result, requestIdOf(request));
  }
}

@Controller('reports')
@UseGuards(SessionGuard)
export class GovernanceCitizenAppealController {
  constructor(private readonly governance: GovernanceService) {}

  @Post(':publicId/appeals')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', DEVICE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportAction)
  async submit(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const input = parseOrThrow(AppealCreate, body);
    const result = await this.governance.submitAppeal(
      params.publicId,
      input,
      deviceOf(request),
    );
    return ok(result, requestIdOf(request));
  }

  @Get(':publicId/appeals')
  @Header('Cache-Control', DEVICE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportAction)
  async list(@Param('publicId') publicId: string, @Req() request: Request) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const items = await this.governance.reportAppeals(
      params.publicId,
      deviceOf(request),
    );
    return ok({ items, count: items.length }, requestIdOf(request));
  }
}

@Controller('appeals')
@UseGuards(SessionGuard)
export class GovernanceMyAppealController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('mine')
  @Header('Cache-Control', DEVICE_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.reportAction)
  async mine(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(LimitQuery, query);
    const items = await this.governance.myAppeals(deviceOf(request), input.limit);
    return ok({ items, count: items.length }, requestIdOf(request));
  }
}

@Controller('partner/panel')
@UseGuards(SessionGuard)
export class GovernancePanelController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('reports')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async reports(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(LimitQuery, query);
    const result = await this.governance.partnerPanelReports(
      partnerSessionOf(request),
      input.limit,
    );
    return ok(result, requestIdOf(request));
  }

  @Get('reports/:publicId')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerRead)
  @PartnerOnly('viewer')
  async detail(@Param('publicId') publicId: string, @Req() request: Request) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const session = partnerSessionOf(request);
    const result = await this.governance.panel(params.publicId, session.institutionId);
    return ok(result, requestIdOf(request));
  }

  @Post('reports/:publicId/verdict')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.partnerAction)
  @PartnerOnly('responder')
  async verdict(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const VerdictInput = z
      .object({
        method: z.enum(['field_inspection', 'panel_review']),
        verdict: z.enum(['confirmed', 'refuted', 'inconclusive']),
        note: z.string().trim().max(400).optional(),
        evidenceUrls: z.array(z.url().max(500)).max(5).default([]),
      })
      .strict();
    const input = parseOrThrow(VerdictInput, body);
    const result = await this.governance.verifyAsPanel(
      params.publicId,
      input,
      partnerSessionOf(request),
    );
    return ok(result, requestIdOf(request));
  }
}

@Controller('admin')
@UseGuards(PlatformGuard)
export class GovernanceAdminController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('reports/:publicId/panel')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async panel(@Param('publicId') publicId: string, @Req() request: Request) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const result = await this.governance.panel(params.publicId, null);
    return ok(result, requestIdOf(request));
  }

  @Get('reports/:publicId/panel/candidates')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('superadmin')
  async candidates(@Param('publicId') publicId: string, @Req() request: Request) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const result = await this.governance.panelCandidates(params.publicId);
    return ok(result, requestIdOf(request));
  }

  @Post('reports/:publicId/panel')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async grant(
    @Param('publicId') publicId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const input = parseOrThrow(PanelInviteInput, body);
    const session = platformSessionOf(request);
    const result = await this.governance.invitePanelMember(
      params.publicId,
      input,
      session.adminId,
    );
    return ok(result, requestIdOf(request));
  }

  @Delete('reports/:publicId/panel/:institutionId')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async revoke(
    @Param('publicId') publicId: string,
    @Param('institutionId') institutionId: string,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(PublicIdParam, { publicId });
    const target = parseOrThrow(UuidParam, { institutionId });
    const session = platformSessionOf(request);
    const result = await this.governance.revokePanelMember(
      params.publicId,
      target.institutionId,
      session.adminId,
    );
    return ok(result, requestIdOf(request));
  }

  @Get('appeals')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async appeals(@Query() query: unknown, @Req() request: Request) {
    const input = parseOrThrow(AppealQueueQuery, query);
    const items = await this.governance.appealQueue(input);
    return ok({ items, count: items.length }, requestIdOf(request));
  }

  @Post('appeals/:appealId/decision')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async decide(
    @Param('appealId') appealId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(AppealParam, { appealId });
    const input = parseOrThrow(AppealDecisionInput, body);
    const session = platformSessionOf(request);
    const result = await this.governance.decideAppeal(
      params.appealId,
      input,
      session.adminId,
    );
    return ok(result, requestIdOf(request));
  }

  @Get('cities/:cityId/sla')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminRead)
  @PlatformOnly('moderator')
  async citySla(@Param('cityId') cityId: string, @Req() request: Request) {
    const params = parseOrThrow(CityParam, { cityId });
    const items = await this.governance.citySlaOverrides(params.cityId);
    return ok({ items, count: items.length }, requestIdOf(request));
  }

  @Put('cities/:cityId/sla')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.adminMutation)
  @PlatformOnly('superadmin')
  async setCitySla(
    @Param('cityId') cityId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const params = parseOrThrow(CityParam, { cityId });
    const input = parseOrThrow(CitySlaOverrideInput, body);
    const session = platformSessionOf(request);
    const result = await this.governance.upsertCitySlaOverride(
      params.cityId,
      input,
      session.adminId,
    );
    return ok(result, requestIdOf(request));
  }
}
