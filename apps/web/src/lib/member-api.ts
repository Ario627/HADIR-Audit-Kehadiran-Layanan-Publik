import type {
  CaseFile,
  PartnerInvite,
  PartnerInviteIssued,
  PartnerMemberList,
  PanelView,
  ReportResponse,
} from '@hadir/contracts';
import { apiGetChecked, apiRequest, apiSendChecked, withQuery } from './api';
import type { PayloadSchema } from './api';
import { caseFileSchema } from './evidence-guards';
import { panelSchema } from './governance-guards';
import { isRecord, readCount, readIsoDateTime, readNullableText, readText } from './guards';

const PARTNER_PATH = '/v1/partner';
const MEMBER_ROLES = ['viewer', 'responder', 'admin'] as const;
const MEMBER_STATUSES = ['active', 'suspended', 'revoked'] as const;
const RESPONSE_KINDS = ['initial', 'follow_up', 'closure_claim', 'correction'] as const;

function pick<T extends string>(allowed: readonly T[], value: unknown): T | null {
  return allowed.some((entry) => entry === value) ? (value as T) : null;
}

function readUrlList(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) {
    return null;
  }
  const out: string[] = [];
  for (const entry of value) {
    const text = readText(entry, 500);
    if (text === null) {
      return null;
    }
    out.push(text);
  }
  return out;
}

export const memberListSchema: PayloadSchema<PartnerMemberList> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.members) || !Array.isArray(value.caveats)) {
      return { success: false };
    }
    const activeAdmins = readCount(value.activeAdmins, 500);
    if (activeAdmins === null || value.members.length > 200) {
      return { success: false };
    }
    const members: PartnerMemberList['members'] = [];
    for (const entry of value.members) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const membershipId = readText(entry.membershipId, 64);
      const userId = readText(entry.userId, 64);
      const displayName = readText(entry.displayName, 120);
      const role = pick(MEMBER_ROLES, entry.role);
      const status = pick(MEMBER_STATUSES, entry.status);
      const createdAt = readIsoDateTime(entry.createdAt);
      if (
        membershipId === null ||
        userId === null ||
        displayName === null ||
        role === null ||
        status === null ||
        createdAt === null
      ) {
        return { success: false };
      }
      members.push({
        membershipId,
        userId,
        displayName,
        role,
        status,
        isSelf: entry.isSelf === true,
        createdAt,
        revokedAt: entry.revokedAt === null ? null : readIsoDateTime(entry.revokedAt),
        lastSeenAt: entry.lastSeenAt === null ? null : readIsoDateTime(entry.lastSeenAt),
      });
    }
    const caveats: string[] = [];
    for (const entry of value.caveats) {
      const text = readText(entry, 300);
      if (text === null) {
        return { success: false };
      }
      caveats.push(text);
    }
    return { success: true, data: { members, activeAdmins, caveats } };
  },
};

function toInvite(value: unknown): PartnerInvite | null {
  if (!isRecord(value)) {
    return null;
  }
  const inviteId = readText(value.inviteId, 64);
  const emailMasked = readText(value.emailMasked, 254);
  const role = pick(MEMBER_ROLES, value.role);
  const createdAt = readIsoDateTime(value.createdAt);
  const expiresAt = readIsoDateTime(value.expiresAt);
  if (inviteId === null || emailMasked === null || role === null || createdAt === null || expiresAt === null) {
    return null;
  }
  return {
    inviteId,
    emailMasked,
    role,
    createdAt,
    expiresAt,
    consumedAt: value.consumedAt === null ? null : readIsoDateTime(value.consumedAt),
    revokedAt: value.revokedAt === null ? null : readIsoDateTime(value.revokedAt),
    pending: value.pending === true,
  };
}

export const inviteListSchema: PayloadSchema<PartnerInvite[]> = {
  safeParse(value: unknown) {
    if (!Array.isArray(value) || value.length > 100) {
      return { success: false };
    }
    const items: PartnerInvite[] = [];
    for (const entry of value) {
      const parsed = toInvite(entry);
      if (parsed === null) {
        return { success: false };
      }
      items.push(parsed);
    }
    return { success: true, data: items };
  },
};

export const inviteIssuedSchema: PayloadSchema<PartnerInviteIssued> = {
  safeParse(value: unknown) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const invite = toInvite(value.invite);
    const inviteToken = readText(value.inviteToken, 4096);
    const expiresAt = readIsoDateTime(value.expiresAt);
    if (invite === null || inviteToken === null || expiresAt === null) {
      return { success: false };
    }
    return { success: true, data: { invite, inviteToken, expiresAt } };
  },
};

export const memberSchema: PayloadSchema<PartnerMemberList['members'][number]> = {
  safeParse(value: unknown) {
    const parsed = memberListSchema.safeParse({ members: [value], activeAdmins: 1, caveats: [] });
    if (!parsed.success) {
      return { success: false };
    }
    const first = parsed.data.members[0];
    return first === undefined ? { success: false } : { success: true, data: first };
  },
};

export function membersQuery() {
  return {
    queryKey: ['partner', 'members'] as const,
    queryFn: () => fetchMembers(),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
  };
}

export function invitesQuery() {
  return {
    queryKey: ['partner', 'invites'] as const,
    queryFn: () => fetchInvites(),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
  };
}

export async function fetchMembers(): Promise<PartnerMemberList> {
  const envelope = await apiGetChecked(`${PARTNER_PATH}/members`, memberListSchema);
  return envelope.data;
}

