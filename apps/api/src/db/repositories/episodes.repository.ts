import { Inject, Injectable } from '@nestjs/common';
import type {
  DistanceBucket,
  AccuracyBucket,
  Episode,
  EpisodeOutcome,
  Presence,
  StartMode,
} from '@hadir/contracts';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { DATABASE } from '../db.module';
import { outbox, routeStops, stops, waitEpisodes } from '../schema';
import { AppError } from '../../common/errors/app-error';

export interface StopRecord {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive' | 'moved' | 'planned';
}

export interface StartEpisodeValues {
  stopId: string;
  stopCode: string;
  stopName: string;
  routeId: string | null;
  startMode: StartMode;
  presence: Presence;
  trustWeight: number;
  startedAt: Date;
  clientStartedAt: Date;
  clockSkewMs: number;
  deviceHash: string;
  deviceDayHash: string;
  clientEventId: string;
  qrEpoch: string | null;
  qrKeyId: string | null;
  distanceBucket: DistanceBucket | null;
  accuracyBucket: AccuracyBucket | null;
  geoOk: boolean;
  qualityFlags: string[];
}

export interface EndEpisodeValues {
  outcome: 'boarded' | 'abandoned' | 'passed_full' | 'cancelled';
  clientEndedAt: Date;
  note: string | null;
}

interface EpisodeRow {
  id: string;
  stopId: string;
  stopCode: string;
  stopName: string;
  routeId: string | null;
  startMode: StartMode;
  presence: Presence;
  trustWeight: number;
  startedAt: Date;
  endedAt: Date | null;
  durationS: number | null;
  outcome: EpisodeOutcome | null;
  qualityFlags: string[];
}

const stopSelection = {
  id: stops.id,
  code: stops.code,
  name: stops.name,
  status: stops.status,
};

const episodeColumns = {
  id: waitEpisodes.id,
  stopId: waitEpisodes.stopId,
  routeId: waitEpisodes.routeId,
  startMode: waitEpisodes.startMode,
  presence: waitEpisodes.presence,
  trustWeight: waitEpisodes.trustWeight,
  startedAt: waitEpisodes.startedAt,
  endedAt: waitEpisodes.endedAt,
  durationS: waitEpisodes.durationS,
  outcome: waitEpisodes.outcome,
  qualityFlags: waitEpisodes.qualityFlags,
};

const episodeSelection = {
  ...episodeColumns,
  stopCode: stops.code,
  stopName: stops.name,
};

function toEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    stopId: row.stopId,
    stopCode: row.stopCode,
    stopName: row.stopName,
    routeId: row.routeId,
    startMode: row.startMode,
    presence: row.presence,
    trustWeight: row.trustWeight,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    status: row.outcome === null ? 'active' : 'ended',
    durationS: row.durationS,
    outcome: row.outcome,
    qualityFlags: row.qualityFlags,
  };
}

