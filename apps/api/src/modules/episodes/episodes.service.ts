import { Injectable } from '@nestjs/common';
import type {
  EndEpisodeInput,
  Episode,
  StartEpisodeInput,
  StartMode,
} from '@hadir/contracts';
import { presenceFor } from '@hadir/domain';
import { env } from '../../common/config/env';
import { AppError } from '../../common/errors/app-error';
import { idempotencyHash } from '../../common/http/idempotency-key';
import type { DeviceIdentity } from '../../common/http/request-context';
import {
  IdempotencyService,
  type IdempotencyContext,
} from '../../common/idempotency/idempotency.service';
import { QrService } from '../../common/security/qr.service';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import { EpisodesRepository } from '../../db/repositories/episodes.repository';
import type { Transaction } from '../../db/client';

const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 10 * 60 * 1000;
const OFFLINE_SYNC_LAG_MS = 2 * 60 * 1000;
const MIN_CLAIMED_DURATION_MS = 30 * 1000;
const CITIZEN_START_MODES = new Set<StartMode>(['qr', 'gps_nearby', 'manual']);
const TAU_MINUTES = env.episodeTauMinutes;

interface ClockInfo {
  clientStartedAt: Date;
  skewMs: number;
  flags: string[];
}

export interface EndTiming {
  endedAt: Date;
  timeSource: 'server' | 'client';
  qualityFlags: string[];
}

interface EndTimingInput {
  startedAt: Date;
  clientStartedAt: Date | null;
  clientEndedAt: Date;
  now: Date;
}

function assertDevice(device: DeviceIdentity): void {
  if (device.isNew) {
    throw new AppError('UNAUTHENTICATED', {
      detail: 'Panggil POST /v1/devices sebelum mencatat episode.',
    });
  }
}

function assertStartMode(mode: StartMode): void {
  if (!CITIZEN_START_MODES.has(mode)) {
    throw new AppError('VALIDATION_FAILED', {
      detail: 'Mode mulai ini tidak tersedia untuk warga.',
      errors: [
        {
          field: 'startMode',
          code: 'not_allowed',
          message: 'Gunakan qr, gps_nearby, atau manual.',
        },
      ],
    });
  }
}

function deviceScope(action: 'start' | 'end', deviceHash: string): string {
  return `episode.${action}.${deviceHash}`;
}

function startRequestHash(input: StartEpisodeInput): Buffer {
  return idempotencyHash({
    startMode: input.startMode,
    stopCode: input.stopCode,
    routeId: input.routeId ?? null,
    clientStartedAt: input.clientStartedAt,
    clientEventId: input.clientEventId,
    qr: input.qr ?? null,
    distanceBucket: input.distanceBucket ?? null,
    accuracyBucket: input.accuracyBucket ?? null,
  });
}

function endRequestHash(id: string, input: EndEpisodeInput): Buffer {
  return idempotencyHash({
    episodeId: id,
    outcome: input.outcome,
    clientEndedAt: input.clientEndedAt,
    clientEventId: input.clientEventId,
    note: input.note ?? null,
  });
}

function clockInfo(now: Date, clientStartedAt: Date): ClockInfo {
  const skewMs = now.getTime() - clientStartedAt.getTime();
  return {
    clientStartedAt,
    skewMs,
    flags: Math.abs(skewMs) > CLOCK_TOLERANCE_MS ? ['clock_skew'] : [],
  };
}

function assertClientTimeNotAhead(
  field: 'clientStartedAt' | 'clientEndedAt',
  clientAt: Date,
  now: Date,
): void {
  if (clientAt.getTime() - now.getTime() <= CLOCK_TOLERANCE_MS) {
    return;
  }
  throw new AppError('VALIDATION_FAILED', {
    detail: 'Waktu dari perangkat berada di masa depan.',
    errors: [
      {
        field,
        code: 'future_timestamp',
        message: `${field} tidak boleh lebih dari 10 menit di masa depan.`,
      },
    ],
  });
}

