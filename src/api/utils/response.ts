/**
 * API Response Helpers
 * Standardized response formatting
 */

import type { Context } from 'hono';

import { getErrorStatus } from '../types.js';

/**
 * Service error shape (matches Result pattern)
 */
interface ServiceError {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Create error response from service error
 */
export function errorResponse(
  c: Context,
  error: ServiceError,
  requestId: string
): Response {
  const status = getErrorStatus(error.code);

  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
      },
    },
    status as 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500
  );
}

/**
 * Create success response with data
 */
export function successResponse<T>(
  c: Context,
  data: T,
  requestId: string,
  status: 200 | 201 = 200
): Response {
  return c.json(
    {
      data,
      meta: { requestId },
    },
    status
  );
}

/**
 * Create paginated success response
 */
export function paginatedResponse<T>(
  c: Context,
  items: T[],
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
  },
  requestId: string
): Response {
  const totalPages = Math.ceil(pagination.totalItems / pagination.pageSize);

  return c.json({
    data: items,
    meta: {
      pagination: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: pagination.totalItems,
        totalPages,
        hasNext: pagination.page < totalPages,
        hasPrev: pagination.page > 1,
      },
      requestId,
    },
  });
}
