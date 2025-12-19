/**
 * Test Mocks
 * Mock implementations for external services
 */

import { vi } from 'vitest';

/**
 * Mock Supabase client
 */
export const mockSupabaseClient = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
  maybeSingle: vi.fn(),
};

/**
 * Mock Redis client
 */
export const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  setnx: vi.fn(),
  expire: vi.fn(),
};

/**
 * Reset all mocks between tests
 */
export function resetMocks(): void {
  vi.clearAllMocks();
}
