import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  DistanceBucket,
  AccuracyBucket,
  Episode,
  EpisodeOutcome,
  Presence,
  StartMode,
} from '@hadir/contracts';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { withTransaction } from '../client';
import { DATABASE } from '../db.module';
import { outbox, routeStops, stops, waitEpisodeEvents, waitEpisodes } from '../schema';
import { AppError } from '../../common/errors/app-error';
import { canonicalJson } from '../../common/utils/canonical-json';

const GENESIS_HASH = Buffer.alloc(32);

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
  endedAt: Date;
  clientEndedAt: Date;
  note: string | null;
  timeSource: 'server' | 'client';
  qualityFlags: readonly string[];
}

export interface LockedEpisode {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  clientStartedAt: Date | null;
  outcome: EpisodeOutcome | null;
  qualityFlags: string[];
  stopCode: string;
  stopName: string;
}

export interface EpisodeStop {
  code: string;
  name: string;
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

const lockSelection = {
  id: waitEpisodes.id,
  startedAt: waitEpisodes.startedAt,
  endedAt: waitEpisodes.endedAt,
  clientStartedAt: waitEpisodes.clientStartedAt,
  outcome: waitEpisodes.outcome,
  qualityFlags: waitEpisodes.qualityFlags,
  stopCode: stops.code,
  stopName: stops.name,
};

function mapReaped(rows: unknown[]): ReapedEpisode[] {
  const output: ReapedEpisode[] = [];
  for (const raw of rows as Record<string, unknown>[]) {
    const id = typeof raw.id === 'string' ? raw.id : null;
    const startedAt = raw.started_at;
    const endedAt = raw.ended_at;
    if (!(startedAt instanceof Date) || !(endedAt instanceof Date) || id === null) {
      continue;
    }
    output.push({
      id,
      startedAt,
      endedAt,
      durationS: typeof raw.duration_s === 'number' ? raw.duration_s : null,
    });
  }
  return output;
}

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

function appendFlags(expression: SQL, flags: readonly string[]): SQL {
  return flags.reduce<SQL>((current, flag) => sql`${current} || ${flag}::text`, expression);
}

export interface ReapWindow {
  tauMinutes: number;
  idleMinutes: number;
  maxMinutes: number;
}

export interface ReapedEpisode {
  id: string;
  startedAt: Date;
  endedAt: Date;
  durationS: number | null;
}

interface ReapScope {
  deviceHash: string | null;
  limit: number | null;
}

function deviceScope(deviceHash: string | null): SQL {
  return deviceHash === null ? sql`TRUE` : sql`${waitEpisodes.deviceHash} = ${deviceHash}`;
}

function stalePredicate(window: ReapWindow): SQL {
  return sql`(
    COALESCE(${waitEpisodes.lastHeartbeatAt}, ${waitEpisodes.startedAt})
      < now() - make_interval(mins => ${window.idleMinutes})
    OR ${waitEpisodes.startedAt} < now() - make_interval(mins => ${window.maxMinutes})
  )`;
}

function staleEpisodeSql(scope: ReapScope, window: ReapWindow): SQL {
  return sql`
    WITH picked AS (
      SELECT ${waitEpisodes.id} AS id
      FROM ${waitEpisodes}
      WHERE ${waitEpisodes.outcome} IS NULL
        AND ${deviceScope(scope.deviceHash)}
        AND ${stalePredicate(window)}
      ORDER BY ${waitEpisodes.startedAt}
      LIMIT ${scope.limit}
      FOR UPDATE SKIP LOCKED
    ),
    stale AS (
      UPDATE ${waitEpisodes}
      SET outcome = 'timeout',
          ended_at = GREATEST(
            ${waitEpisodes.startedAt},
            LEAST(
              now(),
              COALESCE(
                ${waitEpisodes.lastHeartbeatAt},
                ${waitEpisodes.startedAt} + make_interval(mins => ${window.tauMinutes})
              )
            )
          ),
          quality_flags = array_append(${waitEpisodes.qualityFlags}, 'timeout_inferred')
      WHERE ${waitEpisodes.id} IN (SELECT id FROM picked)
      RETURNING id, started_at, ended_at, duration_s
    ),
    queued AS (
      INSERT INTO ${outbox} (topic, payload)
      SELECT 'episode.ended',
             jsonb_build_object(
               'episodeId', stale.id,
               'outcome', 'timeout',
               'endedAt', stale.ended_at,
               'durationS', stale.duration_s,
               'inferred', true
             )
      FROM stale
      RETURNING 1 AS queued
    )
    SELECT id, started_at, ended_at, duration_s FROM stale
  `;
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

  async runInTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(work);
  }

  async closeStaleForDeviceTx(
    tx: Transaction,
    deviceHash: string,
    window: ReapWindow,
  ): Promise<ReapedEpisode[]> {
    const result = await tx.execute(staleEpisodeSql({ deviceHash, limit: null }, window));
    return mapReaped(result.rows);
  }

