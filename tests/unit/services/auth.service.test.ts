/**
 * AuthService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.1
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AuthService } from '@/services/auth.service.js';
import { createAuthService } from '@/services/auth.service.js';
import type {
  ActorContext,
  Role,
  Permission,
  AssignRoleParams,
  RevokeRoleParams,
} from '@/types/index.js';
import { SYSTEM_ACTOR, AI_ACTOR } from '@/types/index.js';

// Test fixtures
const TEST_USER_ID = 'user_test123';
const TEST_ADMIN_ID = 'admin_test123';
const TEST_ROLE_ID = 'role_test123';
const TEST_REQUEST_ID = 'req_test123';

const createTestActor = (overrides?: Partial<ActorContext>): ActorContext => ({
  type: 'user',
  userId: TEST_USER_ID,
  requestId: TEST_REQUEST_ID,
  permissions: [],
  ...overrides,
});

const createAdminActor = (overrides?: Partial<ActorContext>): ActorContext => ({
  type: 'admin',
  userId: TEST_ADMIN_ID,
  requestId: TEST_REQUEST_ID,
  permissions: ['role:assign', 'user:read'],
  ...overrides,
});

// Mock database responses
const mockPermissions: Permission[] = [
  {
    id: 'perm_1',
    code: 'chat:read',
    description: 'Read chat messages',
    category: 'chat',
    createdAt: new Date(),
  },
  {
    id: 'perm_2',
    code: 'chat:write',
    description: 'Write chat messages',
    category: 'chat',
    createdAt: new Date(),
  },
  {
    id: 'perm_3',
    code: 'memory:read',
    description: 'Read memories',
    category: 'memory',
    createdAt: new Date(),
  },
];

const mockRole: Role = {
  id: TEST_ROLE_ID,
  name: 'user',
  description: 'Standard user role',
  isSystem: true,
  permissions: mockPermissions,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let authService: AuthService;
  let mockDb: {
    getUserRoles: ReturnType<typeof vi.fn>;
    getRolePermissions: ReturnType<typeof vi.fn>;
    getRole: ReturnType<typeof vi.fn>;
    getRoles: ReturnType<typeof vi.fn>;
    assignRole: ReturnType<typeof vi.fn>;
    revokeRole: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset mocks before each test
    mockDb = {
      getUserRoles: vi.fn(),
      getRolePermissions: vi.fn(),
      getRole: vi.fn(),
      getRoles: vi.fn(),
      assignRole: vi.fn(),
      revokeRole: vi.fn(),
    };

    authService = createAuthService({ db: mockDb });
  });

  // ─────────────────────────────────────────────────────────────
  // PERMISSION CHECKS
  // ─────────────────────────────────────────────────────────────

  describe('hasPermission', () => {
    it('should return true when actor has the permission', async () => {
      const actor = createTestActor({
        permissions: ['chat:read', 'chat:write'],
      });

      const result = await authService.hasPermission(actor, 'chat:read');

      expect(result).toBe(true);
    });

    it('should return false when actor lacks the permission', async () => {
      const actor = createTestActor({
        permissions: ['chat:read'],
      });

      const result = await authService.hasPermission(actor, 'chat:write');

      expect(result).toBe(false);
    });

    it('should return true for system actor with wildcard permission', async () => {
      const result = await authService.hasPermission(
        SYSTEM_ACTOR,
        'any:permission'
      );

      expect(result).toBe(true);
    });

    it('should return false for AI actor (AI has no permissions)', async () => {
      const result = await authService.hasPermission(AI_ACTOR, 'chat:read');

      expect(result).toBe(false);
    });

    it('should handle empty permission string gracefully', async () => {
      const actor = createTestActor({ permissions: ['chat:read'] });

      const result = await authService.hasPermission(actor, '');

      expect(result).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true when actor has all permissions', async () => {
      const actor = createTestActor({
        permissions: ['chat:read', 'chat:write', 'memory:read'],
      });

      const result = await authService.hasAllPermissions(actor, [
        'chat:read',
        'chat:write',
      ]);

      expect(result).toBe(true);
    });

    it('should return false when actor is missing any permission', async () => {
      const actor = createTestActor({
        permissions: ['chat:read'],
      });

      const result = await authService.hasAllPermissions(actor, [
        'chat:read',
        'chat:write',
      ]);

      expect(result).toBe(false);
    });

    it('should return true for empty permissions array', async () => {
      const actor = createTestActor({ permissions: [] });

      const result = await authService.hasAllPermissions(actor, []);

      expect(result).toBe(true);
    });

    it('should return true for system actor regardless of permissions', async () => {
      const result = await authService.hasAllPermissions(SYSTEM_ACTOR, [
        'any:permission',
        'another:permission',
      ]);

      expect(result).toBe(true);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true when actor has at least one permission', async () => {
      const actor = createTestActor({
        permissions: ['chat:read'],
      });

      const result = await authService.hasAnyPermission(actor, [
        'chat:read',
        'chat:write',
      ]);

      expect(result).toBe(true);
    });

    it('should return false when actor has none of the permissions', async () => {
      const actor = createTestActor({
        permissions: ['memory:read'],
      });

      const result = await authService.hasAnyPermission(actor, [
        'chat:read',
        'chat:write',
      ]);

      expect(result).toBe(false);
    });

    it('should return false for empty permissions array', async () => {
      const actor = createTestActor({ permissions: ['chat:read'] });

      const result = await authService.hasAnyPermission(actor, []);

      expect(result).toBe(false);
    });

    it('should return true for system actor', async () => {
      const result = await authService.hasAnyPermission(SYSTEM_ACTOR, [
        'any:permission',
      ]);

      expect(result).toBe(true);
    });
  });

  describe('resolvePermissions', () => {
    it('should return all permissions for a user from their roles', async () => {
      mockDb.getUserRoles.mockResolvedValue([
        { roleId: TEST_ROLE_ID, expiresAt: null },
      ]);
      mockDb.getRolePermissions.mockResolvedValue(mockPermissions);

      const result = await authService.resolvePermissions(TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toContain('chat:read');
        expect(result.data).toContain('chat:write');
        expect(result.data).toContain('memory:read');
      }
    });

    it('should return empty array for user with no roles', async () => {
      mockDb.getUserRoles.mockResolvedValue([]);

      const result = await authService.resolvePermissions(TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('should exclude expired role permissions', async () => {
      const expiredDate = new Date(Date.now() - 86400000); // Yesterday
      mockDb.getUserRoles.mockResolvedValue([
        { roleId: TEST_ROLE_ID, expiresAt: expiredDate },
      ]);

      const result = await authService.resolvePermissions(TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('should deduplicate permissions from multiple roles', async () => {
      mockDb.getUserRoles.mockResolvedValue([
        { roleId: 'role_1', expiresAt: null },
        { roleId: 'role_2', expiresAt: null },
      ]);
      // Both roles have 'chat:read'
      mockDb.getRolePermissions
        .mockResolvedValueOnce([mockPermissions[0]]) // chat:read
        .mockResolvedValueOnce([mockPermissions[0], mockPermissions[1]]); // chat:read, chat:write

      const result = await authService.resolvePermissions(TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should have unique permissions only
        const unique = [...new Set(result.data)];
        expect(result.data.length).toBe(unique.length);
      }
    });

    it('should return error for invalid user ID', async () => {
      mockDb.getUserRoles.mockRejectedValue(new Error('User not found'));

      const result = await authService.resolvePermissions('invalid_user');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ROLE MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  describe('assignRole', () => {
    const assignParams: AssignRoleParams = {
      targetUserId: TEST_USER_ID,
      roleId: TEST_ROLE_ID,
    };

    it('should assign role when actor has role:assign permission', async () => {
      const actor = createAdminActor();
      mockDb.getRole.mockResolvedValue(mockRole);
      mockDb.assignRole.mockResolvedValue({ id: 'user_role_1' });

      const result = await authService.assignRole(actor, assignParams);

      expect(result.success).toBe(true);
      expect(mockDb.assignRole).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: TEST_USER_ID,
          roleId: TEST_ROLE_ID,
          grantedBy: TEST_ADMIN_ID,
        })
      );
    });

    it('should return PERMISSION_DENIED when actor lacks role:assign', async () => {
      const actor = createTestActor({ permissions: ['chat:read'] });

      const result = await authService.assignRole(actor, assignParams);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND when role does not exist', async () => {
      const actor = createAdminActor();
      mockDb.getRole.mockResolvedValue(null);

      const result = await authService.assignRole(actor, {
        ...assignParams,
        roleId: 'nonexistent_role',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should support role expiration', async () => {
      const actor = createAdminActor();
      const expiresAt = new Date(Date.now() + 86400000); // Tomorrow
      mockDb.getRole.mockResolvedValue(mockRole);
      mockDb.assignRole.mockResolvedValue({ id: 'user_role_1' });

      const result = await authService.assignRole(actor, {
        ...assignParams,
        expiresAt,
      });

      expect(result.success).toBe(true);
      expect(mockDb.assignRole).toHaveBeenCalledWith(
        expect.objectContaining({
          expiresAt,
        })
      );
    });

    it('should allow system actor to assign any role', async () => {
      mockDb.getRole.mockResolvedValue(mockRole);
      mockDb.assignRole.mockResolvedValue({ id: 'user_role_1' });

      const result = await authService.assignRole(SYSTEM_ACTOR, assignParams);

      expect(result.success).toBe(true);
    });
  });

  describe('revokeRole', () => {
    const revokeParams: RevokeRoleParams = {
      targetUserId: TEST_USER_ID,
      roleId: TEST_ROLE_ID,
    };

    it('should revoke role when actor has role:assign permission', async () => {
      const actor = createAdminActor();
      mockDb.revokeRole.mockResolvedValue(true);

      const result = await authService.revokeRole(actor, revokeParams);

      expect(result.success).toBe(true);
      expect(mockDb.revokeRole).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_ROLE_ID
      );
    });

    it('should return PERMISSION_DENIED when actor lacks role:assign', async () => {
      const actor = createTestActor({ permissions: ['chat:read'] });

      const result = await authService.revokeRole(actor, revokeParams);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND when user-role assignment does not exist', async () => {
      const actor = createAdminActor();
      mockDb.revokeRole.mockResolvedValue(false);

      const result = await authService.revokeRole(actor, revokeParams);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('getUserRoles', () => {
    it('should return roles for the user', async () => {
      const actor = createTestActor();
      mockDb.getUserRoles.mockResolvedValue([
        { roleId: TEST_ROLE_ID, expiresAt: null },
      ]);
      mockDb.getRole.mockResolvedValue(mockRole);

      const result = await authService.getUserRoles(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].name).toBe('user');
      }
    });

    it('should allow user to view their own roles', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getUserRoles.mockResolvedValue([]);

      const result = await authService.getUserRoles(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
    });

    it('should require user:read permission to view other users roles', async () => {
      const actor = createTestActor({
        userId: 'other_user',
        permissions: [],
      });

      const result = await authService.getUserRoles(actor, TEST_USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to view any user roles', async () => {
      const actor = createAdminActor();
      mockDb.getUserRoles.mockResolvedValue([]);

      const result = await authService.getUserRoles(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
    });
  });

  describe('listRoles', () => {
    it('should return all available roles', async () => {
      const actor = createTestActor();
      mockDb.getRoles.mockResolvedValue([mockRole]);

      const result = await authService.listRoles(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0].name).toBe('user');
      }
    });

    it('should return empty array when no roles exist', async () => {
      const actor = createTestActor();
      mockDb.getRoles.mockResolvedValue([]);

      const result = await authService.listRoles(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AI ACTOR INVARIANTS (CRITICAL)
  // ─────────────────────────────────────────────────────────────

  describe('AI Actor Invariants', () => {
    it('AI_ACTOR.permissions MUST always be empty', () => {
      expect(AI_ACTOR.permissions).toEqual([]);
    });

    it('AI_ACTOR should never be able to assign roles', async () => {
      const result = await authService.assignRole(AI_ACTOR, {
        targetUserId: TEST_USER_ID,
        roleId: TEST_ROLE_ID,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('AI_ACTOR should never be able to revoke roles', async () => {
      const result = await authService.revokeRole(AI_ACTOR, {
        targetUserId: TEST_USER_ID,
        roleId: TEST_ROLE_ID,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });
});