@Injectable()
export class EpisodesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByIdForDevice(id: string, deviceHash: string): Promise<Episode | null> {
    const rows = await this.db
      .select(episodeSelection)
      .from(waitEpisodes)
      .innerJoin(stops, eq(waitEpisodes.stopId, stops.id))
      .where(and(eq(waitEpisodes.id, id), eq(waitEpisodes.deviceHash, deviceHash)))
      .limit(1);
    return rows[0] === undefined ? null : toEpisode(rows[0]);
  }

  async findActiveForDevice(deviceHash: string): Promise<Episode | null> {
    return this.findActiveForDeviceWith(this.db, deviceHash);
  }

  async findActiveForDeviceTx(
    tx: Transaction,
    deviceHash: string,
  ): Promise<Episode | null> {
    return this.findActiveForDeviceWith(tx, deviceHash);
  }

  private async findActiveForDeviceWith(
    executor: Database | Transaction,
    deviceHash: string,
  ): Promise<Episode | null> {
    const rows = await executor
      .select(episodeSelection)
      .from(waitEpisodes)
      .innerJoin(stops, eq(waitEpisodes.stopId, stops.id))
      .where(and(eq(waitEpisodes.deviceHash, deviceHash), isNull(waitEpisodes.outcome)))
      .orderBy(desc(waitEpisodes.startedAt))
      .limit(1);
    return rows[0] === undefined ? null : toEpisode(rows[0]);
  }

  async lockDevice(tx: Transaction, deviceHash: string): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`episode:${deviceHash}`}, 0))`,
    );
  }

  async findStopByCode(tx: Transaction, code: string): Promise<StopRecord | null> {
    const rows = await tx
      .select(stopSelection)
      .from(stops)
      .where(eq(stops.code, code))
      .limit(1);
    return rows[0] ?? null;
  }

  async routeServesStop(
    tx: Transaction,
    routeId: string,
    stopId: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ routeId: routeStops.routeId })
      .from(routeStops)
      .where(and(eq(routeStops.routeId, routeId), eq(routeStops.stopId, stopId)))
      .limit(1);
    return rows.length > 0;
  }

  async findByClientEventId(
    tx: Transaction,
    deviceHash: string,
    clientEventId: string,
  ): Promise<Episode | null> {
    const rows = await tx
      .select(episodeSelection)
      .from(waitEpisodes)
      .innerJoin(stops, eq(waitEpisodes.stopId, stops.id))
      .where(
        and(
          eq(waitEpisodes.deviceHash, deviceHash),
          eq(waitEpisodes.clientEventId, clientEventId),
        ),
      )
      .orderBy(desc(waitEpisodes.startedAt))
      .limit(1);
    return rows[0] === undefined ? null : toEpisode(rows[0]);
  }

  async insertEpisode(tx: Transaction, input: StartEpisodeValues): Promise<Episode> {
    const rows = await tx
      .insert(waitEpisodes)
      .values({
        stopId: input.stopId,
        routeId: input.routeId,
        startMode: input.startMode,
        presence: input.presence,
        startedAt: input.startedAt,
        clientStartedAt: input.clientStartedAt,
        clockSkewMs: input.clockSkewMs,
        timeSource: 'server',
        deviceHash: input.deviceHash,
        deviceDayHash: input.deviceDayHash,
        clientEventId: input.clientEventId,
        qrEpoch: input.qrEpoch,
        qrKeyId: input.qrKeyId,
        distanceBucket: input.distanceBucket,
        accuracyBucket: input.accuracyBucket,
        geoOk: input.geoOk,
        trustWeight: input.trustWeight,
        qualityFlags: input.qualityFlags,
      })
      .returning(episodeColumns);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', {
        detail: 'Episode gagal dibuat.',
      });
    }
    return toEpisode({
      ...row,
      stopCode: input.stopCode,
      stopName: input.stopName,
    });
  }

  async endEpisode(
    tx: Transaction,
    id: string,
    deviceHash: string,
    input: EndEpisodeValues,
  ): Promise<Episode> {
    const locked = await tx
      .select(episodeSelection)
      .from(waitEpisodes)
      .innerJoin(stops, eq(waitEpisodes.stopId, stops.id))
      .where(and(eq(waitEpisodes.id, id), eq(waitEpisodes.deviceHash, deviceHash)))
      .for('update', { of: waitEpisodes })
      .limit(1);
    const existing = locked[0];
    if (existing === undefined) {
      throw new AppError('NOT_FOUND', { detail: 'Episode tidak ditemukan.' });
    }
    if (existing.outcome !== null) {
      throw new AppError('INVALID_TRANSITION', {
        detail: 'Episode ini sudah selesai.',
      });
    }
    if (input.clientEndedAt.getTime() < existing.startedAt.getTime()) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Waktu selesai tidak boleh sebelum waktu mulai.',
        errors: [
          {
            field: 'clientEndedAt',
            code: 'before_start',
            message: 'clientEndedAt harus setelah episode dimulai.',
          },
        ],
      });
    }

    const endedAt = new Date();
    const rows = await tx
      .update(waitEpisodes)
      .set({
        outcome: input.outcome,
        endedAt,
        clientEndedAt: input.clientEndedAt,
        note: input.note,
      })
      .where(and(eq(waitEpisodes.id, id), eq(waitEpisodes.deviceHash, deviceHash)))
      .returning(episodeColumns);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', {
        detail: 'Episode gagal diperbarui.',
      });
    }
    return toEpisode({
      ...row,
      stopCode: existing.stopCode,
      stopName: existing.stopName,
    });
  }

  async enqueue(
    tx: Transaction,
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.insert(outbox).values({ topic, payload });
  }
}