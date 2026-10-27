export type PartnerRoleName = 'viewer' | 'responder' | 'admin';

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