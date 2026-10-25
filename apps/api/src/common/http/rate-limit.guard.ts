import { createHmac, randomUUID } from 'node:crypto';
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { env } from '../config/env';
import { AppError } from '../errors/app-error';
import { isSafeMethod } from './http-methods';
import {
  DEFAULT_MUTATION_POLICY,
  RATE_LIMIT_KEY,
  SKIP_RATE_LIMIT_KEY,
  type RateLimitPolicy,
} from './rate-limit.policy';
import { RateLimitService, type RateLimitDecision } from './rate-limit.service';

function hashSubject(value: string): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`hadir.rl.subject.v1|${value}`)
    .digest('hex')
    .slice(0, 32);
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}

function ipSubject(request: Request): string {
  return hashSubject(`ip|${clientIp(request)}`);
}

function deviceSubject(request: Request): string {
  const device = request.context?.device;
  return device && !device.isNew ? device.hash : ipSubject(request);
}

function subjectFor(policy: RateLimitPolicy, request: Request): string {
  switch (policy.scope) {
    case 'ip':
      return ipSubject(request);
    case 'device':
      return deviceSubject(request);
    case 'device+ip':
      return `${deviceSubject(request)}:${ipSubject(request)}`;
    case 'user': {
      const actor = request.context?.actor;
      if (actor?.kind === 'partner') {
        return hashSubject(`user|${actor.userId}`);
      }
      return deviceSubject(request);
    }
  }
}

function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const resetSeconds = Math.max(1, Math.ceil(decision.resetMs / 1_000));
  return {
    'RateLimit-Limit': String(decision.limit),
    'RateLimit-Remaining': String(decision.remaining),
    'RateLimit-Reset': String(resetSeconds),
    ...(decision.allowed ? {} : { 'Retry-After': String(resetSeconds) }),
  };
}

function applyHeaders(response: Response, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip === true) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const configured = this.reflector.getAllAndOverride<readonly RateLimitPolicy[]>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    const policies =
      configured ?? (isSafeMethod(request.method) ? [] : [DEFAULT_MUTATION_POLICY]);

    if (policies.length === 0) {
      return true;
    }

    const decision = await this.limiter.consume(
      policies,
      (policy) => subjectFor(policy, request),
      randomUUID(),
    );
    const headers = rateLimitHeaders(decision);
    applyHeaders(response, headers);

    if (!decision.allowed) {
      throw new AppError('RATE_LIMITED', {
        detail: 'Batas permintaan tercapai. Coba lagi nanti.',
        headers,
      });
    }
    return true;
  }
}