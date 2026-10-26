import type { ReportCategory, StopDetail } from '@hadir/contracts';
import type { DeviceIdentity } from '../../common/http/request-context';
import type {
  IdempotencyContext,
  IdempotencyService,
} from '../../common/idempotency/idempotency.service';
import type { DevicesRepository } from '../../db/repositories/devices.repository';
import type { EvidenceRow, TriageRepository } from '../../db/repositories/triage.repository';
import type { EstimatesService } from '../estimates/estimates.service';
import type { RunwayService } from '../runway/runway.service';
import type { StopsService } from '../stops/stops.service';
import { TriageService } from './triage.service';

const STOP_ID = '0192f0c4-0000-7000-8000-0000000000aa';
const ROUTE_ID = '0192f0c4-0000-7000-8000-0000000000bb';
const PILOT = '0192f0c4-0000-7000-8000-0000000000a1';
const OTHER = '0192f0c4-0000-7000-8000-0000000000a2';
const SESSION_ID = '0192f0c4-0000-7000-8000-0000000000ff';

const DEVICE: DeviceIdentity = {
  hash: 'a'.repeat(64),
  dayHash: 'b'.repeat(64),
  isNew: false,
};

const CONTEXT: IdempotencyContext = { requestId: 'req-1', deviceHash: DEVICE.hash };

interface FactOverrides {
  duplicates?: number;
  duplicatesFail?: boolean;
  planned?: EvidenceRow[];
  plannedFail?: boolean;
  authority?: { institutionId: string; institutionName: string } | null;
  authorityFail?: boolean;
  pilot?: string | null;
  pilotFail?: boolean;
  estimate?: { evidence: 'none' | 'indication' | 'strong'; n: number } | null;
  estimateFail?: boolean;
  routeServed?: boolean;
  estimateRoutes?: (string | null)[];
  runwayStatus?: 'funded' | 'pending' | 'stopped' | 'unknown' | null;
  runwayFail?: boolean;
}

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

function evidence(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    claim: 'Paket pemeliharaan halte BTS tahun 2026',
    tier: 'T1',
    sourceUrl: 'https://sirup.example.go.id/paket/1',
    retrievedAt: new Date('2026-10-20T00:00:00.000Z'),
    matchScore: 0.88,
    ...overrides,
  };
}

function failing(): never {
  throw new Error('connector down');
}

