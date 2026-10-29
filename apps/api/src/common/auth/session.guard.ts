import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { contextOf } from '../http/request-context';
import { PartnerAuthService } from '../../modules/partner/partner-auth.service';
import type { PartnerSession } from './partner-session';
import type { PartnerRoleName } from './roles';
import { rolesSatisfy } from './roles';
import { FRESH_SESSION_KEY, PARTNER_ROLES_KEY } from './roles.decorator';

function readCookie(request: Request, name: string): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: PartnerAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PartnerRoleName[]>(
      PARTNER_ROLES_KEY,
      targets,
    );
    const fresh =
      this.reflector.getAllAndOverride<boolean>(FRESH_SESSION_KEY, targets) === true;

    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const raw = readCookie(request, this.auth.cookieName());
    const resolved = await this.auth.resolve(raw);
    if (resolved === null) {
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Sesi mitra tidak valid atau sudah berakhir.',
      });
    }
    if (!rolesSatisfy(resolved.session.role, required)) {
      throw new AppError('FORBIDDEN', {
        detail: 'Role Anda tidak diizinkan untuk aksi ini.',
      });
    }
    if (fresh && !resolved.fresh) {
      throw new AppError('FORBIDDEN', {
        detail: 'Aksi ini memerlukan sesi baru. Silakan masuk ulang.',
      });
    }

    const ctx = contextOf(request);
    ctx.actor = {
      kind: 'partner',
      userId: resolved.session.userId,
      institutionId: resolved.session.institutionId,
      role: resolved.session.role,
    };
    (request as Request & { partnerSession?: unknown }).partnerSession = resolved.session;
    return true;
  }
}

export function partnerSessionOf(request: Request): PartnerSession {
  const session = (request as Request & { partnerSession?: unknown }).partnerSession;
  if (session === undefined) {
    throw new Error('Sesi mitra belum tersedia. Periksa urutan guard.');
  }
  return session as PartnerSession;
}