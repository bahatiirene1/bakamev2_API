/**
 * UserService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with users, profiles, ai_preferences tables
 *
 * Tests are skipped if credentials are not available.
 *
 * SCOPE: Profiles, AI preferences, account status
 * NOT IN SCOPE: Roles, permissions, auth tokens, subscriptions
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createUserService,
  createUserServiceDb,
  createAuditService,
  createAuditServiceDb,
} from '@/services/index.js';
import type { UserService, AuditService } from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { SYSTEM_ACTOR, AI_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for unique test identifiers
const TEST_PREFIX = `test_${nanoid(6)}`;

// Helper to create unique test IDs
function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create test actor
function createTestActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'user',
    userId: testId('user'),
    requestId: testId('req'),
    permissions: [],
    ...overrides,
  };
}

// Helper to create admin actor
function createAdminActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: testId('admin'),
    requestId: testId('req'),
    permissions: ['user:read', 'user:update', 'user:manage'],
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('UserService Integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: SupabaseClient<any, 'public', any>;
  let userService: UserService;
  let auditService: AuditService;

  // Track created users for cleanup
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_KEY!
    ) as SupabaseClient<any, 'public', any>;

    // Create database adapters and services
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const auditDb = createAuditServiceDb(supabase);
    auditService = createAuditService({ db: auditDb });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const userDb = createUserServiceDb(supabase);
    userService = createUserService({ db: userDb, auditService });
  });

  afterAll(async () => {
    // Cleanup test data
    try {
      // Delete users (cascades to profiles and ai_preferences)
      for (const userId of createdUserIds) {
        await supabase.from('ai_preferences').delete().eq('user_id', userId);
        await supabase.from('profiles').delete().eq('user_id', userId);
        await supabase.from('users').delete().eq('id', userId);
      }
      // Clean up audit logs
      await supabase
        .from('audit_logs')
        .delete()
        .like('request_id', `${TEST_PREFIX}%`);
    } catch {
      // Cleanup failure is acceptable - tests use unique prefixes
    }
  });

  // ─────────────────────────────────────────────────────────────
  // USER SIGNUP
  // ─────────────────────────────────────────────────────────────

  describe('onUserSignup', () => {
    it('should create user, profile, and AI preferences in database', async () => {
      const userId = testId('signup');
      const email = `${userId}@test.example.com`;

      const result = await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdUserIds.push(result.data.id);

        // Verify user was created
        const { data: user } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();
        expect(user).not.toBeNull();
        expect(user?.email).toBe(email);
        expect(user?.status).toBe('active');

        // Verify profile was created
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', userId)
          .single();
        expect(profile).not.toBeNull();
        expect(profile?.timezone).toBe('UTC');
        expect(profile?.locale).toBe('en');

        // Verify AI preferences were created
        const { data: prefs } = await supabase
          .from('ai_preferences')
          .select('*')
          .eq('user_id', userId)
          .single();
        expect(prefs).not.toBeNull();
        expect(prefs?.response_length).toBe('balanced');
        expect(prefs?.formality).toBe('neutral');
        expect(prefs?.allow_memory).toBe(true);
      }
    });

    it('should emit audit event on signup', async () => {
      const userId = testId('audit');
      const email = `${userId}@test.example.com`;
      const requestId = testId('req');
      const actor = { ...SYSTEM_ACTOR, requestId };

      const result = await userService.onUserSignup(actor, {
        authUserId: userId,
        email,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdUserIds.push(result.data.id);

        // Verify audit log was created
        const { data: logs } = await supabase
          .from('audit_logs')
          .select('*')
          .eq('action', 'user:signup')
          .eq('resource_id', userId);

        expect(logs?.length).toBeGreaterThan(0);
        const log = logs?.[0];
        expect(log?.resource_type).toBe('user');
      }
    });

    it('should reject AI_ACTOR from triggering signup', async () => {
      const result = await userService.onUserSignup(AI_ACTOR, {
        authUserId: testId('fake'),
        email: 'fake@test.example.com',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // GET USER
  // ─────────────────────────────────────────────────────────────

  describe('getUser', () => {
    it('should allow user to get their own record', async () => {
      // Create test user first
      const userId = testId('getself');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      // Get user as themselves
      const actor = createTestActor({ userId });
      const result = await userService.getUser(actor, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(userId);
        expect(result.data.email).toBe(email);
      }
    });

    it('should allow admin to get other users', async () => {
      // Create test user first
      const userId = testId('getother');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      // Get user as admin
      const admin = createAdminActor();
      const result = await userService.getUser(admin, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(userId);
      }
    });

    it('should deny access without permission', async () => {
      const userId = testId('deny');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      // Try to get user as different user without permission
      const actor = createTestActor({ userId: testId('other') });
      const result = await userService.getUser(actor, userId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND for non-existent user', async () => {
      const admin = createAdminActor();
      const result = await userService.getUser(admin, testId('nonexistent'));

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUSPEND/REACTIVATE USER
  // ─────────────────────────────────────────────────────────────

  describe('suspendUser and reactivateUser', () => {
    it('should suspend user and update status in database', async () => {
      const userId = testId('suspend');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const admin = createAdminActor();
      const result = await userService.suspendUser(
        admin,
        userId,
        'Test suspension'
      );

      expect(result.success).toBe(true);

      // Verify status in database
      const { data: user } = await supabase
        .from('users')
        .select('status')
        .eq('id', userId)
        .single();
      expect(user?.status).toBe('suspended');
    });

    it('should reactivate suspended user', async () => {
      const userId = testId('reactivate');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const admin = createAdminActor();

      // Suspend first
      await userService.suspendUser(admin, userId, 'Test');

      // Reactivate
      const result = await userService.reactivateUser(admin, userId);

      expect(result.success).toBe(true);

      // Verify status in database
      const { data: user } = await supabase
        .from('users')
        .select('status')
        .eq('id', userId)
        .single();
      expect(user?.status).toBe('active');
    });

    it('should deny AI_ACTOR from suspending users', async () => {
      const userId = testId('aisuspend');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const result = await userService.suspendUser(
        AI_ACTOR,
        userId,
        'AI decision'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // PROFILE MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  describe('getProfile and updateProfile', () => {
    it('should get profile with correct data', async () => {
      const userId = testId('getprofile');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const actor = createTestActor({ userId });
      const result = await userService.getProfile(actor, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(userId);
        expect(result.data.timezone).toBe('UTC');
        expect(result.data.locale).toBe('en');
      }
    });

    it('should update profile and persist to database', async () => {
      const userId = testId('updateprofile');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const actor = createTestActor({ userId });
      const result = await userService.updateProfile(actor, userId, {
        displayName: 'Test User',
        timezone: 'America/New_York',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBe('Test User');
        expect(result.data.timezone).toBe('America/New_York');
      }

      // Verify in database
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      expect(profile?.display_name).toBe('Test User');
      expect(profile?.timezone).toBe('America/New_York');
    });

    it('should allow AI_ACTOR to read profiles', async () => {
      const userId = testId('airead');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const result = await userService.getProfile(AI_ACTOR, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(userId);
      }
    });

    it('should deny AI_ACTOR from updating profiles', async () => {
      const userId = testId('aiupdate');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const result = await userService.updateProfile(AI_ACTOR, userId, {
        displayName: 'Hacked by AI',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AI PREFERENCES
  // ─────────────────────────────────────────────────────────────

  describe('getAIPreferences and updateAIPreferences', () => {
    it('should get AI preferences with correct defaults', async () => {
      const userId = testId('getprefs');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const actor = createTestActor({ userId });
      const result = await userService.getAIPreferences(actor, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(userId);
        expect(result.data.responseLength).toBe('balanced');
        expect(result.data.formality).toBe('neutral');
        expect(result.data.allowMemory).toBe(true);
        expect(result.data.allowWebSearch).toBe(false);
      }
    });

    it('should update AI preferences and persist to database', async () => {
      const userId = testId('updateprefs');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const actor = createTestActor({ userId });
      const result = await userService.updateAIPreferences(actor, userId, {
        responseLength: 'detailed',
        formality: 'formal',
        allowMemory: false,
        customInstructions: 'Be brief and professional.',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responseLength).toBe('detailed');
        expect(result.data.formality).toBe('formal');
        expect(result.data.allowMemory).toBe(false);
        expect(result.data.customInstructions).toBe(
          'Be brief and professional.'
        );
      }

      // Verify in database
      const { data: prefs } = await supabase
        .from('ai_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();
      expect(prefs?.response_length).toBe('detailed');
      expect(prefs?.formality).toBe('formal');
      expect(prefs?.allow_memory).toBe(false);
    });

    it('should allow AI_ACTOR to read AI preferences', async () => {
      const userId = testId('aireadprefs');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const result = await userService.getAIPreferences(AI_ACTOR, userId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.userId).toBe(userId);
      }
    });

    it('should deny AI_ACTOR from updating AI preferences', async () => {
      const userId = testId('aiupdateprefs');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      const result = await userService.updateAIPreferences(AI_ACTOR, userId, {
        allowMemory: true,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // LIST USERS
  // ─────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('should list users with pagination', async () => {
      // Create multiple test users
      const userIds: string[] = [];
      for (let i = 0; i < 3; i++) {
        const userId = testId(`list${i}`);
        const email = `${userId}@test.example.com`;
        await userService.onUserSignup(SYSTEM_ACTOR, {
          authUserId: userId,
          email,
        });
        userIds.push(userId);
        createdUserIds.push(userId);
      }

      const admin = createAdminActor();
      const result = await userService.listUsers(admin, { limit: 2 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.length).toBeLessThanOrEqual(2);
        // We can't guarantee hasMore is true due to other data in database
      }
    });

    it('should filter users by status', async () => {
      const userId = testId('filterstatus');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      // Suspend the user
      const admin = createAdminActor();
      await userService.suspendUser(admin, userId, 'Test');

      // List suspended users
      const result = await userService.listUsers(admin, {
        limit: 100,
        status: 'suspended',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const found = result.data.items.find((u) => u.id === userId);
        expect(found).toBeDefined();
        expect(found?.status).toBe('suspended');
      }
    });

    it('should deny listing without user:read permission', async () => {
      const actor = createTestActor({ permissions: [] });
      const result = await userService.listUsers(actor, { limit: 20 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SOFT DELETE
  // ─────────────────────────────────────────────────────────────

  describe('Soft Delete', () => {
    it('should prevent profile updates for deleted users', async () => {
      const userId = testId('deleted');
      const email = `${userId}@test.example.com`;
      await userService.onUserSignup(SYSTEM_ACTOR, {
        authUserId: userId,
        email,
      });
      createdUserIds.push(userId);

      // Soft delete the user by updating status
      await supabase
        .from('users')
        .update({ status: 'deleted', deleted_at: new Date().toISOString() })
        .eq('id', userId);

      // Try to update profile
      const actor = createTestActor({ userId });
      const result = await userService.updateProfile(actor, userId, {
        displayName: 'Should Fail',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });
});
