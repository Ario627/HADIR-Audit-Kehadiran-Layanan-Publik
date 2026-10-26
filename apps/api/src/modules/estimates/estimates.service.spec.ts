import type { RouteSummary, StopDetail } from '@hadir/contracts';
import { env } from '../../common/config/env';
import type {
  EstimateBucketRow,
  EstimateFilters,
  EstimatesRepository,
  EstimatePopulationRow,
} from '../../db/repositories/estimates.repository';
import type { StopsService } from '../stops/stops.service';
import { EstimatesService } from './estimates.service';

const STOP_ID = '0192f0c4-0000-7000-8000-0000000000aa';
const ROUTE_ID = '0192f0c4-0000-7000-8000-0000000000bb';

const ROUTE: RouteSummary = {
  id: ROUTE_ID,
  code: 'K3A',
  name: 'Terminal - Kampus',
  promisedHeadwayPeakMin: 15,
  headwaySourceUrl: 'https://example.go.id/spm',
};

const OTHER_ROUTE: RouteSummary = {
  id: '0192f0c4-0000-7000-8000-0000000000cc',
  code: 'K4',
  name: 'Alun-Alun - Stasiun',
  promisedHeadwayPeakMin: 20,
  headwaySourceUrl: null,
};

function stop(): StopDetail {
  return {
    id: STOP_ID,
    code: 'BMS-A12',
    name: 'Halte UMP',
    location: { lat: -7.4112, lon: 109.2418 },
    status: 'active',
    isDemo: true,
    routes: [ROUTE, OTHER_ROUTE],
    description: null,
    geofenceRadiusM: 150,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

function bucket(overrides: Partial<EstimateBucketRow> = {}): EstimateBucketRow {
  return {
    day: '2026-10-20',
    hour: 7,
    durationS: 1_200,
    outcome: 'boarded',
    trustWeight: 0.9,
    count: 4,
    ...overrides,
  };
}

function buildBuckets(): EstimateBucketRow[] {
  const rows: EstimateBucketRow[] = [];
  for (let day = 0; day < 5; day += 1) {
    for (let hour = 6; hour < 10; hour += 1) {
      rows.push(
        bucket({
          day: `2026-10-${20 + day}`,
          hour,
          durationS: 900 + hour * 60,
          count: 3,
        }),
      );
    }
  }
  return rows;
}

interface RepositoryCalls {
  buckets: number;
  population: number;
  lastFilters: EstimateFilters | null;
}

function repositoryDouble(
  buckets: EstimateBucketRow[],
  population: EstimatePopulationRow,
  calls: RepositoryCalls,
): EstimatesRepository {
  return {
    loadBuckets: async (filters: EstimateFilters) => {
      calls.buckets += 1;
      calls.lastFilters = filters;
      return buckets;
    },
    loadPopulation: async () => {
      calls.population += 1;
      return population;
    },
  } as unknown as EstimatesRepository;
}

function stopsDouble(current: StopDetail): StopsService {
  return { getById: async () => current } as unknown as StopsService;
}

function buildService(
  buckets: EstimateBucketRow[],
  population: EstimatePopulationRow,
  calls: RepositoryCalls,
): EstimatesService {
  return new EstimatesService(
    stopsDouble(stop()),
    repositoryDouble(buckets, population, calls),
  );
}

function freshCalls(): RepositoryCalls {
  return { buckets: 0, population: 0, lastFilters: null };
}

describe('EstimatesService', () => {
  it('returns a strong estimate with confidence interval and sample metadata', async () => {
    const calls = freshCalls();
    const service = buildService(
      buildBuckets(),
      { episodes: 60, devices: 12, days: 5, hasSimulated: false },
      calls,
    );

    const estimate = await service.estimate(STOP_ID, { window: '7d', routeId: ROUTE_ID });

    expect(estimate.methodVersion).toBe('km-v1');
    expect(estimate.metrics.n).toBe(60);
    expect(estimate.metrics.rmstMin).not.toBeNull();
    expect(estimate.metrics.ci).not.toBeNull();
    expect(estimate.metrics.ewtMin).not.toBeNull();
    expect(estimate.promise).toMatchObject({ headwayMin: 15 });
    expect(estimate.sample).toMatchObject({ days: 5, devices: 12, clusters: 20 });
    expect(estimate.evidence).toBe('strong');
    expect(estimate.direction).toBe('excess');
    expect(estimate.simulated).toBe(false);
    expect(calls.lastFilters?.includeSimulated).toBe(env.devTools);
  });

  it('caps evidence when no corridor promise is supplied', async () => {
    const calls = freshCalls();
    const service = buildService(
      buildBuckets(),
      { episodes: 60, devices: 12, days: 5, hasSimulated: false },
      calls,
    );

    const estimate = await service.estimate(STOP_ID, { window: '7d' });

    expect(estimate.promise).toBeNull();
    expect(estimate.sample.thresholdMin).toBeNull();
    expect(estimate.metrics.ewtMin).toBeNull();
    expect(estimate.evidence).toBe('indication');
    expect(estimate.direction).toBe('inconclusive');
  });

  it('flags simulated data only when demo mode is enabled', async () => {
    const calls = freshCalls();
    const service = buildService(
      buildBuckets(),
      { episodes: 60, devices: 12, days: 5, hasSimulated: true },
      calls,
    );

    const estimate = await service.estimate(STOP_ID, { window: '7d' });

    expect(estimate.simulated).toBe(env.devTools);
  });

  it('serves repeated reads from the cache without hitting the database again', async () => {
    const calls = freshCalls();
    const service = buildService(
      buildBuckets(),
      { episodes: 60, devices: 12, days: 5, hasSimulated: false },
      calls,
    );

    const first = await service.estimate(STOP_ID, { window: '7d' });
    const second = await service.estimate(STOP_ID, { window: '7d' });

    expect(calls.buckets).toBe(1);
    expect(second.computedAt).toBe(first.computedAt);
  });

  it('separates cache entries per window', async () => {
    const calls = freshCalls();
    const service = buildService(
      buildBuckets(),
      { episodes: 60, devices: 12, days: 5, hasSimulated: false },
      calls,
    );

    await service.estimate(STOP_ID, { window: '7d' });
    await service.estimate(STOP_ID, { window: '30d' });

    expect(calls.buckets).toBe(2);
  });

  it('rejects a corridor that does not serve the stop', async () => {
    const calls = freshCalls();
    const service = buildService(
      buildBuckets(),
      { episodes: 60, devices: 12, days: 5, hasSimulated: false },
      calls,
    );

    await expect(
      service.estimate(STOP_ID, {
        window: '7d',
        routeId: '0192f0c4-0000-7000-8000-0000000000ff',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls.buckets).toBe(0);
  });

  it('returns an honest empty profile when no usable bucket exists', async () => {
    const calls = freshCalls();
    const service = buildService(
      [],
      { episodes: 0, devices: 0, days: 0, hasSimulated: false },
      calls,
    );

    const estimate = await service.estimate(STOP_ID, { window: '7d' });

    expect(estimate.metrics.n).toBe(0);
    expect(estimate.metrics.rmstMin).toBeNull();
    expect(estimate.metrics.ci).toBeNull();
    expect(estimate.evidence).toBe('none');
    expect(estimate.direction).toBe('inconclusive');
    expect(estimate.warnings).toContain('no_data');
    expect(estimate.message).toContain('Belum ada catatan');
  });

  it('caps device diversity at the analysed episode count', async () => {
    const calls = freshCalls();
    const service = buildService(
      [bucket({ count: 3 })],
      { episodes: 9, devices: 40, days: 1, hasSimulated: false },
      calls,
    );

    const estimate = await service.estimate(STOP_ID, { window: '7d' });

    expect(estimate.sample.devices).toBe(3);
  });

  it('does not claim excess when the interval sits below the threshold', async () => {
    const calls = freshCalls();
    const rows: EstimateBucketRow[] = [];
    for (let day = 0; day < 6; day += 1) {
      for (let hour = 6; hour < 11; hour += 1) {
        rows.push(bucket({ day: `2026-10-${20 + day}`, hour, durationS: 180, count: 4 }));
      }
    }
    const service = buildService(
      rows,
      { episodes: 120, devices: 15, days: 6, hasSimulated: false },
      calls,
    );

    const estimate = await service.estimate(STOP_ID, { window: '7d', routeId: ROUTE_ID });

    expect(estimate.direction).toBe('no_excess');
    expect(estimate.evidence).toBe('none');
    expect(estimate.message).toContain('Tidak ada kelebihan tunggu');
  });
});