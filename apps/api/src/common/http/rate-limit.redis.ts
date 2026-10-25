import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';
import type { RateLimitInput, RateLimitResult, RateLimitStore } from './rate-limit.store';

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset = window
  if oldest[2] then
    reset = window - (now - tonumber(oldest[2]))
    if reset < 0 then reset = 0 end
  end
  return {0, 0, reset}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = window
if oldest[2] then
  reset = window - (now - tonumber(oldest[2]))
  if reset < 0 then reset = 0 end
end
return {1, limit - count - 1, reset}
`;

function parseReply(reply: unknown): RateLimitResult {
  if (!Array.isArray(reply) || reply.length < 3) {
    throw new Error('Respons rate limit Redis tidak valid.');
  }
  const [allowed, remaining, resetMs] = reply;
  if (
    typeof allowed !== 'number' ||
    typeof remaining !== 'number' ||
    typeof resetMs !== 'number'
  ) {
    throw new Error('Tipe respons rate limit Redis tidak valid.');
  }
  return {
    allowed: allowed === 1,
    remaining: Math.max(0, remaining),
    resetMs: Math.max(0, resetMs),
  };
}

export class RedisRateLimitStore implements RateLimitStore, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  private client: RedisClientType | null = null;

  constructor(private readonly url: string) {}

  async onModuleInit(): Promise<void> {
    const client = createClient({
      url: this.url,
      socket: {
        connectTimeout: 1_000,
        reconnectStrategy: (retries) => Math.min(retries * 100, 2_000),
      },
    });
    client.on('error', (error: unknown) => {
      this.logger.warn(
        `Redis rate limit error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    try {
      await client.connect();
      this.client = client;
    } catch (error) {
      this.logger.warn(
        `Redis rate limit tidak tersedia saat boot; memakai fallback memori. ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      try {
        client.destroy();
      } catch {
        this.logger.debug('Redis client sudah tertutup.');
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) {
      return;
    }
    if (client.isOpen) {
      try {
        await client.quit();
      } catch {
        client.destroy();
      }
      return;
    }
    client.destroy();
  }

  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const client = this.client;
    if (!client?.isOpen) {
      throw new Error('Redis rate limit store belum terhubung.');
    }
    const reply = await client.eval(SLIDING_WINDOW_SCRIPT, {
      keys: [input.key],
      arguments: [
        String(Date.now()),
        String(input.windowMs),
        String(input.limit),
        input.member,
      ],
    });
    return parseReply(reply);
  }
}