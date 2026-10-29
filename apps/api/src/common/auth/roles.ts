export type PartnerRoleName = 'viewer' | 'responder' | 'admin';

export type PlatformAdminRoleName = 'moderator' | 'superadmin';

const PLATFORM_RANK: Readonly<Record<PlatformAdminRoleName, number>> = Object.freeze({
  moderator: 1,
  superadmin: 2,
});

export function platformRoleSatisfies(
  actual: PlatformAdminRoleName,
  required: PlatformAdminRoleName,
): boolean {
  return PLATFORM_RANK[actual] >= PLATFORM_RANK[required];
}

export function platformRolesSatisfy(
  actual: PlatformAdminRoleName,
  required: readonly PlatformAdminRoleName[],
): boolean {
  if (required.length === 0) {
    return true;
  }
  return required.some((role) => platformRoleSatisfies(actual, role));
}

export const PARTNER_ROLES: readonly PartnerRoleName[] = Object.freeze([
  'viewer',
  'responder',
  'admin',
]);

const RANK: Readonly<Record<PartnerRoleName, number>> = Object.freeze({
  viewer: 1,
  responder: 2,
  admin: 3,
});

export function roleSatisfies(actual: PartnerRoleName, required: PartnerRoleName): boolean {
  return RANK[actual] >= RANK[required];
}

export function rolesSatisfy(
  actual: PartnerRoleName,
  required: readonly PartnerRoleName[],
): boolean {
  if (required.length === 0) {
    return true;
  }
  return required.some((role) => roleSatisfies(actual, role));
}

export function strongestRole(roles: readonly PartnerRoleName[]): PartnerRoleName | null {
  let best: PartnerRoleName | null = null;
  for (const role of roles) {
    if (best === null || RANK[role] > RANK[best]) {
      best = role;
    }
  }
  return best;
}