/**
 * AuthService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with Stage 1 schema applied
 *
 * Tests are skipped if credentials are not available.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { createAuthService, createAuthServiceDb } from '@/services/index.js';
import type { AuthService } from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for user IDs (TEXT field) but real UUIDs for roles
const TEST_PREFIX = `test_${nanoid(6)}`;

// Helper to create unique test user IDs (TEXT field, can be any string)
function testUserId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create test actor
function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: testUserId('admin'),
    requestId: `req_${nanoid(6)}`,
    permissions: ['role:assign', 'user:read'],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('AuthService Integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: SupabaseClient<any, 'public', any>;
  let authService: AuthService;

  // Use existing seeded role from database
  let testRoleId: string;
  let testRoleName: string;
  let testPermissionCode: string;

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_KEY!
    ) as SupabaseClient<any, 'public', any>;

    // Create database adapter and service
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const db = createAuthServiceDb(supabase);
    authService = createAuthService({ db });

    // Get an existing role from the seeded data (use 'user' role)
    const { data: roleData, error: roleError } = await supabase
      .from('roles')
      .select('id, name')
      .eq('name', 'user')
      .single();

    if (roleError !== null || roleData === null) {
      throw new Error(`Failed to get test role: ${roleError?.message}`);
    }

    testRoleId = roleData.id as string;
    testRoleName = roleData.name as string;

    // Get a permission code from this role
    const { data: permData, error: permError } = await supabase
      .from('role_permissions')
      .select('permissions(code)')
      .eq('role_id', testRoleId)
      .limit(1)
      .single();

    if (permError !== null || permData === null) {
      throw new Error(`Failed to get test permission: ${permError?.message}`);
    }

    testPermissionCode = (permData.permissions as unknown as { code: string })
      .code;
  });

  afterAll(async () => {
    // Cleanup test user_roles data
    await supabase
      .from('user_roles')
      .delete()
      .like('user_id', `${TEST_PREFIX}%`);
  });

  beforeEach(async () => {
    // Clean up user_roles before each test
    await supabase
      .from('user_roles')
      .delete()
      .like('user_id', `${TEST_PREFIX}%`);
  });

  describe('resolvePermissions', () => {
    it('should return permissions from assigned roles', async () => {
      const actor = createTestActor();
      const targetUserId = testUserId('target');

      // Assign the test role to the user
      await authService.assignRole(actor, {
        targetUserId,
        roleId: testRoleId,
      });

      // Resolve permissions
      const result = await authService.resolvePermissions(targetUserId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toContain(testPermissionCode);
      }
    });

    it('should return empty array for user with no roles', async () => {
      const userIdWithNoRoles = testUserId('noroles');

      const result = await authService.resolvePermissions(userIdWithNoRoles);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('should exclude permissions from expired roles', async () => {
      const actor = createTestActor();
      const targetUserId = testUserId('expired');

      // Assign role with expiration in the past
      const expiredDate = new Date(Date.now() - 86400000); // Yesterday

      // Insert directly to bypass validation
      await supabase.from('user_roles').insert({
        user_id: targetUserId,
        role_id: testRoleId,
        granted_by: actor.userId,
        expires_at: expiredDate.toISOString(),
      });

      // Resolve permissions
      const result = await authService.resolvePermissions(targetUserId);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should not include test permission since role is expired
        expect(result.data).not.toContain(testPermissionCode);
      }
    });
  });

  describe('assignRole', () => {
    it('should assign role to user', async () => {
      const actor = createTestActor();
      const targetUserId = testUserId('assign');

      const result = await authService.assignRole(actor, {
        targetUserId,
        roleId: testRoleId,
      });

      expect(result.success).toBe(true);

      // Verify role was assigned
      const queryResult = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', targetUserId)
        .eq('role_id', testRoleId)
        .single();

      expect(queryResult.data).not.toBeNull();
      const userRole = queryResult.data as { granted_by: string };
      expect(userRole.granted_by).toBe(actor.userId);
    });

    it('should assign role with expiration', async () => {
      const actor = createTestActor();
      const targetUserId = testUserId('expiry');
      const expiresAt = new Date(Date.now() + 86400000); // Tomorrow

      const result = await authService.assignRole(actor, {
        targetUserId,
        roleId: testRoleId,
        expiresAt,
      });

      expect(result.success).toBe(true);

      // Verify expiration was set
      const queryResult = await supabase
        .from('user_roles')
        .select('expires_at')
        .eq('user_id', targetUserId)
        .eq('role_id', testRoleId)
        .single();

      expect(queryResult.data).not.toBeNull();
      const userRole = queryResult.data as { expires_at: string };
      expect(new Date(userRole.expires_at).getTime()).toBeCloseTo(
        expiresAt.getTime(),
        -3 // Within 1 second
      );
    });

    it('should return NOT_FOUND for non-existent role', async () => {
      const actor = createTestActor();
      // Use a valid UUID format that doesn't exist
      const nonExistentRoleId = '00000000-0000-0000-0000-000000000000';

      const result = await authService.assignRole(actor, {
        targetUserId: testUserId('user'),
        roleId: nonExistentRoleId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('revokeRole', () => {
    it('should revoke role from user', async () => {
      const actor = createTestActor();
      const targetUserId = testUserId('revoke');

      // First assign the role
      await authService.assignRole(actor, {
        targetUserId,
        roleId: testRoleId,
      });

      // Then revoke it
      const result = await authService.revokeRole(actor, {
        targetUserId,
        roleId: testRoleId,
      });

      expect(result.success).toBe(true);

      // Verify role was revoked
      const { data } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', targetUserId)
        .eq('role_id', testRoleId);

      expect(data).toEqual([]);
    });

    it('should return NOT_FOUND when assignment does not exist', async () => {
      const actor = createTestActor();

      const result = await authService.revokeRole(actor, {
        targetUserId: testUserId('noassign'),
        roleId: testRoleId,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('getUserRoles', () => {
    it('should return roles assigned to user', async () => {
      const actor = createTestActor();
      const targetUserId = testUserId('getroles');

      // Assign role
      await authService.assignRole(actor, {
        targetUserId,
        roleId: testRoleId,
      });

      // Get roles
      const result = await authService.getUserRoles(actor, targetUserId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        expect(result.data.some((r) => r.id === testRoleId)).toBe(true);
      }
    });
  });

  describe('listRoles', () => {
    it('should return all roles including seeded roles', async () => {
      const actor = createTestActor();

      const result = await authService.listRoles(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should include the seeded 'user' role
        expect(result.data.some((r) => r.name === testRoleName)).toBe(true);
        // Should have multiple roles from seed data
        expect(result.data.length).toBeGreaterThanOrEqual(6);
      }
    });
  });
});
