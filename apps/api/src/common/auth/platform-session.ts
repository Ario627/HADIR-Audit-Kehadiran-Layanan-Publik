import type { PlatformAdminRoleName } from './roles';

export interface PlatformAdminSession {
  sessionId: string;
  adminId: string;
  email: string;
  displayName: string;
  role: PlatformAdminRoleName;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}
