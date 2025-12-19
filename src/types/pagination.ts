/**
 * Pagination Types
 * Common pagination structures used across services
 *
 * Reference: docs/stage-2-service-layer.md Section 2.3
 */

/**
 * Parameters for paginated queries
 */
export interface PaginationParams {
  cursor?: string; // UUIDv7 of last item (cursor-based)
  limit: number; // Max items per page (default: 20, max: 100)
}

/**
 * Result wrapper for paginated data
 */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string; // Undefined if no more items
  hasMore: boolean;
}

/**
 * Default pagination values
 */
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/**
 * Normalize pagination params with defaults
 */
export function normalizePaginationParams(
  params: Partial<PaginationParams>
): PaginationParams {
  const limit = Math.min(
    Math.max(params.limit ?? DEFAULT_PAGE_LIMIT, 1),
    MAX_PAGE_LIMIT
  );
  const result: PaginationParams = { limit };
  if (params.cursor !== undefined) {
    result.cursor = params.cursor;
  }
  return result;
}
