import type { Episode } from '@hadir/contracts';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { DeviceIdentity } from '../../common/http/request-context';
import type { QrService } from '../../common/security/qr.service';
import type { DevicesRepository } from '../../db/repositories/devices.repository';
import type { EpisodesRepository } from '../../db/repositories/episodes.repository';
import { EpisodesService } from './episodes.service';

const DEVICE: DeviceIdentity = {
  hash: 'a'.repeat(64),
  dayHash: 'b'.repeat(64),
  isNew: false,
};

const EPISODE_ID = '0192f0c4-0000-7000-8000-0000000000aa';

interface HeartbeatState {
  target: { id: string; startedAt: Date; lastHeartbeatAt: Date | null } | null;
  accepted: boolean;
  writtenAt: Date | null;
  revokedAt: Date | null;
}

function episodesDouble(state: HeartbeatState): EpisodesRepository {
  return {
    runInTransaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}),
    findHeartbeatTarget: async () => state.target,
    recordHeartbeat: async (_tx: unknown, _id: string, _hash: string, at: Date) => {
      state.writtenAt = at;
      return state.accepted;
    },
    findByClientEventId: async () => null as Episode | null,
    findStopByCode: async () => null,
    routeServesStop: async () => false,
    findActiveForDeviceTx: async () => null,
    insertEpisode: async () => {
      throw new Error('tidak dipakai pada pengujian heartbeat');
    },
    enqueue: async () => undefined,
    closeStaleForDeviceTx: async () => [],
    findByIdForDevice: async () => null,
    findActiveForDevice: async () => null,
    lockForUpdate: async () => null,
    applyEnd: async () => {
      throw new Error('tidak dipakai pada pengujian heartbeat');
    },
  } as unknown as EpisodesRepository;
}

function devicesDouble(state: HeartbeatState): DevicesRepository {
  return {
    findByHash: async () => ({ id: 'd1', trustScore: 0.5, revokedAt: state.revokedAt }),
    upsert: async () => {
      throw new Error('tidak dipakai pada pengujian heartbeat');
    },
  } as unknown as DevicesRepository;
}

function buildService(state: HeartbeatState): EpisodesService {
  return new EpisodesService(
    episodesDouble(state),
    devicesDouble(state),
    {} as IdempotencyService,
    {} as QrService,
  );
}

function freshState(overrides: Partial<HeartbeatState> = {}): HeartbeatState {
  return {
    target: {
      id: EPISODE_ID,
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
      lastHeartbeatAt: null,
    },
    accepted: true,
    writtenAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function heartbeatInput(clientAt: Date = new Date()): {
  clientAt: string;
  clientEventId: string;
} {
  return {
    clientAt: clientAt.toISOString(),
    clientEventId: '0192f0c4-0000-7000-8000-000000000001',
  };
}

describe('EpisodesService.heartbeat', () => {
  it('records a heartbeat for the owning device', async () => {
    const state = freshState();

    await buildService(state).heartbeat(EPISODE_ID, heartbeatInput(), DEVICE);

    expect(state.writtenAt).toBeInstanceOf(Date);
  });

  it('rejects devices that never completed bootstrap', async () => {
    const state = freshState();

    await expect(
      buildService(state).heartbeat(EPISODE_ID, heartbeatInput(), {
        ...DEVICE,
        isNew: true,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(state.writtenAt).toBeNull();
  });

  it('returns not found for an episode owned by another device', async () => {
    const state = freshState({ target: null });

    await expect(
      buildService(state).heartbeat(EPISODE_ID, heartbeatInput(), DEVICE),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses to extend an episode that already ended', async () => {
    const state = freshState({ accepted: false });

    await expect(
      buildService(state).heartbeat(EPISODE_ID, heartbeatInput(), DEVICE),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('rejects a client clock that claims the future', async () => {
    const state = freshState();
    const ahead = new Date(Date.now() + 11 * 60 * 1000);

    await expect(
      buildService(state).heartbeat(EPISODE_ID, heartbeatInput(ahead), DEVICE),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(state.writtenAt).toBeNull();
  });

  it('refuses blocked devices', async () => {
    const state = freshState({ revokedAt: new Date() });

    await expect(
      buildService(state).heartbeat(EPISODE_ID, heartbeatInput(), DEVICE),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
