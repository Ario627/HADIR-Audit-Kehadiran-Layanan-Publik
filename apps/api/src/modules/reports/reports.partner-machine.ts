import type { StoredEventKind, StoredReportStatus } from '../../db/repositories/reports.repository';

export type PartnerActionKind =
  | 'acknowledge'
  | 'request_info'
  | 'schedule'
  | 'respond'
  | 'claim_resolved'
  | 'reject_with_reason';

const PARTNER_TRANSITIONS: Readonly<Record<StoredReportStatus, readonly PartnerActionKind[]>> = {
  draft: ['acknowledge'],
  submitted: ['acknowledge', 'reject_with_reason'],
  triaged: ['acknowledge', 'reject_with_reason'],
  acknowledged: ['request_info', 'schedule', 'respond', 'claim_resolved', 'reject_with_reason'],
  in_progress: ['respond', 'claim_resolved', 'reject_with_reason'],
  claimed_resolved: [],
  verified_resolved: [],
  disputed: ['respond', 'claim_resolved'],
  rejected: [],
  closed: [],
};

const PARTNER_TARGET: Readonly<Record<PartnerActionKind, StoredReportStatus>> = {
  acknowledge: 'acknowledged',
  request_info: 'in_progress',
  schedule: 'in_progress',
  respond: 'in_progress',
  claim_resolved: 'claimed_resolved',
  reject_with_reason: 'rejected',
};

export function allowedPartnerActions(status: StoredReportStatus): readonly PartnerActionKind[] {
  return PARTNER_TRANSITIONS[status] ?? [];
}

export function partnerTransition(
  status: StoredReportStatus,
  action: PartnerActionKind,
): StoredReportStatus | null {
  return allowedPartnerActions(status).includes(action) ? PARTNER_TARGET[action] : null;
}

export function eventKindForAction(action: PartnerActionKind): StoredEventKind {
  switch (action) {
    case 'acknowledge':
      return 'acknowledged';
    case 'request_info':
      return 'info_requested';
    case 'schedule':
      return 'scheduled';
    case 'respond':
      return 'responded';
    case 'claim_resolved':
      return 'claimed_resolved';
    case 'reject_with_reason':
      return 'rejected';
  }
}
