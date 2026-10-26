import type { Episode } from '@hadir/contracts';
import type { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { DeviceIdentity } from '../../common/http/request-context';
import type { QrService } from '../../common/security/qr.service';
import type { DevicesRepository } from '../../db/repositories/devices.repository';
import type {
  EndEpisodeValues,
  EpisodesRepository,
  LockedEpisode,
} from '../../db/repositories/episodes.repository';
import { EpisodesService, correctionWithinWindow } from './episodes.service';

const DEVICE: DeviceIdentity = {
  hash: 'a'.repeat(64),
  dayHash: 'b'.repeat(64),
  isNew: false,
};

const CONTEXT = { requestId: 'req-1', deviceHash: DEVICE.hash };
const EPISODE_ID = '0192f0c4-0000-7000-8000-0000000000aa';
const KEY = '0192f0c4-0000-7000-8000-0000000000bb';

interface CorrectionState {
  locked: LockedEpisode | null;
  appliedVia: 'end' | 'correction' | null;
  applied: EndEpisodeValues | null;
  events: { kind: string; payload: Record<string, unknown> }[];
  queued: Record<string, unknown>[];
}

function lockedEpisode(overrides: Partial<LockedEpisode> = {}): LockedEpisode {
  return {
    id: EPISODE_ID,
    startedAt: new Date(Date.now() - 50 * 60 * 1000),
    endedAt: new Date(Date.now() - 5 * 60 * 1000),
    clientStartedAt: new Date(Date.now() - 50 * 60 * 1000),
    outcome: 'timeout',
    qualityFlags: ['timeout_inferred'],
    stopCode: 'BMS-A12',
    stopName: 'Halte UMP',
    ...overrides,
  };
}

function toEpisode(values: EndEpisodeValues, locked: LockedEpisode): Episode {
  const durationS = Math.max(
    0,
    Math.round((values.endedAt.getTime() - locked.startedAt.getTime()) / 1000),
  );
  return {
    id: EPISODE_ID,
    stopId: '0192f0c4-0000-7000-8000-0000000000cc',
    stopCode: locked.stopCode,
    stopName: locked.stopName,
    routeId: null,
    startMode: 'manual',
    presence: 'unverified',
    trustWeight: 0.55,
    startedAt: locked.startedAt.toISOString(),
    endedAt: values.endedAt.toISOString(),
    status: 'ended',
    durationS,
    outcome: values.outcome,
    qualityFlags: [...values.qualityFlags],
  };
}

function repositoryDouble(state: CorrectionState): EpisodesRepository {
  return {
    runInTransaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => work({}),
    closeStaleForDeviceTx: async () => [],
    lockForUpdate: async () => state.locked,
    applyEnd: async (_tx: unknown, _id: string, _h: string, values: EndEpisodeValues) => {
      state.appliedVia = 'end';
      state.applied = values;
      return toEpisode(values, state.locked as LockedEpisode);
    },
    applyCorrection: async (_tx: unknown, _id: string, _h: string, values: EndEpisodeValues) => {
      state.appliedVia = 'correction';
      state.applied = values;
      return toEpisode(values, state.locked as LockedEpisode);
    },
    appendEvent: async (
      _tx: unknown,
      _id: string,
      _startedAt: Date,
      kind: string,
      payload: Record<string, unknown>,
    ) => {
      state.events.push({ kind, payload });
    },
    enqueue: async (_tx: unknown, _topic: string, payload: Record<string, unknown>) => {
      state.queued.push(payload);
    },
    findByClientEventId: async () => null as Episode | null,
    findStopByCode: async () => null,
    routeServesStop: async () => false,
    findActiveForDeviceTx: async () => null,
    insertEpisode: async () => {
      throw new Error('tidak dipakai');
    },
    findHeartbeatTarget: async () => null,
    recordHeartbeat: async () => false,
    findByIdForDevice: async () => null,
    findActiveForDevice: async () => null,
  } as unknown as EpisodesRepository;
}

function devicesDouble(): DevicesRepository {
  return {
    findByHash: async () => ({ id: 'd1', trustScore: 0.5, revokedAt: null }),
    upsert: async () => {
      throw new Error('tidak dipakai');
    },
  } as unknown as DevicesRepository;
}

function buildService(state: CorrectionState): EpisodesService {
  const idempotency = {
    execute: async (
      _input: unknown,
      work: (tx: unknown) => Promise<{ status: number; body: Episode }>,
    ) => {
      const result = await work({});
      return { status: result.status, body: result.body, replayed: false };
    },
  } as unknown as IdempotencyService;
  return new EpisodesService(
    repositoryDouble(state),
    devicesDouble(),
    idempotency,
    {} as QrService,
  );
}

function freshState(overrides: Partial<CorrectionState> = {}): CorrectionState {
  return {
    locked: lockedEpisode(),
    appliedVia: null,
    applied: null,
    events: [],
    queued: [],
    ...overrides,
  };
}

function endInput(
  outcome: 'boarded' | 'abandoned' | 'passed_full' | 'cancelled',
  endedAt: Date,
): {
  outcome: 'boarded' | 'abandoned' | 'passed_full' | 'cancelled';
  clientEndedAt: string;
  clientEventId: string;
} {
  return {
    outcome,
    clientEndedAt: endedAt.toISOString(),
    clientEventId: '0192f0c4-0000-7000-8000-000000000001',
  };
}

describe('correctionWithinWindow', () => {
  const startedAt = new Date('2026-10-26T10:00:00.000Z');

  it('accepts a correction inside the default window', () => {
    expect(
      correctionWithinWindow({ startedAt, endedAt: new Date('2026-10-26T10:50:00.000Z') }),
    ).toBe(true);
  });

  it('rejects a correction past the window', () => {
    expect(
      correctionWithinWindow({ startedAt, endedAt: new Date('2026-10-26T14:00:00.000Z') }),
    ).toBe(false);
  });

  it('rejects an end before the start', () => {
    expect(
      correctionWithinWindow({ startedAt, endedAt: new Date('2026-10-26T09:00:00.000Z') }),
    ).toBe(false);
  });

  it('honours a custom window', () => {
    expect(
      correctionWithinWindow({
        startedAt,
        endedAt: new Date('2026-10-26T10:20:00.000Z'),
        windowMs: 10 * 60 * 1000,
      }),
    ).toBe(false);
  });
});

describe('EpisodesService.end on a timed out episode', () => {
  it('accepts a late boarding inside the window', async () => {
    const state = freshState();
    const endedAt = new Date(Date.now() - 2 * 60 * 1000);

    const episode = await buildService(state).end(
      EPISODE_ID,
      endInput('boarded', endedAt),
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(state.appliedVia).toBe('correction');
    expect(episode.outcome).toBe('boarded');
    expect(episode.durationS).toBeGreaterThan(45 * 60);
  });

  it('records a corrected event instead of an ended event', async () => {
    const state = freshState();

    await buildService(state).end(
      EPISODE_ID,
      endInput('abandoned', new Date(Date.now() - 60 * 1000)),
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(state.events.map((event) => event.kind)).toEqual(['corrected']);
    expect(state.events[0]?.payload).toMatchObject({ previousOutcome: 'timeout' });
  });

  it('flags the correction in the queued job', async () => {
    const state = freshState();

    await buildService(state).end(
      EPISODE_ID,
      endInput('boarded', new Date(Date.now() - 60 * 1000)),
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(state.queued[0]).toMatchObject({ corrected: true, outcome: 'boarded' });
  });

  it('refuses to correct a timeout into cancelled', async () => {
    const state = freshState();

    await expect(
      buildService(state).end(
        EPISODE_ID,
        endInput('cancelled', new Date(Date.now() - 60 * 1000)),
        KEY,
        DEVICE,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(state.appliedVia).toBeNull();
  });

  it('refuses a correction beyond the safety valve', async () => {
    const startedAt = new Date(Date.now() - 400 * 60 * 1000);
    const state = freshState({
      locked: lockedEpisode({ startedAt, clientStartedAt: startedAt }),
    });

    await expect(
      buildService(state).end(
        EPISODE_ID,
        endInput('boarded', new Date(Date.now() - 30 * 60 * 1000)),
        KEY,
        DEVICE,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(state.appliedVia).toBeNull();
  });

  it('never backdates endedAt to the wall clock', async () => {
    const state = freshState();
    const claimedEnd = new Date(Date.now() - 30 * 60 * 1000);

    const episode = await buildService(state).end(
      EPISODE_ID,
      endInput('boarded', claimedEnd),
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(state.applied?.endedAt.toISOString()).toBe(claimedEnd.toISOString());
    expect(episode.durationS).toBe(20 * 60);
  });
});

describe('EpisodesService.end on an already final episode', () => {
  it('still rejects a finished boarding', async () => {
    const state = freshState({ locked: lockedEpisode({ outcome: 'boarded' }) });

    await expect(
      buildService(state).end(
        EPISODE_ID,
        endInput('abandoned', new Date(Date.now() - 60 * 1000)),
        KEY,
        DEVICE,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('uses the normal path when the episode is still active', async () => {
    const state = freshState({
      locked: lockedEpisode({ outcome: null, endedAt: null, qualityFlags: [] }),
    });

    await buildService(state).end(
      EPISODE_ID,
      endInput('boarded', new Date(Date.now() - 60 * 1000)),
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(state.appliedVia).toBe('end');
    expect(state.events[0]?.kind).toBe('ended');
  });
});
