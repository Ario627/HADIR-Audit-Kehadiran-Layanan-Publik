import type { ReportCategory, StopDetail } from '@hadir/contracts';
import type { DeviceIdentity } from '../../common/http/request-context';
import type {
  IdempotencyContext,
  IdempotencyService,
} from '../../common/idempotency/idempotency.service';
import type { DevicesRepository } from '../../db/repositories/devices.repository';
import type { TriageRepository } from '../../db/repositories/triage.repository';
import type { EstimatesService } from '../estimates/estimates.service';
import type { RunwayService } from '../runway/runway.service';
import type { StopsService } from '../stops/stops.service';
import { TriageService, radarState, serviceRunningFrom } from './triage.service';

const STOP_ID = '0192f0c4-0000-7000-8000-0000000000aa';
const ROUTE_ID = '0192f0c4-0000-7000-8000-0000000000bb';
const PILOT = '0192f0c4-0000-7000-8000-0000000000a1';
const SESSION_ID = '0192f0c4-0000-7000-8000-0000000000ff';

const DEVICE: DeviceIdentity = {
  hash: 'a'.repeat(64),
  dayHash: 'b'.repeat(64),
  isNew: false,
};

const CONTEXT: IdempotencyContext = { requestId: 'req-1', deviceHash: DEVICE.hash };
const KEY = '0192f0c4-0000-7000-8000-000000000002';

function stop(): StopDetail {
  return {
    id: STOP_ID,
    code: 'BMS-A12',
    name: 'Halte UMP',
    location: { lat: -7.4112, lon: 109.2418 },
    status: 'active',
    isDemo: false,
    routes: [
      {
        id: ROUTE_ID,
        code: 'K3A',
        name: 'Terminal - Kampus',
        promisedHeadwayPeakMin: 15,
        headwaySourceUrl: null,
      },
    ],
    description: null,
    geofenceRadiusM: 150,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

interface RunwayOutcome {
  status: string | null;
  fail: boolean;
}

function repositoryDouble(): TriageRepository {
  return {
    countDuplicates: async () => 0,
    findPlannedEvidence: async () => [],
    routeServesStop: async () => true,
    findAuthority: async () => null,
    findPilotInstitution: async () => PILOT,
    insertSession: async (
      _tx: unknown,
      values: { verdict: string; evidenceIds: readonly string[]; connectors: Record<string, string>; latencyMs: number },
    ) => ({
      id: SESSION_ID,
      verdict: values.verdict,
      evidenceIds: [...values.evidenceIds],
      connectors: values.connectors,
      latencyMs: values.latencyMs,
      createdAt: new Date('2026-10-26T10:00:00.000Z'),
    }),
    findSessionForDevice: async () => null,
    attachReport: async () => undefined,
  } as unknown as TriageRepository;
}

function estimatesDouble(): EstimatesService {
  return {
    estimate: async () => ({
      stopId: STOP_ID,
      stopCode: 'BMS-A12',
      routeId: ROUTE_ID,
      window: {
        start: '2026-10-19T00:00:00.000Z',
        end: '2026-10-26T00:00:00.000Z',
        label: '7d',
      },
      metrics: {
        n: 0,
        nEffective: null,
        medianMin: null,
        meanMin: null,
        rmstMin: null,
        p95Min: null,
        ewtMin: null,
        abandonRate: null,
        fullRate: null,
        cifAbandon: null,
        timeToBoardRmstMin: null,
        ci: null,
      },
      promise: null,
      evidence: 'none',
      direction: 'inconclusive',
      message: '',
      warnings: [],
      simulated: false,
      sample: {
        days: 0,
        devices: 0,
        clusters: 0,
        designEffect: 1,
        thresholdMin: null,
      },
      computedAt: '2026-10-26T00:00:00.000Z',
      methodVersion: 'km-v1',
    }),
  } as unknown as EstimatesService;
}

function runwayDouble(outcome: RunwayOutcome): RunwayService {
  return {
    statusFor: async () => {
      if (outcome.fail) {
        throw new Error('runway down');
      }
      return outcome.status;
    },
  } as unknown as RunwayService;
}

function buildService(outcome: RunwayOutcome): TriageService {
  const idempotency = {
    execute: async (
      _input: unknown,
      work: (tx: unknown) => Promise<{ status: number; body: unknown }>,
    ) => {
      const result = await work({});
      return { status: result.status, body: result.body, replayed: false };
    },
  } as unknown as IdempotencyService;
  const devices = {
    findByHash: async () => ({ id: 'd1', trustScore: 0.5, revokedAt: null }),
  } as unknown as DevicesRepository;
  const stops = { getByCode: async () => stop() } as unknown as StopsService;
  return new TriageService(
    repositoryDouble(),
    devices,
    stops,
    estimatesDouble(),
    runwayDouble(outcome),
    idempotency,
  );
}

function input(category: ReportCategory = 'service_wait', routeId: string | null = ROUTE_ID) {
  return {
    stopCode: 'BMS-A12',
    routeId,
    category,
    clientEventId: '0192f0c4-0000-7000-8000-000000000001',
  };
}

describe('radar state helpers', () => {
  it('distinguishes not applicable from failed', () => {
    expect(radarState({ kind: 'not_applicable' })).toBe('not_configured');
    expect(radarState({ kind: 'unavailable' })).toBe('unavailable');
    expect(radarState({ kind: 'ok', status: 'funded' })).toBe('ok');
  });

  it('never reports a running state for an unqueried corridor', () => {
    expect(serviceRunningFrom(false, 'funded')).toBeNull();
    expect(serviceRunningFrom(true, null)).toBeNull();
  });
});

describe('TriageService with runway available', () => {
  it('fires service_not_running when the corridor is stopped', async () => {
    const service = buildService({ status: 'stopped', fail: false });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).toBe('service_not_running');
    expect(result.connectors.radar).toBe('ok');
    expect(result.actions.some((action) => action.kind === 'open_radar')).toBe(true);
  });

  it('does not claim a stoppage for a funded corridor', async () => {
    const service = buildService({ status: 'funded', fail: false });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).not.toBe('service_not_running');
  });

  it('stays neutral for a pending corridor', async () => {
    const service = buildService({ status: 'pending', fail: false });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).not.toBe('service_not_running');
    expect(result.connectors.radar).toBe('ok');
  });

  it('marks the connector unavailable when the lookup fails', async () => {
    const service = buildService({ status: null, fail: true });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).not.toBe('service_not_running');
    expect(result.connectors.radar).toBe('unavailable');
  });

  it('reports not_configured when the client sends no corridor', async () => {
    const service = buildService({ status: 'stopped', fail: false });

    const result = await service.triage(input('service_wait', null), KEY, DEVICE, CONTEXT);

    expect(result.verdict).not.toBe('service_not_running');
    expect(result.connectors.radar).toBe('not_configured');
  });

  it('still allows sending the report when the radar is down', async () => {
    const service = buildService({ status: null, fail: true });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.actions.at(-1)?.kind).toBe('send_anyway');
  });
});
