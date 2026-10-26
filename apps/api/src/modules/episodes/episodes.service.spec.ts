import type { Episode, StartEpisodeInput } from '@hadir/contracts';
import type {
  IdempotencyContext,
  IdempotencyService,
} from '../../common/idempotency/idempotency.service';
import type { DeviceIdentity } from '../../common/http/request-context';
import type { QrService } from '../../common/security/qr.service';
import type { DevicesRepository } from '../../db/repositories/devices.repository';
import type { EpisodesRepository } from '../../db/repositories/episodes.repository';
import { EpisodesService, resolveEndTiming } from './episodes.service';

interface DeviceRecordDouble {
  id: string;
  trustScore: number;
  revokedAt: Date | null;
}

interface RepositoryState {
  reaped: string[];
  inserted: Episode | null;
}

const DEVICE: DeviceIdentity = {
  hash: 'a'.repeat(64),
  dayHash: 'b'.repeat(64),
  isNew: false,
};

const CONTEXT: IdempotencyContext = { requestId: 'req-1', deviceHash: DEVICE.hash };
const STOP_ID = '0192f0c4-0000-7000-8000-0000000000bb';
const EPISODE_ID = '0192f0c4-0000-7000-8000-0000000000aa';

function buildEpisode(startedAt: Date): Episode {
  return {
    id: EPISODE_ID,
    stopId: STOP_ID,
    stopCode: 'BMS-A12',
    stopName: 'Halte UMP',
    routeId: null,
    startMode: 'manual',
    presence: 'unverified',
    trustWeight: 0.55,
    startedAt: startedAt.toISOString(),
    endedAt: null,
    status: 'active',
    durationS: null,
    outcome: null,
    qualityFlags: [],
  };
}

function buildStartInput(overrides: Partial<StartEpisodeInput> = {}): StartEpisodeInput {
  return {
    stopCode: 'BMS-A12',
    startMode: 'manual',
    clientStartedAt: new Date().toISOString(),
    clientEventId: '0192f0c4-0000-7000-8000-000000000001',
    ...overrides,
  };
}

function episodesDouble(state: RepositoryState) {
  return {
    lockDevice: async (): Promise<void> => undefined,
    closeStaleForDeviceTx: async (): Promise<never[]> => {
      state.reaped.push(DEVICE.hash);
      return [];
    },
    findByClientEventId: async (): Promise<Episode | null> => null,
    findStopByCode: async () => ({
      id: STOP_ID,
      code: 'BMS-A12',
      name: 'Halte UMP',
      status: 'active' as const,
    }),
    routeServesStop: async (): Promise<boolean> => true,
    findActiveForDeviceTx: async (): Promise<Episode | null> => null,
    insertEpisode: async (): Promise<Episode> => {
      const episode = state.inserted;
      if (episode === null) {
        throw new Error('episode double tidak disiapkan');
      }
      return episode;
    },
    enqueue: async (): Promise<void> => undefined,
  };
}

function devicesDouble(): { findByHash: () => Promise<DeviceRecordDouble> } {
  return {
    findByHash: async () => ({ id: 'device-1', trustScore: 0.5, revokedAt: null }),
  };
}

function idempotencyDouble(scopes: string[]) {
  return {
    execute: async <T>(
      input: { scope: string },
      work: (tx: unknown) => Promise<{ status: number; body: T }>,
    ) => {
      scopes.push(input.scope);
      const result = await work({});
      return { status: result.status, body: result.body, replayed: false };
    },
  };
}

function qrDouble(): { verify: () => void } {
  return { verify: () => undefined };
}

function buildService(state: RepositoryState, scopes: string[]): EpisodesService {
  return new EpisodesService(
    episodesDouble(state) as unknown as EpisodesRepository,
    devicesDouble() as unknown as DevicesRepository,
    idempotencyDouble(scopes) as unknown as IdempotencyService,
    qrDouble() as unknown as QrService,
  );
}

describe('resolveEndTiming', () => {
  const startedAt = new Date('2026-10-26T10:00:00.000Z');

  it('uses the server clock when the device claim matches server elapsed time', () => {
    const now = new Date('2026-10-26T10:20:00.000Z');
    const timing = resolveEndTiming({
      startedAt,
      clientStartedAt: new Date('2026-10-26T10:00:05.000Z'),
      clientEndedAt: new Date('2026-10-26T10:19:55.000Z'),
      now,
    });

    expect(timing).toEqual({ endedAt: now, timeSource: 'server', qualityFlags: [] });
  });

  it('reconstructs offline durations from the device delta', () => {
    const timing = resolveEndTiming({
      startedAt,
      clientStartedAt: new Date('2026-10-26T10:00:00.000Z'),
      clientEndedAt: new Date('2026-10-26T10:18:00.000Z'),
      now: new Date('2026-10-26T10:55:00.000Z'),
    });

    expect(timing.timeSource).toBe('client');
    expect(timing.qualityFlags).toEqual(['client_time']);
    expect(timing.endedAt.toISOString()).toBe('2026-10-26T10:18:00.000Z');
  });

  it('clamps claims that exceed server elapsed time', () => {
    const now = new Date('2026-10-26T10:10:00.000Z');
    const timing = resolveEndTiming({
      startedAt,
      clientStartedAt: new Date('2026-10-26T09:00:00.000Z'),
      clientEndedAt: new Date('2026-10-26T10:09:00.000Z'),
      now,
    });

    expect(timing.timeSource).toBe('server');
    expect(timing.qualityFlags).toEqual(['duration_clamped']);
    expect(timing.endedAt.toISOString()).toBe(now.toISOString());
  });

  it('ignores sub-threshold device claims', () => {
    const now = new Date('2026-10-26T10:00:10.000Z');
    const timing = resolveEndTiming({
      startedAt,
      clientStartedAt: startedAt,
      clientEndedAt: new Date('2026-10-26T10:00:05.000Z'),
      now,
    });

    expect(timing.qualityFlags).toEqual([]);
    expect(timing.endedAt).toBe(now);
  });
});

describe('EpisodesService.start', () => {
  it('scopes idempotency by device identity and reaps stale episodes first', async () => {
    const state: RepositoryState = { reaped: [], inserted: buildEpisode(new Date()) };
    const scopes: string[] = [];
    const service = buildService(state, scopes);

    await service.start(
      buildStartInput(),
      '0192f0c4-0000-7000-8000-0000000000cc',
      DEVICE,
      CONTEXT,
    );

    expect(scopes).toEqual([`episode.start.${DEVICE.hash}`]);
    expect(state.reaped).toEqual([DEVICE.hash]);
  });

  it('rejects device clocks that claim the future', async () => {
    const state: RepositoryState = { reaped: [], inserted: buildEpisode(new Date()) };
    const service = buildService(state, []);
    const ahead = new Date(Date.now() + 11 * 60 * 1000).toISOString();

    await expect(
      service.start(
        buildStartInput({ clientStartedAt: ahead }),
        '0192f0c4-0000-7000-8000-0000000000cd',
        DEVICE,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects devices that never completed bootstrap', async () => {
    const state: RepositoryState = { reaped: [], inserted: buildEpisode(new Date()) };
    const service = buildService(state, []);

    await expect(
      service.start(
        buildStartInput(),
        '0192f0c4-0000-7000-8000-0000000000ce',
        { ...DEVICE, isNew: true },
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});