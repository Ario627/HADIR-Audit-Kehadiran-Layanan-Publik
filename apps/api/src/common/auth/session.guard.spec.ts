import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import type { PartnerSession } from './partner-session';
import { SessionGuard } from './session.guard';
import type { PartnerRoleName } from './roles';
import type { PartnerAuthService } from '../../modules/partner/partner-auth.service';

const SESSION: PartnerSession = {
  sessionId: '0192f0c4-0000-7000-8000-0000000000f1',
  userId: '0192f0c4-0000-7000-8000-0000000000f2',
  displayName: 'Budi',
  institutionId: '0192f0c4-0000-7000-8000-0000000000f3',
  institutionName: 'Dishub',
  role: 'responder',
  createdAt: new Date('2026-10-27T11:00:00.000Z'),
  lastSeenAt: new Date('2026-10-27T11:59:00.000Z'),
  expiresAt: new Date('2026-11-03T11:00:00.000Z'),
  revokedAt: null,
};

interface Harness {
  required: PartnerRoleName[] | undefined;
  fresh: boolean | undefined;
  cookie: string | null;
  resolved: { session: PartnerSession; fresh: boolean } | null;
}

function build(harness: Harness) {
  const http = {
    context: { requestId: 'req-1', device: null, actor: null } as {
      requestId: string;
      device: null;
      actor: unknown;
    },
  };
  const cookie = harness.cookie;
  const request = {
    cookies: cookie === null ? {} : { hadir_session: cookie },
    context: http.context,
  } as unknown as Request;
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === 'hadir:partner:roles') {
        return harness.required;
      }
      if (key === 'hadir:partner:fresh') {
        return harness.fresh;
      }
      return undefined;
    },
  } as unknown as Reflector;

  const auth = {
    cookieName: () => 'hadir_session',
    resolve: async () => harness.resolved,
  } as unknown as PartnerAuthService;

  return { guard: new SessionGuard(reflector, auth), ctx, request };
}

const RAW_TOKEN = 'a'.repeat(43);

describe('SessionGuard', () => {
  it('lets a route without @PartnerOnly through untouched', async () => {
    const { guard, ctx, request } = build({
      required: undefined,
      fresh: undefined,
      cookie: null,
      resolved: null,
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((request as unknown as { context: { actor: unknown } }).context.actor).toBeNull();
  });

  it('rejects a request with no cookie', async () => {
    const { guard, ctx } = build({
      required: ['viewer'],
      fresh: undefined,
      cookie: null,
      resolved: null,
    });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rejects a cookie that resolves to nothing', async () => {
    const { guard, ctx } = build({
      required: ['viewer'],
      fresh: undefined,
      cookie: RAW_TOKEN,
      resolved: null,
    });

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a viewer trying a responder action', async () => {
    const { guard, ctx } = build({
      required: ['responder'],
      fresh: undefined,
      cookie: RAW_TOKEN,
      resolved: { session: { ...SESSION, role: 'viewer' }, fresh: true },
    });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('accepts an admin on a responder action', async () => {
    const { guard, ctx, request } = build({
      required: ['responder'],
      fresh: undefined,
      cookie: RAW_TOKEN,
      resolved: { session: { ...SESSION, role: 'admin' }, fresh: true },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((request as unknown as { context: { actor: unknown } }).context.actor).toEqual({
      kind: 'partner',
      userId: SESSION.userId,
      institutionId: SESSION.institutionId,
      role: 'admin',
    });
  });

  it('rejects a stale session on a fresh-only route', async () => {
    const { guard, ctx } = build({
      required: ['admin'],
      fresh: true,
      cookie: RAW_TOKEN,
      resolved: { session: { ...SESSION, role: 'admin' }, fresh: false },
    });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('accepts a fresh session on a fresh-only route', async () => {
    const { guard, ctx } = build({
      required: ['admin'],
      fresh: true,
      cookie: RAW_TOKEN,
      resolved: { session: { ...SESSION, role: 'admin' }, fresh: true },
    });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
