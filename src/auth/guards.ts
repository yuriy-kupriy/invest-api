import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { problem } from '@/shared/problem.exception';
import { AuthUser, Role } from './auth.types';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/** Runs LocalStrategy on POST /auth/login: wrong email or password is 401. */
@Injectable()
export class LocalAuthGuard extends AuthGuard('local') {}

/**
 * Authentication — "who is this?". Global (APP_GUARD #1): every route needs a
 * valid, non-revoked access token unless marked @Public(). Missing, expired,
 * tampered or denylisted token → 401, which a client SDK answers by refreshing.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic || super.canActivate(context);
  }

  /** passport-jwt's own failures (no token, bad signature, expired) as problem+json with a code. */
  handleRequest<TUser>(err: unknown, user: TUser, info?: { message?: string }): TUser {
    if (err) {
      throw err;
    }
    if (!user) {
      throw problem(HttpStatus.UNAUTHORIZED, 'invalid-token', info?.message ?? 'access token required');
    }
    return user;
  }
}

/**
 * Authorization by role — "may they do this?". Global (APP_GUARD #2), runs after
 * JwtAuthGuard, so `req.user` is already verified here. Wrong role → 403, which a
 * client shows as an error instead of refreshing in a loop.
 *
 * Ownership is deliberately NOT checked here: a guard runs before the resource
 * is loaded and has no owner_id to compare with. See AccountsService.getById.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles) {
      return true;
    }
    const user = context.switchToHttp().getRequest<Request>().user as AuthUser | undefined;
    if (!user || !roles.includes(user.role)) {
      throw problem(HttpStatus.FORBIDDEN, 'forbidden-role', `requires role ${roles.join(' or ')}`);
    }
    return true;
  }
}
