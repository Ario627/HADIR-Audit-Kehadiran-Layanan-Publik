import type { Actor } from '../http/request-context';

export type StoredActorType = 'citizen' | 'partner' | 'system' | 'moderator' | 'superadmin';

export interface AuditActor {
  actorType: StoredActorType;
  actorId: string | null;
}

export const SYSTEM_ACTOR: AuditActor = Object.freeze({ actorType: 'system', actorId: null });

export function toAuditActor(actor: Actor | null): AuditActor {
  if (actor === null) {
    return SYSTEM_ACTOR;
  }
  if (actor.kind === 'citizen') {
    return { actorType: 'citizen', actorId: actor.deviceHash };
  }
  if (actor.kind === 'moderator' || actor.kind === 'superadmin') {
    return { actorType: actor.kind, actorId: actor.userId };
  }
  return { actorType: 'partner', actorId: actor.userId };
}