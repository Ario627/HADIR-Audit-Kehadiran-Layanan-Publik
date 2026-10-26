import { Inject, Injectable } from '@nestjs/common';
import type { AuditActor } from '../../common/audit/audit.actor';
import type { Database } from '../client';
import { DATABASE } from '../db.module';
import { auditLog } from '../schema';

export interface AuditEntry extends AuditActor {
  action: string;
  objectType: string;
  objectId: string | null;
  requestId: string | null;
  ipHash: string | null;
  payload: Record<string, unknown>;
}

@Injectable()
export class AuditRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async append(entry: AuditEntry): Promise<void> {
    await this.db.insert(auditLog).values({
      actorType: entry.actorType,
      actorId: entry.actorId,
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      requestId: entry.requestId,
      ipHash: entry.ipHash,
      payload: entry.payload,
    });
  }
}