/**
 * Test Utilities
 * Common helpers for writing tests
 */

import { nanoid } from 'nanoid';

import type { ServiceContext } from '@/types/context.js';

/**
 * Create a mock service context for testing
 */
export function createTestContext(
  overrides?: Partial<ServiceContext>
): ServiceContext {
  return {
    userId: `user_${nanoid(8)}`,
    organizationId: `org_${nanoid(8)}`,
    role: 'member',
    requestId: `req_${nanoid(8)}`,
    source: 'api',
    ...overrides,
  };
}

/**
 * Create an admin context for testing
 */
export function createAdminContext(
  overrides?: Partial<ServiceContext>
): ServiceContext {
  return createTestContext({
    role: 'admin',
    ...overrides,
  });
}

/**
 * Create an owner context for testing
 */
export function createOwnerContext(
  overrides?: Partial<ServiceContext>
): ServiceContext {
  return createTestContext({
    role: 'owner',
    ...overrides,
  });
}

/**
 * Wait for a specified number of milliseconds
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique test ID
 */
export function testId(prefix: string = 'test'): string {
  return `${prefix}_${nanoid(8)}`;
}