export function resolveEndTiming(input: EndTimingInput): EndTiming {
  const serverElapsedMs = Math.max(0, input.now.getTime() - input.startedAt.getTime());
  const claimedMs =
    input.clientStartedAt === null
      ? null
      : input.clientEndedAt.getTime() - input.clientStartedAt.getTime();

  if (claimedMs === null || claimedMs < MIN_CLAIMED_DURATION_MS) {
    return { endedAt: input.now, timeSource: 'server', qualityFlags: [] };
  }

  const excessMs = claimedMs - serverElapsedMs;
  if (excessMs > 0) {
    return {
      endedAt: new Date(input.startedAt.getTime() + serverElapsedMs),
      timeSource: 'server',
      qualityFlags: excessMs > CLOCK_TOLERANCE_MS ? ['duration_clamped'] : [],
    };
  }

  if (-excessMs <= OFFLINE_SYNC_LAG_MS) {
    return { endedAt: input.now, timeSource: 'server', qualityFlags: [] };
  }

  return {
    endedAt: new Date(input.startedAt.getTime() + claimedMs),
    timeSource: 'client',
    qualityFlags: ['client_time'],
  };
}

@Injectable()
export class EpisodesService {
  constructor(
    private readonly episodes: EpisodesRepository,
    private readonly devices: DevicesRepository,
    private readonly idempotency: IdempotencyService,
    private readonly qr: QrService,
  ) {}

  private async closeStale(deviceHash: string): Promise<void> {
    await this.episodes.closeStaleForDevice(deviceHash, TAU_MINUTES);
  }

  private async closeStaleTx(tx: Transaction, deviceHash: string): Promise<void> {
    await this.episodes.closeStaleForDeviceTx(tx, deviceHash, TAU_MINUTES);
  }

