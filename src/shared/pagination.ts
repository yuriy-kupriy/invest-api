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
      'cursor не розпізнано — він непрозорий і належить серверу',
    );
  }
}

export function paginate<T extends { id: string }>(
  rows: T[],
  sortKeyOf: (row: T) => string,
  limit: number,
  cursor?: string,
): Page<T> {
  const sorted = [...rows].sort((a, b) => {
    const ka = sortKeyOf(a);
    const kb = sortKeyOf(b);
    if (ka !== kb) {
      return ka < kb ? 1 : -1;
    }
    return a.id < b.id ? 1 : -1;
  });

  let page = sorted;
  if (cursor) {
    const { c, id } = decodeCursor(cursor);
    page = sorted.filter((row) => {
      const k = sortKeyOf(row);
      return k < c || (k === c && row.id < id);
    });
  }

  const items = page.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: items.length === limit && last ? encodeCursor(sortKeyOf(last), last.id) : null,
  };
}
