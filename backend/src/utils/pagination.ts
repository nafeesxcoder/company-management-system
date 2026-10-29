import { z } from 'zod';

/** Shared list-query shape: page, pageSize, sort, free-text search. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.string().max(40).optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(160).optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function toSkipTake(query: { page: number; pageSize: number }): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

/**
 * Builds a Prisma orderBy from user input, but only from an explicit allowlist —
 * an arbitrary column name from the client must never reach the query.
 */
export function buildOrderBy<T extends string>(
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc',
  allowed: readonly T[],
  fallback: T,
): Record<string, 'asc' | 'desc'> {
  const field = sortBy && (allowed as readonly string[]).includes(sortBy) ? sortBy : fallback;
  return { [field]: sortOrder };
}
