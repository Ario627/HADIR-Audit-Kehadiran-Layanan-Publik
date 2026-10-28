import { Injectable } from '@nestjs/common';
import type { Estimate, EstimateQuery, RouteSummary, StopDetail } from '@hadir/contracts';
import {
  estimateWaitBuckets,
  evidenceLevel,
  type EvidenceLevel,
  type WaitEpisodeBucket,
} from '@hadir/domain';
import { MemoCache } from '../../common/cache/memo-cache';
import { env } from '../../common/config/env';
import type { BboxValue } from '../../common/geo/bbox';
import { AppError } from '../../common/errors/app-error';
import {
  EstimatesRepository,
  estimateRepositoryLimits,
  type EstimateBucketRow,
} from '../../db/repositories/estimates.repository';
import { StopsService } from '../stops/stops.service';

const WINDOW_DAYS = { '7d': 7, '30d': 30 } as const;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 2_000;
const COVERAGE_TTL_MS = 15 * 60 * 1000;

export type CoveragePeriod = keyof typeof WINDOW_DAYS;

export interface CoverageRequest {
  period: CoveragePeriod;
  routeId: string | null;
  bbox: BboxValue | null;
}

export interface CoverageCell {
  stopId: string;
  stopCode: string;
  stopName: string;
  hour: number;
  n: number;
  devices: number;
  days: number;
  level: EvidenceLevel;
}

export interface CoverageSummaryItem {
  stopId: string;
  stopCode: string;
  stopName: string;
  n: number;
  devices: number;
  days: number;
  clusters: number;
  hoursCovered: number;
  level: EvidenceLevel;
}

interface EstimateWindow {
  start: Date;
  end: Date;
}

