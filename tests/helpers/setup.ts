/**
 * Vitest Global Setup
 * This file runs before all tests
 */

import { config } from 'dotenv';
import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

// Load test environment variables (optional - won't fail if not present)
config({ path: '.env.test' });
config({ path: '.env' });

beforeAll(async () => {
  // Global setup before all tests
});

afterAll(async () => {
  // Global cleanup after all tests
});

beforeEach(async () => {
  // Reset state before each test if needed
});

afterEach(async () => {
  // Cleanup after each test if needed
});