  private async assertDeviceRecord(tx: Transaction, deviceHash: string): Promise<void> {
    const record = await this.devices.findByHash(tx, deviceHash);
    if (record === null) {
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Perangkat belum terdaftar.',
      });
    }
    if (record.revokedAt !== null) {
      throw new AppError('FORBIDDEN', {
        detail: 'Perangkat ini diblokir.',
      });
    }
  }

  async start(
    input: StartEpisodeInput,
    key: string,
    device: DeviceIdentity,
    context: IdempotencyContext,
  ): Promise<Episode> {
    assertDevice(device);
    assertStartMode(input.startMode);

    const result = await this.idempotency.execute(
      {
        scope: deviceScope('start', device.hash),
        key,
        requestHash: startRequestHash(input),
        ttlMs: DAY_MS,
      },
      async (tx) => {
        await this.episodes.lockDevice(tx, device.hash);
        await this.assertDeviceRecord(tx, device.hash);
        await this.closeStaleTx(tx, device.hash);

        const duplicate = await this.episodes.findByClientEventId(
          tx,
          device.hash,
          input.clientEventId,
        );
        if (duplicate !== null) {
          if (duplicate.stopCode !== input.stopCode) {
            throw new AppError('IDEMPOTENCY_CONFLICT', {
              detail: 'clientEventId sudah dipakai untuk halte yang berbeda.',
            });
          }
          return { status: 201, body: duplicate };
        }

        const stop = await this.episodes.findStopByCode(tx, input.stopCode);
        if (stop === null) {
          throw new AppError('NOT_FOUND', { detail: 'Halte tidak ditemukan.' });
        }
        if (stop.status !== 'active') {
          throw new AppError('STOP_INACTIVE', {
            detail: 'Halte sedang tidak aktif.',
          });
        }
        if (input.routeId !== undefined && input.routeId !== null) {
          const serves = await this.episodes.routeServesStop(
            tx,
            input.routeId,
            stop.id,
          );
          if (!serves) {
            throw new AppError('VALIDATION_FAILED', {
              detail: 'Koridor tidak melayani halte ini.',
              errors: [
                {
                  field: 'routeId',
                  code: 'route_mismatch',
                  message: 'routeId tidak terhubung ke halte ini.',
                },
              ],
            });
          }
        }

        const active = await this.episodes.findActiveForDeviceTx(tx, device.hash);
        if (active !== null) {
          throw new AppError('EPISODE_ALREADY_ACTIVE', {
            detail: 'Perangkat ini masih memiliki episode aktif.',
          });
        }

        if (input.startMode === 'qr') {
          if (input.qr === undefined) {
            throw new AppError('VALIDATION_FAILED', {
              detail: 'Bukti QR wajib untuk mode QR.',
              errors: [
                {
                  field: 'qr',
                  code: 'required',
                  message: 'qr wajib diisi untuk startMode qr.',
                },
              ],
            });
          }
          this.qr.verify(stop.code, input.qr);
        }

        const now = new Date();
        const clientStartedAt = new Date(input.clientStartedAt);
        assertClientTimeNotAhead('clientStartedAt', clientStartedAt, now);
        const clock = clockInfo(now, clientStartedAt);
        const presence = presenceFor({
          startMode: input.startMode,
          qrValid: input.startMode === 'qr',
          distanceBucket: input.distanceBucket,
          accuracyBucket: input.accuracyBucket,
        });
        const geoOk =
          presence.presence === 'qr_geo' || presence.presence === 'gps_verified';

        const episode = await this.episodes.insertEpisode(tx, {
          stopId: stop.id,
          stopCode: stop.code,
          stopName: stop.name,
          routeId: input.routeId ?? null,
          startMode: input.startMode,
          presence: presence.presence,
          trustWeight: presence.trustWeight,
          startedAt: now,
          clientStartedAt: clock.clientStartedAt,
          clockSkewMs: clock.skewMs,
          deviceHash: device.hash,
          deviceDayHash: device.dayHash,
          clientEventId: input.clientEventId,
          qrEpoch: input.qr?.epoch ?? null,
          qrKeyId: input.qr?.keyId ?? null,
          distanceBucket: input.distanceBucket ?? null,
          accuracyBucket: input.accuracyBucket ?? null,
          geoOk,
          qualityFlags: clock.flags,
        });

        await this.episodes.enqueue(tx, 'episode.started', {
          episodeId: episode.id,
          stopId: stop.id,
          routeId: episode.routeId,
          startedAt: episode.startedAt,
          startMode: episode.startMode,
          presence: episode.presence,
          trustWeight: episode.trustWeight,
        });

        return { status: 201, body: episode };
      },
      context,
    );

    return result.body;
  }

  async end(
    id: string,
    input: EndEpisodeInput,
    key: string,
    device: DeviceIdentity,
    context: IdempotencyContext,
  ): Promise<Episode> {
    assertDevice(device);

    const result = await this.idempotency.execute(
      {
        scope: deviceScope('end', device.hash),
        key,
        requestHash: endRequestHash(id, input),
        ttlMs: DAY_MS,
      },
      async (tx) => {
        await this.assertDeviceRecord(tx, device.hash);
        await this.closeStaleTx(tx, device.hash);

        const locked = await this.episodes.lockForUpdate(tx, id, device.hash);
        if (locked === null) {
          throw new AppError('NOT_FOUND', { detail: 'Episode tidak ditemukan.' });
        }
        if (locked.outcome !== null) {
          throw new AppError('INVALID_TRANSITION', {
            detail:
              locked.outcome === 'timeout'
                ? 'Episode sudah ditutup otomatis setelah melewati batas waktu tunggu.'
                : 'Episode ini sudah selesai.',
          });
        }

        const now = new Date();
        const clientEndedAt = new Date(input.clientEndedAt);
        if (clientEndedAt.getTime() < locked.startedAt.getTime()) {
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
        assertClientTimeNotAhead('clientEndedAt', clientEndedAt, now);

        const timing = resolveEndTiming({
          startedAt: locked.startedAt,
          clientStartedAt: locked.clientStartedAt,
          clientEndedAt,
          now,
        });
        const episode = await this.episodes.applyEnd(
          tx,
          id,
          device.hash,
          {
            outcome: input.outcome,
            endedAt: timing.endedAt,
            clientEndedAt,
            note: input.note ?? null,
            timeSource: timing.timeSource,
            qualityFlags: timing.qualityFlags,
          },
          { code: locked.stopCode, name: locked.stopName },
        );
        await this.episodes.enqueue(tx, 'episode.ended', {
          episodeId: episode.id,
          outcome: episode.outcome,
          endedAt: episode.endedAt,
          durationS: episode.durationS,
          timeSource: timing.timeSource,
        });
        return { status: 200, body: episode };
      },
      context,
    );

    return result.body;
  }

  async get(id: string, device: DeviceIdentity): Promise<Episode> {
    assertDevice(device);
    await this.closeStale(device.hash);
    const episode = await this.episodes.findByIdForDevice(id, device.hash);
    if (episode === null) {
      throw new AppError('NOT_FOUND', { detail: 'Episode tidak ditemukan.' });
    }
    return episode;
  }

  async active(device: DeviceIdentity): Promise<Episode | null> {
    assertDevice(device);
    await this.closeStale(device.hash);
    return this.episodes.findActiveForDevice(device.hash);
  }
}