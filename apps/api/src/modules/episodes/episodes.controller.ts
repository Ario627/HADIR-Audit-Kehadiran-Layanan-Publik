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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { EndEpisodeInput, StartEpisodeInput, Uuid } from '@hadir/contracts';
import { ok } from '../../common/http/envelope';
import { idempotencyKeyOf } from '../../common/http/idempotency-key';
import { contextOf, deviceOf, requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { parseOrThrow } from '../../common/http/zod';
import { EpisodesService } from './episodes.service';

const NO_STORE = 'no-store';

@Controller('episodes')
export class EpisodesController {
  constructor(private readonly episodes: EpisodesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', NO_STORE)
  @RateLimit(
    RATE_LIMIT_POLICIES.episodeStartHourly,
    RATE_LIMIT_POLICIES.episodeStartDaily,
  )
  async start(@Body() body: unknown, @Req() request: Request) {
    const input = parseOrThrow(StartEpisodeInput, body);
    const key = idempotencyKeyOf(request);
    const device = deviceOf(request);
    const context = contextOf(request);
    const episode = await this.episodes.start(input, key, device, {
      requestId: context.requestId,
      deviceHash: device.hash,
    });
    return ok(episode, requestIdOf(request));
  }

  @Patch(':id')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.episodeUpdateHourly)
  async end(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    const episodeId = parseOrThrow(Uuid, id);
    const input = parseOrThrow(EndEpisodeInput, body);
    const key = idempotencyKeyOf(request);
    const device = deviceOf(request);
    const context = contextOf(request);
    const episode = await this.episodes.end(episodeId, input, key, device, {
      requestId: context.requestId,
      deviceHash: device.hash,
    });
    return ok(episode, requestIdOf(request));
  }

  @Get('active')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.episodeRead)
  async active(@Req() request: Request) {
    const device = deviceOf(request);
    const episode = await this.episodes.active(device);
    return ok(episode, requestIdOf(request));
  }

  @Get(':id')
  @Header('Cache-Control', NO_STORE)
  @RateLimit(RATE_LIMIT_POLICIES.episodeRead)
  async get(@Param('id') id: string, @Req() request: Request) {
    const episodeId = parseOrThrow(Uuid, id);
    const device = deviceOf(request);
    const episode = await this.episodes.get(episodeId, device);
    return ok(episode, requestIdOf(request));
  }
}