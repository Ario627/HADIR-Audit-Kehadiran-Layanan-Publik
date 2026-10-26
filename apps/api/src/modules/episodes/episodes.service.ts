import { Injectable } from '@nestjs/common';
import type {
  EndEpisodeInput,
  Episode,
  StartEpisodeInput,
  StartMode,
} from '@hadir/contracts';
import { presenceFor } from '@hadir/domain';
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
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const CITIZEN_START_MODES = new Set<StartMode>(['qr', 'gps_nearby', 'manual']);

interface ClockInfo {
  clientStartedAt: Date;
  skewMs: number;
  flags: string[];
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

function clockInfo(now: Date, clientStartedAt: string): ClockInfo {
  const clientDate = new Date(clientStartedAt);
  const skewMs = now.getTime() - clientDate.getTime();
  return {
    clientStartedAt: clientDate,
    skewMs,
    flags: Math.abs(skewMs) > MAX_CLOCK_SKEW_MS ? ['clock_skew'] : [],
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

    const requestHash = idempotencyHash({
      startMode: input.startMode,
      stopCode: input.stopCode,
      routeId: input.routeId ?? null,
      clientStartedAt: input.clientStartedAt,
      clientEventId: input.clientEventId,
      qr: input.qr ?? null,
      distanceBucket: input.distanceBucket ?? null,
      accuracyBucket: input.accuracyBucket ?? null,
    });

    const result = await this.idempotency.execute(
      { scope: 'episode.start', key, requestHash, ttlMs: DAY_MS },
      async (tx) => {
        await this.episodes.lockDevice(tx, device.hash);
        await this.assertDeviceRecord(tx, device.hash);

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
        const clock = clockInfo(now, input.clientStartedAt);
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
    const requestHash = idempotencyHash({
      episodeId: id,
      outcome: input.outcome,
      clientEndedAt: input.clientEndedAt,
      clientEventId: input.clientEventId,
      note: input.note ?? null,
    });

    const result = await this.idempotency.execute(
      { scope: 'episode.end', key, requestHash, ttlMs: DAY_MS },
      async (tx) => {
        await this.assertDeviceRecord(tx, device.hash);
        const episode = await this.episodes.endEpisode(tx, id, device.hash, {
          outcome: input.outcome,
          clientEndedAt: new Date(input.clientEndedAt),
          note: input.note ?? null,
        });
        await this.episodes.enqueue(tx, 'episode.ended', {
          episodeId: episode.id,
          outcome: episode.outcome,
          endedAt: episode.endedAt,
          durationS: episode.durationS,
        });
        return { status: 200, body: episode };
      },
      context,
    );

    return result.body;
  }

  async get(id: string, device: DeviceIdentity): Promise<Episode> {
    assertDevice(device);
    const episode = await this.episodes.findByIdForDevice(id, device.hash);
    if (episode === null) {
      throw new AppError('NOT_FOUND', { detail: 'Episode tidak ditemukan.' });
    }
    return episode;
  }

  async active(device: DeviceIdentity): Promise<Episode | null> {
    assertDevice(device);
    return this.episodes.findActiveForDevice(device.hash);
  }
}