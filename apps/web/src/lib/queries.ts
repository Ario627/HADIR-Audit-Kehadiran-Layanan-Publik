import type { CoveragePeriod, QrLanding, StopSummary } from '@hadir/contracts';
import { queryOptions } from '@tanstack/react-query';
import { apiGetChecked, apiSendChecked, withQuery } from './api';
import {
  activeEpisodeQueryKey,
  episodeQueryKey,
  fetchActiveEpisode,
  fetchEpisode,
} from './episode-api';
import {
  coverageSummarySchema,
  methodologySchema,
  qrLandingSchema,
  stopListSchema,
} from './guards';
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
