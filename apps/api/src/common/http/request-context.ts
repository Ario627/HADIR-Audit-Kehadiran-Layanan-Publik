import type { Request } from 'express';

export type PartnerRole = 'viewer' | 'responder' | 'admin';

export type Actor =
  | { kind: 'citizen'; deviceHash: string }
  | { kind: 'partner'; userId: string; institutionId: string; role: PartnerRole };

export interface DeviceIdentity {
  hash: string;
  dayHash: string;
  isNew: boolean;
}

export interface RequestContext {
  requestId: string;
  device: DeviceIdentity | null;
  actor: Actor | null;
}

declare global {
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

export function contextOf(request: Request): RequestContext {
  if (!request.context) {
    throw new Error('Request context belum tersedia. Periksa urutan middleware.');
  }
  return request.context;
}

export function requestIdOf(request: Request): string {
  return contextOf(request).requestId;
}

export function deviceOf(request: Request): DeviceIdentity {
  const device = contextOf(request).device;
  if (!device) {
    throw new Error('Identitas perangkat belum tersedia.');
  }
  return device;
}
