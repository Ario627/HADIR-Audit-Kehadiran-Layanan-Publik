import type { PartnerRoleName } from './roles';

export interface PartnerSession {
  sessionId: string;
  userId: string;
  displayName: string;
  institutionId: string;
  institutionName: string;
  role: PartnerRoleName;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}