  async reapStaleGlobal(window: ReapWindow, limit: number): Promise<ReapedEpisode[]> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`reap limit tidak valid: ${limit}`);
    }
    const result = await this.db.execute(staleEpisodeSql({ deviceHash: null, limit }, window));
    return mapReaped(result.rows);
  }

  async appendEvent(
    tx: Transaction,
    episodeId: string,
    episodeStartedAt: Date,
    kind: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.execute(sql`SELECT id FROM wait_episodes WHERE id = ${episodeId} FOR UPDATE`);
    const last = await tx.execute(sql`
      SELECT seq, chain_hash FROM wait_episode_events
      WHERE episode_id = ${episodeId}
      ORDER BY seq DESC
      LIMIT 1
    `);
    const previous = (last.rows[0] ?? {}) as Record<string, unknown>;
    const previousSeq =
      typeof previous.seq === 'number' ? previous.seq : null;
    const previousHash =
      previous.chain_hash instanceof Buffer ? previous.chain_hash : GENESIS_HASH;
    const payloadHash = createHash('sha256')
      .update(canonicalJson(payload))
      .digest();
    const chainHash = createHash('sha256')
      .update(previousHash)
      .update(payloadHash)
      .digest();
    await tx.insert(waitEpisodeEvents).values({
      episodeId,
      episodeStartedAt,
      seq: previousSeq === null ? 1 : previousSeq + 1,
      kind,
      actorType: 'system',
      actorId: null,
      payload,
      prevHash: previousHash,
      payloadHash,
      chainHash,
    });
  }

  async recordHeartbeat(
    tx: Transaction,
    id: string,
    deviceHash: string,
    at: Date,
  ): Promise<boolean> {
    const updated = await tx
      .update(waitEpisodes)
      .set({ lastHeartbeatAt: at })
      .where(
        and(
          eq(waitEpisodes.id, id),
          eq(waitEpisodes.deviceHash, deviceHash),
          isNull(waitEpisodes.outcome),
        ),
      )
      .returning({ id: waitEpisodes.id });
    return updated.length === 1;
  }

  async findHeartbeatTarget(
    tx: Transaction,
    id: string,
    deviceHash: string,
  ): Promise<{ id: string; startedAt: Date; lastHeartbeatAt: Date | null } | null> {
    const rows = await tx
      .select({
        id: waitEpisodes.id,
        startedAt: waitEpisodes.startedAt,
        lastHeartbeatAt: waitEpisodes.lastHeartbeatAt,
      })
      .from(waitEpisodes)
      .where(and(eq(waitEpisodes.id, id), eq(waitEpisodes.deviceHash, deviceHash)))
      .limit(1);
    return rows[0] ?? null;
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

  async lockForUpdate(
    tx: Transaction,
    id: string,
    deviceHash: string,
  ): Promise<LockedEpisode | null> {
    const rows = await tx
      .select(lockSelection)
      .from(waitEpisodes)
      .innerJoin(stops, eq(waitEpisodes.stopId, stops.id))
      .where(and(eq(waitEpisodes.id, id), eq(waitEpisodes.deviceHash, deviceHash)))
      .for('update', { of: waitEpisodes })
      .limit(1);
    return rows[0] ?? null;
  }

  async applyEnd(
    tx: Transaction,
    id: string,
    deviceHash: string,
    input: EndEpisodeValues,
    stop: EpisodeStop,
  ): Promise<Episode> {
    const rows = await tx
      .update(waitEpisodes)
      .set({
        outcome: input.outcome,
        endedAt: input.endedAt,
        clientEndedAt: input.clientEndedAt,
        note: input.note,
        timeSource: input.timeSource,
        ...(input.qualityFlags.length === 0
          ? {}
          : {
              qualityFlags: appendFlags(
                sql`${waitEpisodes.qualityFlags}`,
                input.qualityFlags,
              ),
            }),
      })
      .where(
        and(
          eq(waitEpisodes.id, id),
          eq(waitEpisodes.deviceHash, deviceHash),
          isNull(waitEpisodes.outcome),
        ),
      )
      .returning(episodeColumns);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError('INVALID_TRANSITION', {
        detail: 'Episode ini sudah selesai.',
      });
    }
    return toEpisode({
      ...row,
      stopCode: stop.code,
      stopName: stop.name,
    });
  }

  async applyCorrection(
    tx: Transaction,
    id: string,
    deviceHash: string,
    input: EndEpisodeValues,
    stop: EpisodeStop,
  ): Promise<Episode> {
    const rows = await tx
      .update(waitEpisodes)
      .set({
        outcome: input.outcome,
        endedAt: input.endedAt,
        clientEndedAt: input.clientEndedAt,
        note: input.note,
        timeSource: input.timeSource,
        qualityFlags: appendFlags(sql`${waitEpisodes.qualityFlags}`, [
          ...input.qualityFlags,
          'late_correction',
        ]),
      })
      .where(
        and(
          eq(waitEpisodes.id, id),
          eq(waitEpisodes.deviceHash, deviceHash),
          eq(waitEpisodes.outcome, 'timeout'),
        ),
      )
      .returning(episodeColumns);
    const row = rows[0];
    if (row === undefined) {
      throw new AppError('INVALID_TRANSITION', {
        detail: 'Episode ini tidak dapat dikoreksi.',
      });
    }
    return toEpisode({
      ...row,
      stopCode: stop.code,
      stopName: stop.name,
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