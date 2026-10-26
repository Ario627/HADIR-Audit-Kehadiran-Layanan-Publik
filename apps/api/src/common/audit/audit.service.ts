import { Injectable, Logger } from '@nestjs/common';
import { AuditRepository } from '../../db/repositories/audit.repository';
import type { Actor } from '../http/request-context';
import type { AuditAction, AuditObjectType } from './audit.actions';
import { toAuditActor } from './audit.actor';
import { sanitizeAuditPayload } from './audit.payload';

export interface AuditInput {
  action: AuditAction;
  objectType: AuditObjectType;
  objectId?: string | null;
  actor?: Actor | null;
  requestId?: string | null;
  ipHash?: string | null;
  payload?: Record<string, unknown>;
}

export interface AuditDenialInput extends Omit<AuditInput, 'action' | 'payload'> {
  attempted: AuditAction;
  reason: string;
  payload?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repository: AuditRepository) {}

  async record(input: AuditInput): Promise<void> {
    const actor = toAuditActor(input.actor ?? null);
    try {
      await this.repository.append({
        ...actor,
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId ?? null,
        requestId: input.requestId ?? null,
        ipHash: input.ipHash ?? null,
        payload: sanitizeAuditPayload(input.payload ?? {}),
      });
    } catch (error) {
      this.logger.error(
        `Audit ${input.action} gagal ditulis: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async denial(input: AuditDenialInput): Promise<void> {
    const { attempted, reason, payload, ...rest } = input;
    await this.record({
      ...rest,
      action: 'authz.denied',
      payload: { ...payload, attempted, reason },
    });
  }
}