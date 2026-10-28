import type {
  CoveragePeriod,
  Estimate,
  QrLanding,
  ReportDetail,
  ReportListItem,
  RouteStopList,
  Runway,
  StopSummary,
} from '@hadir/contracts';
import { queryOptions } from '@tanstack/react-query';
import { apiGetChecked, apiSendChecked, withQuery } from './api';
import {
  activeEpisodeQueryKey,
  episodeQueryKey,
  fetchActiveEpisode,
  fetchEpisode,
} from './episode-api';
import type { EstimateWindow } from './estimate';
import {
  coverageSummarySchema,
  estimateSchema,
  methodologySchema,
  qrLandingSchema,
  reportListSchema,
  routeStopListSchema,
  runwayListSchema,
  runwaySchema,
  stopListSchema,
} from './guards';
import { fetchReport, reportQueryKey } from './report-api';
import { readQrProof, type QrSearchInput } from './qr';

export interface StopListInput {
  q: string;
  limit: number;
}

export interface StopListResult {
  items: StopSummary[];
  hasMore: boolean;
}

export function stopsQuery(input: StopListInput) {
  return queryOptions({
    queryKey: ['stops', input.q, input.limit] as const,
    queryFn: async (): Promise<StopListResult> => {
      const envelope = await apiGetChecked(
        withQuery('/v1/stops', {
          q: input.q.length === 0 ? undefined : input.q,
          limit: input.limit,
        }),
        stopListSchema,
      );
      return { items: envelope.data, hasMore: envelope.meta.hasMore === true };
    },
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

export function coverageSummaryQuery(period: CoveragePeriod) {
  return queryOptions({
    queryKey: ['coverage', 'summary', period] as const,
    queryFn: async () =>
      (await apiGetChecked(withQuery('/v1/coverage/summary', { period }), coverageSummarySchema)).data,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function methodologyQuery() {
  return queryOptions({
    queryKey: ['methodology'] as const,
    queryFn: async () => (await apiGetChecked('/v1/methodology', methodologySchema)).data,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

export function qrLandingQuery(stopCode: string, search: QrSearchInput) {
  const proof = readQrProof(search);
  return queryOptions({
    queryKey: ['qr-landing', stopCode, proof?.signature ?? null] as const,
    queryFn: async (): Promise<QrLanding> => {
      if (proof === null) {
        throw new Error('Bukti QR tidak lengkap.');
      }
      return (
        await apiSendChecked(
          withQuery(`/v1/s/${encodeURIComponent(stopCode)}`, {
            e: proof.epoch,
            k: proof.keyId,
            s: proof.signature,
          }),
          qrLandingSchema,
          { method: 'GET' },
        )
      ).data;
    },
    enabled: proof !== null,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export function episodeQuery(episodeId: string) {
  return queryOptions({
    queryKey: episodeQueryKey(episodeId),
    queryFn: () => fetchEpisode(episodeId),
    staleTime: 5_000,
    gcTime: 30 * 60_000,
  });
}

export function activeEpisodeQuery() {
  return queryOptions({
    queryKey: activeEpisodeQueryKey(),
    queryFn: fetchActiveEpisode,
    staleTime: 15_000,
    gcTime: 30 * 60_000,
  });
}

export function estimateQuery(stopId: string, window: EstimateWindow, routeId: string | null) {
  return queryOptions({
    queryKey: ['estimate', stopId, window, routeId] as const,
    queryFn: async (): Promise<Estimate> =>
      (
        await apiGetChecked(
          withQuery(`/v1/stops/${stopId}/estimate`, {
            window,
            routeId: routeId === null ? undefined : routeId,
          }),
          estimateSchema,
        )
      ).data,
    staleTime: 60_000,
    gcTime: 60 * 60_000,
  });
}

export function routeStopsQuery(routeId: string) {
  return queryOptions({
    queryKey: ['route', routeId, 'stops'] as const,
    queryFn: async (): Promise<RouteStopList> =>
      (await apiGetChecked(`/v1/routes/${routeId}/stops`, routeStopListSchema)).data,
    staleTime: 30 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

export function runwayListQuery() {
  return queryOptions({
    queryKey: ['runway'] as const,
    queryFn: async (): Promise<Runway[]> =>
      (await apiGetChecked('/v1/runway', runwayListSchema)).data,
    staleTime: 30 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}

export function reportQuery(publicId: string) {
  return queryOptions({
    queryKey: reportQueryKey(publicId),
    queryFn: async (): Promise<ReportDetail> => fetchReport(publicId),
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  });
}

export function myReportsQuery() {
  return queryOptions({
    queryKey: ['reports', 'mine'] as const,
    queryFn: async (): Promise<ReportListItem[]> =>
      (await apiGetChecked('/v1/reports/mine', reportListSchema)).data,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function runwayByRouteQuery(routeId: string) {
  return queryOptions({
    queryKey: ['runway', 'route', routeId] as const,
    queryFn: async (): Promise<Runway> =>
      (await apiGetChecked(`/v1/services/${routeId}/runway`, runwaySchema)).data,
    staleTime: 30 * 60_000,
    gcTime: 24 * 60 * 60_000,
  });
}
