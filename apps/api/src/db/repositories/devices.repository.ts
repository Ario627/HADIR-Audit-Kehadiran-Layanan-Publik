import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { DATABASE } from '../db.module';
import { devices } from '../schema';

export interface DeviceRecord {
  id: string;
  trustScore: number;
  revokedAt: Date | null;
  isNew: boolean;
}

@Injectable()
export class DevicesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByHash(tx: Transaction, deviceHash: string): Promise<DeviceRecord | null> {
    const rows = await tx
      .select({
        id: devices.id,
        trustScore: devices.trustScore,
        revokedAt: devices.revokedAt,
      })
      .from(devices)
      .where(eq(devices.deviceHash, deviceHash))
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : { ...row, isNew: false };
  }

  async upsert(deviceHash: string): Promise<DeviceRecord> {
    const inserted = await this.db
      .insert(devices)
      .values({ deviceHash })
      .onConflictDoNothing()
      .returning({
        id: devices.id,
        trustScore: devices.trustScore,
        revokedAt: devices.revokedAt,
      });
    const created = inserted[0];
    if (created !== undefined) {
      return { ...created, isNew: true };
    }

    const updated = await this.db
      .update(devices)
      .set({ lastSeen: new Date() })
      .where(eq(devices.deviceHash, deviceHash))
      .returning({
        id: devices.id,
        trustScore: devices.trustScore,
        revokedAt: devices.revokedAt,
      });
    const existing = updated[0];
    if (existing === undefined) {
      throw new Error('Perangkat gagal dibuat atau diperbarui.');
    }
    return { ...existing, isNew: false };
  }
}