import { Injectable } from '@nestjs/common';
import type { Estimate, EstimateQuery, RouteSummary, StopDetail } from '@hadir/contracts';
import { evidenceView, excessThreshold, summarizeEpisodes } from '@hadir/domain';
import { AppError } from '../../common/errors/app-error';
import {
  EstimatesRepository,
  type EstimateEpisodeRow,
} from '../../db/repositories/estimates.repository';
import { StopsService } from '../stops/stops.service';

const WINDOW_DAYS = { '7d': 7, '30d': 30 } as const;
const MAX_ROWS = 5_000;

function isUsable(row: EstimateEpisodeRow): boolean {
  return (
    row.outcome !== 'cancelled' &&
    row.outcome !== 'timeout' &&
    row.durationS !== null &&
    row.durationS >= 30
  );
}

function distinctDays(rows: readonly EstimateEpisodeRow[]): number {
  return new Set(rows.map((row) => row.day)).size;
}

function distinctDevices(rows: readonly EstimateEpisodeRow[]): number {
  return new Set(rows.map((row) => row.deviceHash)).size;
}

function distinctClusters(rows: readonly EstimateEpisodeRow[]): number {
  return new Set(rows.map((row) => `${row.day}:${row.hour}`)).size;
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

function messageFor(n: number, capped: boolean): string {
  if (n === 0) {
    return 'Belum ada catatan yang cukup di halte ini untuk jendela waktu tersebut.';
  }
  if (capped) {
    return `Sampel dibatasi ke ${n} catatan terbaru. Angka ini belum bisa dipakai untuk menyimpulkan.`;
  }
  if (n < 15) {
    return `Baru ${n} catatan. Belum cukup untuk menyimpulkan; tetap tampilkan apa adanya.`;
  }
  return `${n} catatan. Estimator survival dan interval kepercayaan belum aktif, jadi angka ini belum punya level bukti kuat.`;
}

@Injectable()
export class EstimatesService {
  constructor(
    private readonly stops: StopsService,
    private readonly estimates: EstimatesRepository,
  ) {}

  async estimate(stopId: string, query: EstimateQuery): Promise<Estimate> {
    const stop = await this.stops.getById(stopId);
    const routeId = query.routeId ?? null;
    const route = findRoute(stop, routeId);
    const days = WINDOW_DAYS[query.window];
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const rows = await this.estimates.loadEpisodes(stop.id, routeId, start, end);
    const capped = rows.length > MAX_ROWS;
    const sample = capped ? rows.slice(0, MAX_ROWS) : rows;
    const usable = sample.filter(isUsable);
    const stats = summarizeEpisodes(usable);
    const headway = route?.promisedHeadwayPeakMin ?? null;
    const threshold = excessThreshold(headway);
    const view = evidenceView({
      n: stats.n,
      days: distinctDays(usable),
      devices: distinctDevices(usable),
      clusters: distinctClusters(usable),
      ciLow: null,
      ciHigh: null,
      threshold,
      fieldVerified: false,
    });
    const warnings: string[] = [];
    if (capped) warnings.push('sample_capped');
    if (sample.some((row) => row.outcome === 'timeout')) {
      warnings.push('timeout_excluded');
    }
    if (stats.n === 0) {
      warnings.push('no_data');
    } else if (stats.n < 15) {
      warnings.push('small_n');
    }

    return {
      stopId: stop.id,
      stopCode: stop.code,
      routeId,
      window: {
        start: start.toISOString(),
        end: end.toISOString(),
        label: query.window,
      },
      metrics: {
        n: stats.n,
        medianMin: stats.medianMin,
        p95Min: stats.p95Min,
        meanMin: stats.meanMin,
        abandonRate: stats.abandonRate,
        ci: null,
      },
      promise:
        route !== null && headway !== null
          ? {
              headwayMin: headway,
              source: 'headway koridor',
              sourceUrl: route.headwaySourceUrl,
            }
          : null,
      evidence: view.evidence,
      direction: view.direction,
      message: messageFor(stats.n, capped),
      warnings,
      simulated: false,
      computedAt: end.toISOString(),
      methodVersion: 'simple-stats-v0',
    };
  }
}