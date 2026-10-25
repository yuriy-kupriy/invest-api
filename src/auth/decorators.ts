import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Request } from 'express';
import { AuthUser, Role } from './auth.types';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Skips JwtAuthGuard: no token needed. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Checked by RolesGuard against the token's `role` claim; a mismatch is 403, never 401. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<Request>().user as AuthUser,
);
