import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../../common/config/env';

function digest(prefix: string, value: string): string {
  return createHmac('sha256', env.SESSION_SECRET)
    .update(`${prefix}|${value}`)
    .digest('hex');
}

export function hashRequestFingerprint(request: Request): {
  ipHash: string | null;
  userAgentHash: string | null;
} {
  const ip = request.ip || request.socket.remoteAddress || '';
  const agent = request.get('user-agent') ?? '';
  return {
    ipHash: ip.length === 0 ? null : digest('hadir.ip.v1', ip),
    userAgentHash: agent.length === 0 ? null : digest('hadir.ua.v1', agent),
  };
}