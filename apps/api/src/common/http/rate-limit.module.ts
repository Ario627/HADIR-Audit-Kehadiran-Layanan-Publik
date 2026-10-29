import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';
import { MemoryRateLimitStore } from './rate-limit.memory';
import {
  RATE_LIMIT_STORE,
  ResilientRateLimitStore,
  type RateLimitStore,
} from './rate-limit.store';
import { RedisRateLimitStore } from './rate-limit.redis';

@Global()
@Module({
  providers: [
    {
      provide: MemoryRateLimitStore,
      useFactory: () => new MemoryRateLimitStore(),
    },
    {
      provide: RedisRateLimitStore,
      useFactory: () => new RedisRateLimitStore(env.REDIS_URL),
    },
    {
      provide: RATE_LIMIT_STORE,
      useFactory: (
        memory: MemoryRateLimitStore,
        redis: RedisRateLimitStore,
      ): RateLimitStore => new ResilientRateLimitStore(redis, memory),
      inject: [MemoryRateLimitStore, RedisRateLimitStore],
    },
    {
      provide: RateLimitService,
      useFactory: (store: RateLimitStore) => new RateLimitService(store),
      inject: [RATE_LIMIT_STORE],
    },
    RateLimitGuard,
  ],
  exports: [RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}