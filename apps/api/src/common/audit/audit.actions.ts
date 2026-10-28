export const AUDIT_ACTIONS = [
  'report.create',
  'report.corroborate',
  'report.closure_verify',
  'report.partner_action',
  'partner.login',
  'partner.login_failed',
  'partner.logout',
  'partner.sessions_revoked',
  'partner.otp_requested',
  'partner.otp_failed',
  'partner.passkey_registered',
  'partner.password_changed',
  'upload.stored',
  'upload.rejected',
  'report.contact_withdrawn',
  'report.media_sanitized',
  'export.requested',
  'export.ready',
  'export.failed',
  'admin.login',
  'admin.login_failed',
  'admin.logout',
  'admin.notice_created',
  'admin.moderation',
  'admin.flag_set',
  'admin.chain_verify',
  'admin.anchor_sealed',
  'admin.rup_import',
  'authz.denied',
  'maintenance.prune_idempotency',
  'maintenance.reap_episodes',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OBJECT_TYPES = [
  'report',
  'episode',
  'device',
  'notice',
  'flag',
  'export',
  'rup',
  'anchor',
  'system',
] as const;

export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];