export async function fetchInvites(): Promise<PartnerInvite[]> {
  const envelope = await apiGetChecked(`${PARTNER_PATH}/members/invites`, inviteListSchema);
  return envelope.data;
}

export async function createInvite(email: string, role: string): Promise<PartnerInviteIssued> {
  const envelope = await apiSendChecked(`${PARTNER_PATH}/members/invites`, inviteIssuedSchema, {
    method: 'POST',
    body: { email, role },
  });
  return envelope.data;
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await apiRequest(`${PARTNER_PATH}/members/invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
  });
}

export async function changeMemberRole(membershipId: string, role: string): Promise<unknown> {
  const envelope = await apiSendChecked(
    `${PARTNER_PATH}/members/${encodeURIComponent(membershipId)}`,
    apiValueSchema,
    { method: 'PATCH', body: { role } },
  );
  return envelope.data;
}

export async function revokeMember(membershipId: string): Promise<void> {
  await apiRequest(`${PARTNER_PATH}/members/${encodeURIComponent(membershipId)}`, {
    method: 'DELETE',
  });
}

const apiValueSchema: PayloadSchema<unknown> = {
  safeParse(value: unknown) {
    return value === undefined ? { success: false } : { success: true, data: value };
  },
};

export function partnerCaseQuery(publicId: string) {
  return {
    queryKey: ['partner', 'case', publicId] as const,
    queryFn: () => fetchPartnerCase(publicId),
    staleTime: 20_000,
    gcTime: 10 * 60_000,
    retry: false,
  };
}

export async function fetchPartnerCase(publicId: string): Promise<CaseFile> {
  const envelope = await apiGetChecked(
    `${PARTNER_PATH}/reports/${encodeURIComponent(publicId)}/accountability`,
    caseFileSchema,
  );
  return envelope.data;
}

export const responseSchema: PayloadSchema<ReportResponse> = {
  safeParse(value: unknown) {
    if (!isRecord(value)) {
      return { success: false };
    }
    const id = readText(value.id, 64);
    const kind = pick(RESPONSE_KINDS, value.kind);
    const body = readText(value.body, 4000);
    const evidenceUrls = readUrlList(value.evidenceUrls, 5);
    const institutionId = readText(value.institutionId, 64);
    const institutionName = readText(value.institutionName, 160);
    const publishedAt = readIsoDateTime(value.publishedAt);
    if (
      id === null ||
      kind === null ||
      body === null ||
      evidenceUrls === null ||
      institutionId === null ||
      institutionName === null ||
      publishedAt === null
    ) {
      return { success: false };
    }
    return {
      success: true,
      data: {
        id,
        kind,
        body,
        evidenceUrls,
        institutionId,
        institutionName,
        authorDisplayName: readNullableText(value.authorDisplayName, 120) ?? null,
        correctsResponseId: readNullableText(value.correctsResponseId, 64) ?? null,
        publishedAt,
        attestation: null,
      },
    };
  },
};

export async function submitResponse(
  publicId: string,
  input: { kind: string; body: string; evidenceUrls: string[] },
): Promise<ReportResponse> {
  const envelope = await apiSendChecked(
    `${PARTNER_PATH}/reports/${encodeURIComponent(publicId)}/responses`,
    responseSchema,
    { method: 'POST', body: input },
  );
  return envelope.data;
}

export interface PanelReportRow {
  publicId: string;
  status: string;
  category: string;
  claimantName: string;
  role: string;
}

export const panelReportListSchema: PayloadSchema<PanelReportRow[]> = {
  safeParse(value: unknown) {
    if (!Array.isArray(value) || value.length > 100) {
      return { success: false };
    }
    const items: PanelReportRow[] = [];
    for (const entry of value) {
      if (!isRecord(entry)) {
        return { success: false };
      }
      const publicId = readText(entry.publicId, 40);
      const status = readText(entry.status, 40);
      const category = readText(entry.category, 40);
      const claimantName = readText(entry.claimantName, 160);
      const role = readText(entry.role, 20);
      if (
        publicId === null ||
        status === null ||
        category === null ||
        claimantName === null ||
        role === null
      ) {
        return { success: false };
      }
      items.push({ publicId, status, category, claimantName, role });
    }
    return { success: true, data: items };
  },
};

export function panelInboxQuery() {
  return {
    queryKey: ['partner', 'panel'] as const,
    queryFn: () => fetchPanelInbox(),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
  };
}

export async function fetchPanelInbox(): Promise<PanelReportRow[]> {
  const envelope = await apiGetChecked(
    withQuery(`${PARTNER_PATH}/panel/reports`, { limit: 20 }),
    panelReportListSchema,
  );
  return envelope.data;
}

export async function fetchPartnerPanel(publicId: string): Promise<PanelView> {
  const envelope = await apiGetChecked(
    `${PARTNER_PATH}/panel/reports/${encodeURIComponent(publicId)}`,
    panelSchema,
  );
  return envelope.data;
}

export async function submitPanelVerdict(
  publicId: string,
  input: { method: string; verdict: string; note?: string; evidenceUrls: string[] },
): Promise<unknown> {
  const envelope = await apiSendChecked(
    `${PARTNER_PATH}/panel/reports/${encodeURIComponent(publicId)}/verdict`,
    apiValueSchema,
    { method: 'POST', body: input },
  );
  return envelope.data;
}