function repositoryDouble(overrides: FactOverrides): TriageRepository {
  return {
    countDuplicates: async () =>
      overrides.duplicatesFail === true ? failing() : (overrides.duplicates ?? 0),
    findPlannedEvidence: async () =>
      overrides.plannedFail === true ? failing() : (overrides.planned ?? []),
    routeServesStop: async () => overrides.routeServed ?? true,
    findAuthority: async () =>
      overrides.authorityFail === true ? failing() : (overrides.authority ?? null),
    findPilotInstitution: async () =>
      overrides.pilotFail === true ? failing() : (overrides.pilot ?? PILOT),
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

function estimatesDouble(overrides: FactOverrides): EstimatesService {
  return {
    estimate: async (_stopId: string, query: { routeId?: string }) => {
      overrides.estimateRoutes?.push(query.routeId ?? null);
      if (overrides.estimateFail === true) {
        failing();
      }
      const signal = overrides.estimate ?? null;
      return {
        stopId: STOP_ID,
        stopCode: 'BMS-A12',
        routeId: null,
        window: {
          start: '2026-10-19T00:00:00.000Z',
          end: '2026-10-26T00:00:00.000Z',
          label: '7d',
        },
        metrics: {
          n: signal?.n ?? 0,
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
        evidence: signal?.evidence ?? 'none',
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
      };
    },
  } as unknown as EstimatesService;
}

function runwayDouble(overrides: FactOverrides): RunwayService {
  return {
    statusFor: async () => {
      if (overrides.runwayFail === true) {
        failing();
      }
      return overrides.runwayStatus === undefined ? null : overrides.runwayStatus;
    },
  } as unknown as RunwayService;
}

function buildService(overrides: FactOverrides): {
  service: TriageService;
  scopes: string[];
  inserted: Record<string, unknown>[];
} {
  const scopes: string[] = [];
  const inserted: Record<string, unknown>[] = [];
  const tracking: TriageRepository = {
    countDuplicates: async () =>
      overrides.duplicatesFail === true ? failing() : (overrides.duplicates ?? 0),
    findPlannedEvidence: async () =>
      overrides.plannedFail === true ? failing() : (overrides.planned ?? []),
    findAuthority: async () =>
      overrides.authorityFail === true ? failing() : (overrides.authority ?? null),
    findPilotInstitution: async () =>
      overrides.pilotFail === true ? failing() : (overrides.pilot ?? PILOT),
    insertSession: async (tx: never, values: never) => {
      inserted.push(values as unknown as Record<string, unknown>);
      return repositoryDouble(overrides).insertSession(tx, values);
    },
    findSessionForDevice: async () => null,
    attachReport: async () => undefined,
  } as unknown as TriageRepository;
  const idempotency = {
    execute: async (
      input: { scope: string },
      work: (tx: unknown) => Promise<{ status: number; body: unknown }>,
    ) => {
      scopes.push(input.scope);
      const result = await work({});
      return { status: result.status, body: result.body, replayed: false };
    },
  } as unknown as IdempotencyService;
  const devices = {
    findByHash: async () => ({ id: 'd1', trustScore: 0.5, revokedAt: null }),
  } as unknown as DevicesRepository;
  const stops = { getByCode: async () => stop() } as unknown as StopsService;
  return {
    service: new TriageService(
      tracking,
      devices,
      stops,
      estimatesDouble(overrides),
      runwayDouble(overrides),
      idempotency,
    ),
    scopes,
    inserted,
  };
}

function input(category: ReportCategory = 'service_wait') {
  return {
    stopCode: 'BMS-A12',
    category,
    clientEventId: '0192f0c4-0000-7000-8000-000000000001',
  };
}

const KEY = '0192f0c4-0000-7000-8000-000000000002';

describe('TriageService.triage', () => {
  it('scopes idempotency per device and hides the verdict behind a session', async () => {
    const { service, scopes } = buildService({});

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(scopes).toEqual([`triage.${DEVICE.hash}`]);
    expect(result.sessionId).toBe(SESSION_ID);
    expect(result.rulesVersion).toBe('triage-v1');
    expect(result.actions.at(-1)?.kind).toBe('send_anyway');
  });

  it('rejects devices that never completed bootstrap', async () => {
    const { service } = buildService({});

    await expect(
      service.triage(input(), KEY, { ...DEVICE, isNew: true }, CONTEXT),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('merges when duplicates exist and reports the count', async () => {
    const { service } = buildService({ duplicates: 3 });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).toBe('join');
    expect(result.reasons[0]).toContain('3');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('does not merge when the duplicate connector fails', async () => {
    const { service } = buildService({ duplicates: 5, duplicatesFail: true });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).not.toBe('join');
    expect(result.connectors.duplicates).toBe('unavailable');
  });

  it('surfaces planning evidence with a tier label', async () => {
    const { service } = buildService({ planned: [evidence()] });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).toBe('already_planned');
    expect(result.evidence[0]).toMatchObject({ tier: 'T1', label: 'terkait' });
  });

  it('marks low-confidence planning matches as possible', async () => {
    const { service } = buildService({ planned: [evidence({ matchScore: 0.4 })] });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.evidence[0]?.label).toBe('mungkin terkait');
  });

  it('routes to another authority when the pilot institution differs', async () => {
    const { service } = buildService({
      authority: { institutionId: OTHER, institutionName: 'PUPR Banyumas' },
    });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).toBe('wrong_authority');
    expect(result.actions.some((action) => action.kind === 'send_elsewhere')).toBe(true);
  });

  it('keeps the verdict neutral when the authority map is unavailable', async () => {
    const { service } = buildService({
      authority: { institutionId: OTHER, institutionName: 'PUPR Banyumas' },
      authorityFail: true,
    });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).not.toBe('wrong_authority');
    expect(result.connectors.authority).toBe('unavailable');
  });

  it('supports the complaint when measurements exist', async () => {
    const { service } = buildService({ estimate: { evidence: 'strong', n: 40 } });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).toBe('data_supports');
  });

  it('asks for more measurement on a thin sample', async () => {
    const { service } = buildService({ estimate: { evidence: 'none', n: 6 } });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.verdict).toBe('data_insufficient');
    expect(result.actions.some((action) => action.kind === 'measure')).toBe(true);
  });

  it('ignores measurement signals for facility complaints', async () => {
    const { service } = buildService({ estimate: { evidence: 'strong', n: 40 } });

    const result = await service.triage(input('stop_facility'), KEY, DEVICE, CONTEXT);

    expect(result.verdict).toBe('new_report');
  });

  it('stores no complaint text and no coordinates in the session', async () => {
    const { service, inserted } = buildService({});

    await service.triage(
      { ...input(), text: 'Atap halte bocor sejak kemarin' },
      KEY,
      DEVICE,
      CONTEXT,
    );

    const stored = inserted[0];
    expect(stored).toBeDefined();
    expect(JSON.stringify(stored)).not.toContain('Atap halte bocor');
    expect(stored).not.toHaveProperty('lat');
    expect(stored).not.toHaveProperty('lon');
  });

  it('records connector states for auditability', async () => {
    const { service } = buildService({ estimateFail: true });

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.connectors).toMatchObject({
      estimate: 'unavailable',
      radar: 'not_configured',
      duplicates: 'ok',
    });
  });

  it('reports the radar as not configured instead of guessing', async () => {
    const { service } = buildService({});

    const result = await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(result.connectors.radar).toBe('not_configured');
  });
});

