export const AUDIT_ACTIONS = [
  'report.create',
  'report.corroborate',
  'report.closure_verify',
  'report.partner_action',
  'authz.denied',
  'maintenance.prune_idempotency',
  'maintenance.reap_episodes',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OBJECT_TYPES = ['report', 'episode', 'device', 'system'] as const;

export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];