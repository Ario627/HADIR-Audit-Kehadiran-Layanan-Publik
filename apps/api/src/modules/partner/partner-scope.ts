import { AppError } from '../../common/errors/app-error';
import type { PartnerSession } from '../../common/auth/partner-session';
import type { PartnerRoleName } from '../../common/auth/roles';
import { roleSatisfies } from '../../common/auth/roles';

export const PARTNER_ACTION_ROLE: PartnerRoleName = 'responder';

export class ReportNotInScopeError extends AppError {
  constructor() {
    super('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
  }
}

export function partnerCanAct(session: PartnerSession): boolean {
  return roleSatisfies(session.role, PARTNER_ACTION_ROLE);
}

export function assertPartnerCanAct(session: PartnerSession): void {
  if (!partnerCanAct(session)) {
    throw new AppError('FORBIDDEN', {
      detail: 'Role Anda hanya dapat membaca kotak masuk.',
    });
  }
}

export function notInScope(): AppError {
  return new ReportNotInScopeError();
}
