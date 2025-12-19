/**
 * UserService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.2
 *
 * SCOPE: Profiles, AI preferences, account status
 * NOT IN SCOPE: Roles, permissions, auth tokens, subscriptions
 *
 * GUARDRAILS:
 * - AI_ACTOR must not mutate user data
 * - All mutations must emit audit events
 * - Result pattern required (no thrown errors)
 * - Soft delete only
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { UserService } from '@/services/user.service.js';
import { createUserService } from '@/services/user.service.js';
import type {
  ActorContext,
  User,
  Profile,
  AIPreferences,
  ProfileUpdate,
  AIPreferencesUpdate,
} from '@/types/index.js';
import { SYSTEM_ACTOR, AI_ACTOR } from '@/types/index.js';

// Test fixtures
const TEST_USER_ID = 'user_test123';
const TEST_OTHER_USER_ID = 'user_other456';
const TEST_ADMIN_ID = 'admin_test123';
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
  permissions: ['user:read', 'user:update', 'user:manage'],
  ...overrides,
});

// Mock data
const mockUser: User = {
  id: TEST_USER_ID,
  email: 'test@example.com',
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const mockProfile: Profile = {
  id: 'profile_123',
  userId: TEST_USER_ID,
  displayName: 'Test User',
  avatarUrl: 'https://example.com/avatar.png',
  timezone: 'UTC',
  locale: 'en',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAIPreferences: AIPreferences = {
  id: 'pref_123',
  userId: TEST_USER_ID,
  responseLength: 'balanced',
  formality: 'neutral',
  allowMemory: true,
  allowWebSearch: false,
  customInstructions: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('UserService', () => {
  let userService: UserService;
  let mockDb: {
    getUser: ReturnType<typeof vi.fn>;
    createUser: ReturnType<typeof vi.fn>;
    updateUserStatus: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
    createProfile: ReturnType<typeof vi.fn>;
    updateProfile: ReturnType<typeof vi.fn>;
    getAIPreferences: ReturnType<typeof vi.fn>;
    createAIPreferences: ReturnType<typeof vi.fn>;
    updateAIPreferences: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
  };
  let mockAuditService: {
    log: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockDb = {
      getUser: vi.fn(),
      createUser: vi.fn(),
      updateUserStatus: vi.fn(),
      getProfile: vi.fn(),
      createProfile: vi.fn(),
      updateProfile: vi.fn(),
      getAIPreferences: vi.fn(),
      createAIPreferences: vi.fn(),
      updateAIPreferences: vi.fn(),
      listUsers: vi.fn(),
    };

    mockAuditService = {
      log: vi.fn().mockResolvedValue({ success: true }),
    };

    userService = createUserService({
      db: mockDb,
      auditService: mockAuditService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // USER LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  describe('onUserSignup', () => {
    it('should create user, profile, and AI preferences', async () => {
      const actor = SYSTEM_ACTOR;
      mockDb.createUser.mockResolvedValue(mockUser);
      mockDb.createProfile.mockResolvedValue(mockProfile);
      mockDb.createAIPreferences.mockResolvedValue(mockAIPreferences);

      const result = await userService.onUserSignup(actor, {
        authUserId: TEST_USER_ID,
        email: 'test@example.com',
      });

      expect(result.success).toBe(true);
      expect(mockDb.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_USER_ID,
          email: 'test@example.com',
        })
      );
      expect(mockDb.createProfile).toHaveBeenCalled();
      expect(mockDb.createAIPreferences).toHaveBeenCalled();
    });

    it('should emit audit event on signup', async () => {
      const actor = SYSTEM_ACTOR;
      mockDb.createUser.mockResolvedValue(mockUser);
      mockDb.createProfile.mockResolvedValue(mockProfile);
      mockDb.createAIPreferences.mockResolvedValue(mockAIPreferences);

      await userService.onUserSignup(actor, {
        authUserId: TEST_USER_ID,
        email: 'test@example.com',
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'user:signup',
          resourceType: 'user',
          resourceId: TEST_USER_ID,
        })
      );
    });

    it('should NOT assign roles (guardrail: no role assignment)', async () => {
      const actor = SYSTEM_ACTOR;
      mockDb.createUser.mockResolvedValue(mockUser);
      mockDb.createProfile.mockResolvedValue(mockProfile);
      mockDb.createAIPreferences.mockResolvedValue(mockAIPreferences);

      await userService.onUserSignup(actor, {
        authUserId: TEST_USER_ID,
        email: 'test@example.com',
      });

      // Verify no role-related calls
      expect(mockDb).not.toHaveProperty('assignRole');
    });

    it('should return VALIDATION_ERROR for invalid email', async () => {
      const actor = SYSTEM_ACTOR;

      const result = await userService.onUserSignup(actor, {
        authUserId: TEST_USER_ID,
        email: 'invalid-email',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('getUser', () => {
    it('should allow user to get their own record', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getUser.mockResolvedValue(mockUser);

      const result = await userService.getUser(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(TEST_USER_ID);
      }
    });

    it('should require user:read permission to get other users', async () => {
      const actor = createTestActor({
        userId: TEST_USER_ID,
        permissions: [],
      });

      const result = await userService.getUser(actor, TEST_OTHER_USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow user:read permission holder to get other users', async () => {
      const actor = createTestActor({
        userId: TEST_USER_ID,
        permissions: ['user:read'],
      });
      mockDb.getUser.mockResolvedValue({ ...mockUser, id: TEST_OTHER_USER_ID });

      const result = await userService.getUser(actor, TEST_OTHER_USER_ID);

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent user', async () => {
      const actor = createAdminActor();
      mockDb.getUser.mockResolvedValue(null);

      const result = await userService.getUser(actor, 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should handle deleted users appropriately', async () => {
      const actor = createAdminActor();
      const deletedUser = {
        ...mockUser,
        status: 'deleted' as const,
        deletedAt: new Date(),
      };
      mockDb.getUser.mockResolvedValue(deletedUser);

      const result = await userService.getUser(actor, TEST_USER_ID);

      // Deleted users should still be retrievable by admins
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('deleted');
      }
    });
  });

  describe('suspendUser', () => {
    it('should suspend user when actor has user:manage permission', async () => {
      const actor = createAdminActor();
      mockDb.getUser.mockResolvedValue(mockUser);
      mockDb.updateUserStatus.mockResolvedValue({
        ...mockUser,
        status: 'suspended',
      });

      const result = await userService.suspendUser(
        actor,
        TEST_USER_ID,
        'Violation of terms'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updateUserStatus).toHaveBeenCalledWith(
        TEST_USER_ID,
        'suspended'
      );
    });

    it('should emit audit event on suspend', async () => {
      const actor = createAdminActor();
      mockDb.getUser.mockResolvedValue(mockUser);
      mockDb.updateUserStatus.mockResolvedValue({
        ...mockUser,
        status: 'suspended',
      });

      await userService.suspendUser(actor, TEST_USER_ID, 'Violation of terms');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'user:suspended',
          resourceType: 'user',
          resourceId: TEST_USER_ID,
          details: expect.objectContaining({ reason: 'Violation of terms' }),
        })
      );
    });

    it('should deny suspension without user:manage permission', async () => {
      const actor = createTestActor({ permissions: [] });

      const result = await userService.suspendUser(
        actor,
        TEST_OTHER_USER_ID,
        'Reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should prevent self-suspension', async () => {
      const actor = createAdminActor({ userId: TEST_USER_ID });

      const result = await userService.suspendUser(
        actor,
        TEST_USER_ID,
        'Reason'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  describe('reactivateUser', () => {
    it('should reactivate suspended user', async () => {
      const actor = createAdminActor();
      const suspendedUser = { ...mockUser, status: 'suspended' as const };
      mockDb.getUser.mockResolvedValue(suspendedUser);
      mockDb.updateUserStatus.mockResolvedValue({
        ...mockUser,
        status: 'active',
      });

      const result = await userService.reactivateUser(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
      expect(mockDb.updateUserStatus).toHaveBeenCalledWith(
        TEST_USER_ID,
        'active'
      );
    });

    it('should emit audit event on reactivation', async () => {
      const actor = createAdminActor();
      const suspendedUser = { ...mockUser, status: 'suspended' as const };
      mockDb.getUser.mockResolvedValue(suspendedUser);
      mockDb.updateUserStatus.mockResolvedValue({
        ...mockUser,
        status: 'active',
      });

      await userService.reactivateUser(actor, TEST_USER_ID);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'user:reactivated',
          resourceType: 'user',
          resourceId: TEST_USER_ID,
        })
      );
    });

    it('should deny reactivation without user:manage permission', async () => {
      const actor = createTestActor({ permissions: [] });

      const result = await userService.reactivateUser(actor, TEST_USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // PROFILE MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  describe('getProfile', () => {
    it('should allow user to read own profile', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getProfile.mockResolvedValue(mockProfile);

      const result = await userService.getProfile(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(TEST_USER_ID);
      }
    });

    it('should require user:read permission to read other profiles', async () => {
      const actor = createTestActor({
        userId: TEST_USER_ID,
        permissions: [],
      });

      const result = await userService.getProfile(actor, TEST_OTHER_USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow user:read holder to read other profiles', async () => {
      const actor = createTestActor({
        userId: TEST_USER_ID,
        permissions: ['user:read'],
      });
      mockDb.getProfile.mockResolvedValue({
        ...mockProfile,
        userId: TEST_OTHER_USER_ID,
      });

      const result = await userService.getProfile(actor, TEST_OTHER_USER_ID);

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent profile', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getProfile.mockResolvedValue(null);

      const result = await userService.getProfile(actor, TEST_USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  describe('updateProfile', () => {
    const profileUpdate: ProfileUpdate = {
      displayName: 'New Name',
      timezone: 'America/New_York',
    };

    it('should allow user to update own profile', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getUser.mockResolvedValue(mockUser);
      mockDb.getProfile.mockResolvedValue(mockProfile);
      mockDb.updateProfile.mockResolvedValue({
        ...mockProfile,
        ...profileUpdate,
      });

      const result = await userService.updateProfile(
        actor,
        TEST_USER_ID,
        profileUpdate
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe('New Name');
      }
    });

    it('should emit audit event on profile update', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getUser.mockResolvedValue(mockUser);
      mockDb.getProfile.mockResolvedValue(mockProfile);
      mockDb.updateProfile.mockResolvedValue({
        ...mockProfile,
        ...profileUpdate,
      });

      await userService.updateProfile(actor, TEST_USER_ID, profileUpdate);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'user:profile_updated',
          resourceType: 'profile',
          resourceId: mockProfile.id,
          details: expect.objectContaining({
            changedFields: ['displayName', 'timezone'],
          }),
        })
      );
    });

    it('should require user:update permission to update other profiles', async () => {
      const actor = createTestActor({
        userId: TEST_USER_ID,
        permissions: [],
      });

      const result = await userService.updateProfile(
        actor,
        TEST_OTHER_USER_ID,
        profileUpdate
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow user:update holder to update other profiles', async () => {
      const actor = createAdminActor();
      mockDb.getUser.mockResolvedValue({ ...mockUser, id: TEST_OTHER_USER_ID });
      mockDb.getProfile.mockResolvedValue({
        ...mockProfile,
        userId: TEST_OTHER_USER_ID,
      });
      mockDb.updateProfile.mockResolvedValue({
        ...mockProfile,
        userId: TEST_OTHER_USER_ID,
        ...profileUpdate,
      });

      const result = await userService.updateProfile(
        actor,
        TEST_OTHER_USER_ID,
        profileUpdate
      );

      expect(result.success).toBe(true);
    });

    it('should return VALIDATION_ERROR for invalid timezone', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getProfile.mockResolvedValue(mockProfile);

      const result = await userService.updateProfile(actor, TEST_USER_ID, {
        timezone: '', // Empty string invalid
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AI PREFERENCES
  // ─────────────────────────────────────────────────────────────

  describe('getAIPreferences', () => {
    it('should allow user to read own AI preferences', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getAIPreferences.mockResolvedValue(mockAIPreferences);

      const result = await userService.getAIPreferences(actor, TEST_USER_ID);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(TEST_USER_ID);
      }
    });

    it('should require user:read permission to read other preferences', async () => {
      const actor = createTestActor({
        userId: TEST_USER_ID,
        permissions: [],
      });

      const result = await userService.getAIPreferences(
        actor,
        TEST_OTHER_USER_ID
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  describe('updateAIPreferences', () => {
    const prefsUpdate: AIPreferencesUpdate = {
      responseLength: 'detailed',
      allowMemory: false,
    };

    it('should allow user to update own AI preferences', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getAIPreferences.mockResolvedValue(mockAIPreferences);
      mockDb.updateAIPreferences.mockResolvedValue({
        ...mockAIPreferences,
        ...prefsUpdate,
      });

      const result = await userService.updateAIPreferences(
        actor,
        TEST_USER_ID,
        prefsUpdate
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responseLength).toBe('detailed');
        expect(result.data.allowMemory).toBe(false);
      }
    });

    it('should emit audit event on AI preferences update', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getAIPreferences.mockResolvedValue(mockAIPreferences);
      mockDb.updateAIPreferences.mockResolvedValue({
        ...mockAIPreferences,
        ...prefsUpdate,
      });

      await userService.updateAIPreferences(actor, TEST_USER_ID, prefsUpdate);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'user:ai_preferences_updated',
          resourceType: 'ai_preferences',
          details: expect.objectContaining({
            changedFields: ['responseLength', 'allowMemory'],
          }),
        })
      );
    });

    it('should require user:update permission to update other preferences', async () => {
      const actor = createTestActor({
        userId: TEST_USER_ID,
        permissions: [],
      });

      const result = await userService.updateAIPreferences(
        actor,
        TEST_OTHER_USER_ID,
        prefsUpdate
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST USERS (Admin only)
  // ─────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('should return paginated users for admin', async () => {
      const actor = createAdminActor();
      mockDb.listUsers.mockResolvedValue({
        items: [mockUser],
        hasMore: false,
      });

      const result = await userService.listUsers(actor, { limit: 20 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
      }
    });

    it('should require user:read permission to list users', async () => {
      const actor = createTestActor({ permissions: [] });

      const result = await userService.listUsers(actor, { limit: 20 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should support filtering by status', async () => {
      const actor = createAdminActor();
      mockDb.listUsers.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      await userService.listUsers(actor, { limit: 20, status: 'suspended' });

      expect(mockDb.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'suspended' })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AI_ACTOR INVARIANTS (CRITICAL GUARDRAIL)
  // ─────────────────────────────────────────────────────────────

  describe('AI_ACTOR Invariants', () => {
    it('AI_ACTOR should NOT be able to update profiles', async () => {
      const result = await userService.updateProfile(AI_ACTOR, TEST_USER_ID, {
        displayName: 'Hacked by AI',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('AI_ACTOR should NOT be able to update AI preferences', async () => {
      const result = await userService.updateAIPreferences(
        AI_ACTOR,
        TEST_USER_ID,
        { allowMemory: true }
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('AI_ACTOR should NOT be able to suspend users', async () => {
      const result = await userService.suspendUser(
        AI_ACTOR,
        TEST_USER_ID,
        'AI decision'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('AI_ACTOR should NOT be able to reactivate users', async () => {
      const result = await userService.reactivateUser(AI_ACTOR, TEST_USER_ID);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('AI_ACTOR should NOT be able to trigger user signup', async () => {
      const result = await userService.onUserSignup(AI_ACTOR, {
        authUserId: 'fake_user',
        email: 'fake@example.com',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('AI_ACTOR MAY read profiles (read-only access)', async () => {
      mockDb.getProfile.mockResolvedValue(mockProfile);

      // AI can read but this depends on design choice
      // Per guardrails: "AI_ACTOR read-only OR forbidden"
      // We'll allow read-only for AI to support context assembly
      const result = await userService.getProfile(AI_ACTOR, TEST_USER_ID);

      // Design decision: AI CAN read for context assembly
      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SOFT DELETE HANDLING
  // ─────────────────────────────────────────────────────────────

  describe('Soft Delete', () => {
    it('should use soft delete (deletedAt) not hard delete', async () => {
      const actor = createAdminActor();
      mockDb.getUser.mockResolvedValue(mockUser);
      mockDb.updateUserStatus.mockResolvedValue({
        ...mockUser,
        status: 'deleted',
        deletedAt: new Date(),
      });

      // There should be no hard delete method
      expect(userService).not.toHaveProperty('deleteUser');
    });

    it('deleted user profile updates should fail', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      const deletedProfile = {
        ...mockProfile,
      };
      mockDb.getProfile.mockResolvedValue(deletedProfile);
      mockDb.getUser.mockResolvedValue({
        ...mockUser,
        status: 'deleted',
        deletedAt: new Date(),
      });

      const result = await userService.updateProfile(actor, TEST_USER_ID, {
        displayName: 'New Name',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // VALIDATION ERRORS
  // ─────────────────────────────────────────────────────────────

  describe('Validation', () => {
    it('should reject empty userId', async () => {
      const actor = createAdminActor();

      const result = await userService.getUser(actor, '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject invalid locale in profile update', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getProfile.mockResolvedValue(mockProfile);

      const result = await userService.updateProfile(actor, TEST_USER_ID, {
        locale: '', // Empty locale invalid
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject displayName exceeding max length', async () => {
      const actor = createTestActor({ userId: TEST_USER_ID });
      mockDb.getProfile.mockResolvedValue(mockProfile);

      const result = await userService.updateProfile(actor, TEST_USER_ID, {
        displayName: 'A'.repeat(256), // Too long
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
