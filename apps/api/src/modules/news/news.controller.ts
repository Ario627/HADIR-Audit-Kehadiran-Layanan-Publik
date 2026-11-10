import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../common/errors/app-error';
import { ok } from '../../common/http/envelope';
import { requestIdOf } from '../../common/http/request-context';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';
import { NEWS_CACHE_TTL_S, NEWS_MEDIA_CACHE_S, NEWS_REGIONS } from './news.constants';
import { NewsService } from './news.service';

const NEWS_CACHE = `public, s-maxage=${String(NEWS_CACHE_TTL_S)}, stale-while-revalidate=3600`;
const MEDIA_CACHE = `public, max-age=${String(NEWS_MEDIA_CACHE_S)}, immutable`;

interface NewsQuery {
  region?: string;
}

function readRegion(query: NewsQuery): string | undefined {
  const value = query.region;
  return typeof value === 'string' && Object.hasOwn(NEWS_REGIONS, value) ? value : undefined;
}

@Controller('news')
export class NewsController {
  constructor(private readonly news: NewsService) {}

  @Get()
  @Header('Cache-Control', NEWS_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async list(@Query() query: NewsQuery, @Req() request: Request) {
    const payload = await this.news.list(readRegion(query));
    return ok(payload, requestIdOf(request));
  }

  @Get('media/:token')
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  async media(@Param('token') token: string, @Res() response: Response): Promise<void> {
    const result = await this.news.media(token);
    if (result.kind === 'failed') {
      if (result.reason === 'upstream_unavailable') {
        throw new AppError('SERVICE_UNAVAILABLE', {
          detail: 'Sumber gambar sedang tidak dapat dijangkau. Coba lagi sebentar.',
          headers: { 'Retry-After': '30' },
        });
      }
      throw new AppError('NOT_FOUND', {
        detail:
          result.reason === 'invalid_token' || result.reason === 'host_not_allowed'
            ? 'Alamat gambar tidak sah.'
            : 'Gambar tidak tersedia dari sumbernya.',
      });
    }
    response.setHeader('Content-Type', result.mime);
    response.setHeader('Cache-Control', MEDIA_CACHE);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Content-Length', String(result.bytes.byteLength));
    response.end(result.bytes);
  }
}