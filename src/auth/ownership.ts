import { HttpStatus } from '@nestjs/common';
import { problem } from '@/shared/problem.exception';
import { AuthUser } from './auth.types';

/**
 * Ownership is authorization that needs the resource's own data, so it runs
 * where the row is already loaded (services), never in a guard. Called after a
 * 404 check: a missing row is 404, someone else's row is 403.
 */
export function assertOwner(ownerId: string, user: AuthUser, what: string): void {
  if (ownerId !== user.id) {
    throw problem(HttpStatus.FORBIDDEN, 'forbidden', `${what} belongs to another user`);
  }
}