function findRoute(stop: StopDetail, routeId: string | null): RouteSummary | null {
  if (routeId === null) {
    return null;
  }
  const route = stop.routes.find((item) => item.id === routeId);
  if (route === undefined) {
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
  return route;
}

function windowFor(label: EstimateQuery['window'], now: Date): EstimateWindow {
  const end = new Date(now);
  const start = new Date(end.getTime() - WINDOW_DAYS[label] * 24 * 60 * 60 * 1000);
  return { start, end };
}

function toBucket(row: EstimateBucketRow): WaitEpisodeBucket {
  return {
    durationS: row.durationS,
    outcome: row.outcome as WaitEpisodeBucket['outcome'],
    count: row.count,
    trustWeight: row.trustWeight,
    day: row.day,
    hour: row.hour,
  };
}

function messageFor(input: {
  n: number;
  evidence: Estimate['evidence'];
  direction: Estimate['direction'];
  simulated: boolean;
}): string {
  if (input.n === 0) {
    return 'Belum ada catatan yang layak di halte ini pada jendela waktu tersebut.';
  }
  if (input.direction === 'no_excess') {
    return `${input.n} catatan. Tidak ada kelebihan tunggu yang terdeteksi pada interval ini, tetapi itu bukan bukti layanan patuh sepenuhnya.`;
  }
  if (input.evidence === 'strong' || input.evidence === 'field_verified') {
    return `${input.n} catatan. Bukti cukup kuat untuk dibandingkan dengan janji layanan; tetap ada ketidakpastian pada interval di bawah.`;
  }
  if (input.evidence === 'indication') {
    return `${input.n} catatan. Ini baru indikasi, belum cukup untuk menyimpulkan.`;
  }
  return `${input.n} catatan. Belum cukup untuk menyimpulkan; angka ditampilkan apa adanya.`;
}

function coverageLevel(input: {
  n: number;
  days: number;
  devices: number;
  clusters: number;
}): EvidenceLevel {
  return evidenceLevel({
    n: input.n,
    days: input.days,
    devices: input.devices,
    clusters: input.clusters,
    ciLow: null,
    threshold: null,
  });
}

@Injectable()
export class EstimatesService {
  private readonly cache = new MemoCache<Estimate>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES,
  });
  private readonly coverageCache = new MemoCache<{
    period: CoveragePeriod;
    cells: CoverageCell[];
  }>({ ttlMs: COVERAGE_TTL_MS, maxEntries: 512 });
  private readonly coverageSummaryCache = new MemoCache<{
    period: CoveragePeriod;
    stops: CoverageSummaryItem[];
  }>({ ttlMs: COVERAGE_TTL_MS, maxEntries: 512 });

  constructor(
    private readonly stops: StopsService,
    private readonly estimates: EstimatesRepository,
  ) {}

  private async compute(
    stop: StopDetail,
    route: RouteSummary | null,
    routeId: string | null,
    query: EstimateQuery,
    window: EstimateWindow,
    includeSimulated: boolean,
  ): Promise<Estimate> {
    const filters = {
      stopId: stop.id,
      routeId,
      start: window.start,
      end: window.end,
      includeSimulated,
    };
    const [buckets, population] = await Promise.all([
      this.estimates.loadBuckets(filters),
      this.estimates.loadPopulation(filters),
    ]);

    const counted = buckets.reduce((sum, row) => sum + row.count, 0);
    const devices = Math.min(population.devices, counted);
    const simulated = includeSimulated && population.hasSimulated;

    const result = estimateWaitBuckets(
      buckets.map(toBucket),
      { devices, simulated },
      {
        tauS: env.episodeTauMinutes * 60,
        headwayMinutes: route?.promisedHeadwayPeakMin ?? null,
        includeSimulated,
      },
    );

    const warnings = [...result.warnings];
    if (buckets.length >= estimateRepositoryLimits.maxBucketRows) {
      warnings.push('bucket_capped');
    }

    return {
      stopId: stop.id,
      stopCode: stop.code,
      routeId,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        label: query.window,
      },
      metrics: {
        n: result.n,
        nEffective: result.n <= 0 ? null : result.nEffective,
        medianMin: result.medianMin,
        meanMin: result.meanMin,
        rmstMin: result.rmstMin,
        p95Min: result.p95Min,
        ewtMin: result.ewtMin,
        abandonRate: result.abandonRate,
        fullRate: result.fullRate,
        cifAbandon: result.cifAbandon,
        timeToBoardRmstMin: result.timeToBoardRmstMin,
        ci: result.ci,
      },
      promise:
        route !== null && route.promisedHeadwayPeakMin !== null
          ? {
              headwayMin: route.promisedHeadwayPeakMin,
              source: 'headway koridor',
              sourceUrl: route.headwaySourceUrl,
            }
          : null,
      evidence: result.evidence,
      direction: result.direction,
      message: messageFor({
        n: result.n,
        evidence: result.evidence,
        direction: result.direction,
        simulated,
      }),
      warnings,
      simulated,
      sample: {
        days: result.days,
        devices: result.devices,
        clusters: result.clusters,
        designEffect: result.designEffect,
        thresholdMin: result.thresholdMin,
      },
      computedAt: new Date().toISOString(),
      methodVersion: result.methodVersion,
    };
  }

  async estimate(stopId: string, query: EstimateQuery): Promise<Estimate> {
    const stop = await this.stops.getById(stopId);
    const routeId = query.routeId ?? null;
    const route = findRoute(stop, routeId);
    const includeSimulated = env.devTools;
    const window = windowFor(query.window, new Date());
    const key = [
      stop.id,
      routeId ?? '-',
      query.window,
      includeSimulated ? 'demo' : 'live',
    ].join('|');

    return this.cache.getOrLoad(key, () =>
      this.compute(stop, route, routeId, query, window, includeSimulated),
    );
  }

  private coverageKey(request: CoverageRequest): string {
    const bbox = request.bbox;
    const bboxKey =
      bbox === null
        ? '-'
        : [bbox.minLon, bbox.minLat, bbox.maxLon, bbox.maxLat].join(',');
    return [
      request.period,
      request.routeId ?? '-',
      bboxKey,
      env.devTools ? 'demo' : 'live',
    ].join('|');
  }

  private async computeCoverage(
    request: CoverageRequest,
    window: EstimateWindow,
  ): Promise<{ period: CoveragePeriod; cells: CoverageCell[] }> {
    const rows = await this.estimates.loadCoverage({
      start: window.start,
      end: window.end,
      routeId: request.routeId,
      bbox: request.bbox,
      includeSimulated: env.devTools,
    });

    return {
      period: request.period,
      cells: rows.map((row) => ({
        stopId: row.stopId,
        stopCode: row.stopCode,
        stopName: row.stopName,
        hour: row.hour,
        n: row.n,
        devices: row.devices,
        days: row.days,
        level: coverageLevel({
          n: row.n,
          days: row.days,
          devices: row.devices,
          clusters: row.days,
        }),
      })),
    };
  }

  private async computeCoverageSummary(
    request: CoverageRequest,
    window: EstimateWindow,
  ): Promise<{ period: CoveragePeriod; stops: CoverageSummaryItem[] }> {
    const rows = await this.estimates.loadCoverageSummary({
      start: window.start,
      end: window.end,
      routeId: request.routeId,
      bbox: request.bbox,
      includeSimulated: env.devTools,
    });

    return {
      period: request.period,
      stops: rows.map((row) => ({
        stopId: row.stopId,
        stopCode: row.stopCode,
        stopName: row.stopName,
        n: row.n,
        devices: row.devices,
        days: row.days,
        clusters: row.clusters,
        hoursCovered: row.hoursCovered,
        level: coverageLevel({
          n: row.n,
          days: row.days,
          devices: row.devices,
          clusters: row.clusters,
        }),
      })),
    };
  }

  async coverage(
    request: CoverageRequest,
  ): Promise<{ period: CoveragePeriod; cells: CoverageCell[] }> {
    const window = windowFor(request.period, new Date());
    return this.coverageCache.getOrLoad(this.coverageKey(request), () =>
      this.computeCoverage(request, window),
    );
  }

  async coverageSummary(
    request: CoverageRequest,
  ): Promise<{ period: CoveragePeriod; stops: CoverageSummaryItem[] }> {
    const window = windowFor(request.period, new Date());
    return this.coverageSummaryCache.getOrLoad(this.coverageKey(request), () =>
      this.computeCoverageSummary(request, window),
    );
  }
}