describe('TriageService corridor handling', () => {
  it('passes the corridor to the estimate so the promise threshold applies', async () => {
    const routes: (string | null)[] = [];
    const { service } = buildService({ estimateRoutes: routes });

    await service.triage(
      { ...input(), routeId: ROUTE_ID },
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(routes).toEqual([ROUTE_ID]);
  });

  it('omits the corridor when the client does not supply one', async () => {
    const routes: (string | null)[] = [];
    const { service } = buildService({ estimateRoutes: routes });

    await service.triage(input(), KEY, DEVICE, CONTEXT);

    expect(routes).toEqual([null]);
  });

  it('rejects a corridor that does not serve the stop', async () => {
    const routes: (string | null)[] = [];
    const { service } = buildService({ estimateRoutes: routes });

    await expect(
      service.triage(
        { ...input(), routeId: '0192f0c4-0000-7000-8000-0000000000ff' },
        KEY,
        DEVICE,
        CONTEXT,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(routes).toEqual([]);
  });

  it('treats a null corridor the same as an absent one', async () => {
    const routes: (string | null)[] = [];
    const { service } = buildService({ estimateRoutes: routes });

    await service.triage(
      { ...input(), routeId: null },
      KEY,
      DEVICE,
      CONTEXT,
    );

    expect(routes).toEqual([null]);
  });
});

describe('TriageService.rules', () => {  it('publishes every verdict with copy and thresholds', async () => {
    const { service } = buildService({});

    const rules = service.rules();

    expect(rules.rulesVersion).toBe('triage-v1');
    expect(rules.verdicts).toHaveLength(7);
    expect(rules.thresholds).toMatchObject({
      minSample: 15,
      possibleMatch: 0.7,
      duplicateRadiusM: 75,
      duplicateWindowDays: 60,
    });
    expect(rules.alwaysAvailableAction).toBe('send_anyway');
  });
});

describe('TriageService.getSession', () => {
  it('returns not found for another device', async () => {
    const { service } = buildService({});

    await expect(
      service.getSession(SESSION_ID, DEVICE),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
