import { Module } from '@nestjs/common';
import { env } from '../../common/config/env';
import { NewsCache } from './news.cache';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

@Module({
  controllers: [NewsController],
  providers: [NewsService, { provide: NewsCache, useFactory: () => new NewsCache(env.REDIS_URL) }],
  exports: [NewsService],
})
export class NewsModule {}
