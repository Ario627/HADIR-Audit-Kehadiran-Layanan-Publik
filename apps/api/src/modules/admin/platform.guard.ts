import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { contextOf } from '../../common/http/request-context';
import { platformRoleAllowed, PlatformAuthService } from './platform-auth.service';
import type { PlatformAdminSession } from '../../common/auth/platform-session';
import type { PlatformAdminRoleName } from '../../common/auth/roles';
import { PLATFORM_ROLES_KEY } from '../../common/auth/platform-roles.decorator';

function readCookie(request: Request, name: string): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[name];
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: PlatformAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<PlatformAdminRoleName[]>(
      PLATFORM_ROLES_KEY,
      targets,
    );
    if (required === undefined || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const resolved = await this.auth.resolve(readCookie(request, this.auth.cookieName()));
    if (resolved === null) {
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Sesi admin tidak valid atau sudah berakhir.',
      });
    }
    if (!platformRoleAllowed(resolved.session.role, required)) {
      throw new AppError('FORBIDDEN', {
        detail: 'Role admin Anda tidak diizinkan untuk aksi ini.',
      });
    }

    const ctx = contextOf(request);
    ctx.actor = { kind: resolved.session.role, userId: resolved.session.adminId };
    (request as Request & { platformSession?: unknown }).platformSession =
      resolved.session;
    return true;
  }
}

export function platformSessionOf(request: Request): PlatformAdminSession {
  const session = (request as Request & { platformSession?: unknown }).platformSession;
  if (session === undefined) {
    throw new Error('Sesi admin belum tersedia. Periksa urutan guard.');
  }
  return session as PlatformAdminSession;
}
