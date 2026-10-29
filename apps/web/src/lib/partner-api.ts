import type {
  PartnerActionInput,
  PartnerActionResult,
  PartnerAnalytics,
  PartnerProfile,
  PartnerReportDetail,
} from '@hadir/contracts';
import { queryOptions } from '@tanstack/react-query';
import { apiRequest, apiSendChecked, withQuery } from './api';
import type { InboxFilter } from './partner';
import {
  partnerActionResultSchema,
  partnerAnalyticsSchema,
  partnerInboxSchema,
  partnerOtpIssueSchema,
  partnerPasskeyListSchema,
  partnerProfileSchema,
  partnerReportSchema,
  partnerSessionInfoSchema,
  passkeyChallengeSchema,
  passkeyRegisteredSchema,
  passwordChangedSchema,
  sessionsRevokedSchema,
  type OtpIssue,
  type PartnerInbox,
  type PartnerPasskey,
  type PartnerSessionInfo,
  type PasskeyChallenge,
} from './partner-guards';

const PARTNER = '/v1/partner';
export const PARTNER_STALE_MS = 30_000;

export interface InboxRequest {
  filter: InboxFilter;
  cursor: string | null;
  limit: number;
}

export function profileQuery() {
  return queryOptions({
    queryKey: ['partner', 'me'] as const,
    queryFn: async (): Promise<PartnerProfile> =>
      (await apiSendChecked(`${PARTNER}/me`, partnerProfileSchema, { method: 'GET' })).data,
    staleTime: PARTNER_STALE_MS,
    gcTime: 5 * 60_000,
    retry: false,
  });
}

export async function fetchInbox(request: InboxRequest): Promise<PartnerInbox> {
  return (
    await apiSendChecked(
      withQuery(`${PARTNER}/reports`, {
        status: request.filter.status === 'all' ? undefined : request.filter.status,
        category: request.filter.category === 'all' ? undefined : request.filter.category,
        cursor: request.cursor ?? undefined,
        limit: request.limit,
      }),
      partnerInboxSchema,
      { method: 'GET' },
    )
  ).data;
}

export function inboxQuery(request: InboxRequest) {
  return queryOptions({
    queryKey: ['partner', 'inbox', request.filter, request.cursor, request.limit] as const,
    queryFn: () => fetchInbox(request),
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

export function partnerReportQuery(publicId: string) {
  return queryOptions({
    queryKey: ['partner', 'report', publicId] as const,
    queryFn: async (): Promise<PartnerReportDetail> =>
      (
        await apiSendChecked(
          `${PARTNER}/reports/${encodeURIComponent(publicId)}`,
          partnerReportSchema,
          { method: 'GET' },
        )
      ).data,
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    retry: false,
    enabled: publicId.length > 0,
  });
}

export function analyticsQuery(range: { from?: string; to?: string } = {}) {
  return queryOptions({
    queryKey: ['partner', 'analytics', range.from ?? null, range.to ?? null] as const,
    queryFn: async (): Promise<PartnerAnalytics> =>
      (
        await apiSendChecked(
          withQuery(`${PARTNER}/analytics`, { from: range.from, to: range.to }),
          partnerAnalyticsSchema,
          { method: 'GET' },
        )
      ).data,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

export function recentInboxQuery() {
  return inboxQuery({ filter: { status: 'all', category: 'all' }, cursor: null, limit: 5 });
}

export async function requestOtp(email: string): Promise<OtpIssue> {
  return (
    await apiSendChecked(`${PARTNER}/otp`, partnerOtpIssueSchema, {
      method: 'POST',
      body: { email },
    })
  ).data;
}

export async function loginWithOtp(email: string, code: string): Promise<PartnerProfile> {
  return (
    await apiSendChecked(`${PARTNER}/sessions`, partnerProfileSchema, {
      method: 'POST',
      body: { method: 'otp', email, code },
    })
  ).data;
}

export async function loginWithPassword(email: string, password: string): Promise<PartnerProfile> {
  return (
    await apiSendChecked(`${PARTNER}/sessions`, partnerProfileSchema, {
      method: 'POST',
      body: { method: 'password', email, password },
    })
  ).data;
}

export async function logoutPartner(): Promise<void> {
  await apiRequest<void>(`${PARTNER}/sessions/current`, { method: 'DELETE' });
}

export async function actOnReport(
  publicId: string,
  input: PartnerActionInput,
  idempotencyKey: string,
): Promise<PartnerActionResult> {
  return (
    await apiSendChecked(
      `${PARTNER}/reports/${encodeURIComponent(publicId)}/action`,
      partnerActionResultSchema,
      { method: 'POST', body: input, idempotencyKey },
    )
  ).data;
}

export function partnerSessionQuery() {
  return queryOptions({
    queryKey: ['partner', 'session'] as const,
    queryFn: async (): Promise<PartnerSessionInfo> =>
      (await apiSendChecked(`${PARTNER}/session`, partnerSessionInfoSchema, { method: 'GET' }))
        .data,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

export function passkeyListQuery() {
  return queryOptions({
    queryKey: ['partner', 'passkeys'] as const,
    queryFn: async (): Promise<PartnerPasskey[]> =>
      (await apiSendChecked(`${PARTNER}/passkeys`, partnerPasskeyListSchema, { method: 'GET' }))
        .data,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

export async function beginPasskeyRegistration(): Promise<PasskeyChallenge> {
  return (
    await apiSendChecked(`${PARTNER}/passkeys/registration/options`, passkeyChallengeSchema, {
      method: 'POST',
    })
  ).data;
}

export async function finishPasskeyRegistration(
  challengeId: string,
  response: Record<string, unknown>,
): Promise<void> {
  await apiSendChecked(`${PARTNER}/passkeys/registration/verify`, passkeyRegisteredSchema, {
    method: 'POST',
    body: { challengeId, response },
  });
}

export async function removePasskey(passkeyId: string): Promise<void> {
  await apiRequest<void>(`${PARTNER}/passkeys/${encodeURIComponent(passkeyId)}`, {
    method: 'DELETE',
  });
}

export async function changePartnerPassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ changed: boolean; revokedSessions: number }> {
  return (
    await apiSendChecked(`${PARTNER}/password`, passwordChangedSchema, {
      method: 'POST',
      body: { currentPassword, newPassword },
    })
  ).data;
}

export async function revokeAllPartnerSessions(): Promise<{ revoked: number }> {
  return (
    await apiSendChecked(`${PARTNER}/sessions`, sessionsRevokedSchema, { method: 'DELETE' })
  ).data;
}