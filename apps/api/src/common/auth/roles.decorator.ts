import { SetMetadata } from '@nestjs/common';
import type { PartnerRoleName } from './roles';

export const PARTNER_ROLES_KEY = 'hadir:partner:roles';
export const FRESH_SESSION_KEY = 'hadir:partner:fresh';

export const PartnerOnly = (...roles: PartnerRoleName[]) =>
  SetMetadata(PARTNER_ROLES_KEY, roles);

export const RequireFresh = () => SetMetadata(FRESH_SESSION_KEY, true);