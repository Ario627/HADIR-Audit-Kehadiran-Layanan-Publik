import type { TransactionContext } from '../../db/client';
import type { RequestContext } from './request-context';

export function transactionContextFor(context: RequestContext): TransactionContext {
  const base: TransactionContext = { requestId: context.requestId };
  const actor = context.actor;
  if (actor === null) {
    return base;
  }
  if (actor.kind === 'citizen') {
    return { ...base, deviceHash: actor.deviceHash };
  }
  if (actor.kind === 'moderator' || actor.kind === 'superadmin') {
    return { ...base, userId: actor.userId, scope: 'admin' };
  }
  return { ...base, userId: actor.userId, institutionId: actor.institutionId };
}
