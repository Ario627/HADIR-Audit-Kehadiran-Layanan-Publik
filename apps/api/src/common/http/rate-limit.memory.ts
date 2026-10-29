import type { RateLimitInput, RateLimitResult, RateLimitStore } from './rate-limit.store';

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxKeys = 10_000;
  private readonly staleMs = 86_400_000;

  private prune(now: number): void {
    for (const [key, timestamps] of this.buckets) {
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last < now - this.staleMs) {
        this.buckets.delete(key);
      }
    }
  }

  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const now = Date.now();
    const cutoff = now - input.windowMs;
    const existing = this.buckets.get(input.key) ?? [];
    const recent = existing.filter((timestamp) => timestamp > cutoff);

    if (recent.length >= input.limit) {
      const oldest = recent[0] ?? now;
      this.buckets.set(input.key, recent);
      return {
        allowed: false,
        remaining: 0,
        resetMs: Math.max(0, input.windowMs - (now - oldest)),
      };
    }

    recent.push(now);
    this.buckets.set(input.key, recent);
    if (this.buckets.size > this.maxKeys) {
      this.prune(now);
    }
    const oldest = recent[0] ?? now;
    return {
      allowed: true,
      remaining: Math.max(0, input.limit - recent.length),
      resetMs: Math.max(0, input.windowMs - (now - oldest)),
    };
  }
}