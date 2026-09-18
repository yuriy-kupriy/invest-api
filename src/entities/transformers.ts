import { ValueTransformer } from 'typeorm';

/**
 * pg returns `bigint` columns as strings (they don't fit JS `number` safely in
 * general). Our amounts stay well under Number.MAX_SAFE_INTEGER, so we convert
 * back to number for ergonomics in the domain layer.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};
