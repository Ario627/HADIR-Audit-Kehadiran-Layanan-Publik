import { Inject, Injectable } from '@nestjs/common';
import type { RateLimitPolicy } from './rate-limit.policy';
import { RATE_LIMIT_STORE, type RateLimitStore } from './rate-limit.store';

export interface RateLimitDecision {
  policy: RateLimitPolicy | null;
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

function remainingRatio(decision: RateLimitDecision): number {
  return decision.limit <= 0 ? 0 : decision.remaining / decision.limit;
}

@Injectable()
export class RateLimitService {
  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  async consume(
    policies: readonly RateLimitPolicy[],
    subjectFor: (policy: RateLimitPolicy) => string,
    member: string,
  ): Promise<RateLimitDecision> {
    let strictest: RateLimitDecision | null = null;

    for (const policy of policies) {
      const result = await this.store.consume({
        key: `hadir:rl:v1:${policy.name}:${subjectFor(policy)}`,
        limit: policy.limit,
        windowMs: policy.windowMs,
        member,
      });
      const decision: RateLimitDecision = {
        policy,
        allowed: result.allowed,
        limit: policy.limit,
        remaining: result.remaining,
        resetMs: result.resetMs,
      };
      if (!decision.allowed) {
        return decision;
      }
      if (strictest === null || remainingRatio(decision) < remainingRatio(strictest)) {
        strictest = decision;
      }
    }

    return (
      strictest ?? {
        policy: null,
        allowed: true,
        limit: 0,
        remaining: 0,
        resetMs: 0,
      }
    );
  }
}