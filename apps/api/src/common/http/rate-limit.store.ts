import { Logger } from '@nestjs/common';

export interface RateLimitInput {
  key: string;
  limit: number;
  windowMs: number;
  member: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export interface RateLimitStore {
  consume(input: RateLimitInput): Promise<RateLimitResult>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export class ResilientRateLimitStore implements RateLimitStore {
  private readonly logger = new Logger(ResilientRateLimitStore.name);
  private degradedUntil = 0;

  constructor(
    private readonly primary: RateLimitStore,
    private readonly fallback: RateLimitStore,
  ) {}

  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const now = Date.now();
    if (now >= this.degradedUntil) {
      try {
        return await this.primary.consume(input);
      } catch (error) {
        this.degradedUntil = now + 30_000;
        this.logger.warn(
          `Rate limit primer gagal; memakai fallback memori selama 30 detik. ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return this.fallback.consume(input);
  }
}