import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { env } from "../config/env";
import { AppError } from "../errors/app-error";
import { isSafeMethod } from "../http/http-methods";
import { deviceOf } from "../http/request-context";
import { assertTrustedMutation, readCsrfCookie, safeEqual, verifyCsrfToken } from "./csrf";

const SKIP_CSRF_KEY = "hadir:csrf:skip";

export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

@Injectable()
export class CsrfGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        if(isSafeMethod(request.method)) {return true}

        assertTrustedMutation(request, env.webOrigins);

        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
            context.getHandler(),
            context.getClass()
        ]);
        if (skip === true) {return true}

        const device = deviceOf(request);
        const cookieToken = readCsrfCookie(request);
        const headerToken = request.header("x-csrf-token");

        if(cookieToken === null || headerToken === undefined || headerToken.length === 0) {
            throw new AppError("CSRF_MISSING", {
                detail: "Token CRSF tidak ditemukan",
            });
        }

        if(!safeEqual(cookieToken, headerToken)) {
            throw new AppError("CSRF_INVALID", {
                detail: "Token CSRF tidak cocok",
            });
        }

        if(
            !verifyCsrfToken(cookieToken, {
                deviceHash: device.hash,
                secret: env.SESSION_SECRET,
                now: new Date(),
            })
        ) {
            throw new AppError("CSRF_INVALID", {
                detail: "Token CSRF tidak valid atau sudah kadaluarsa",
            });
        }

        return true;

    }
}