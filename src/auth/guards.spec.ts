import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, Role } from './auth.types';
import { RolesGuard } from './guards';

function contextFor(user: Partial<AuthUser>, roles?: Role[]): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = { getAllAndOverride: jest.fn(() => roles) } as unknown as Reflector;
  const ctx = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

describe('RolesGuard', () => {
  it('lets any authenticated user through a route without @Roles', () => {
    const { ctx, reflector } = contextFor({ role: 'viewer' });
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('lets a member write', () => {
    const { ctx, reflector } = contextFor({ role: 'member' }, ['member']);
    expect(new RolesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  // 403, never 401: the token is fine, the permission is not — a client must
  // show an error here, not go refresh its token.
  it('refuses a viewer with 403', () => {
    const { ctx, reflector } = contextFor({ role: 'viewer' }, ['member']);
    expect(() => new RolesGuard(reflector).canActivate(ctx)).toThrow(
      expect.objectContaining({ status: HttpStatus.FORBIDDEN, code: 'forbidden-role' }),
    );
  });
});
