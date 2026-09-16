import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@/shared/problem.exception';

export const DEFAULT_PAGE_LIMIT = 20;
export const MIN_PAGE_LIMIT = 1;
export const MAX_PAGE_LIMIT = 100;

export interface CursorPayload {
  c: string;
  id: string;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export function encodeCursor(sortKey: string, id: string): string {
  return Buffer.from(JSON.stringify({ c: sortKey, id })).toString('base64url');
}

export function decodeCursor(raw: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as CursorPayload).c !== 'string' ||
      typeof (parsed as CursorPayload).id !== 'string'
    ) {
      throw new Error();
    }
    return parsed as CursorPayload;
  } catch {
    throw new ProblemException(
      HttpStatus.BAD_REQUEST,
      'bad-cursor',
      'cursor not recognised — it is opaque and belongs to the server',
    );
  }
}

// Paging itself lives in SQL — see AccountsRepository.findPage() and
// TransactionsRepository.findPage(), where the cursor becomes a row-value
// comparison `(sort_key, id) < (:c, :id)` that the HW #12 indexes can serve.
// Only the cursor's encoding is shared, so that its opacity stays the
// server's business.
