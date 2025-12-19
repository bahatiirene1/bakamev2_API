/**
 * RAGConfigService Integration Tests
 * Phase 5: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with rag_configs table (migration 013)
 *
 * Tests are skipped if credentials are not available.
 *
 * SCOPE: Admin-configurable RAG settings
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  createRAGConfigService,
  createRAGConfigServiceDb,
} from '@/services/index.js';
import type { RAGConfigService } from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';
import { SYSTEM_ACTOR } from '@/types/index.js';

// Check if we have database credentials
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HAS_CREDENTIALS =
  SUPABASE_URL !== undefined &&
  SUPABASE_URL !== '' &&
  SUPABASE_SERVICE_KEY !== undefined &&
  SUPABASE_SERVICE_KEY !== '';

// Test fixtures - use nanoid for unique test identifiers
const TEST_PREFIX = `rag_test_${nanoid(6)}`;

// Helper to create unique test IDs
function testId(prefix: string): string {
  return `${TEST_PREFIX}_${prefix}_${nanoid(6)}`;
}

// Helper to create admin actor
function createAdminActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'admin',
    userId,
    requestId: testId('req'),
    permissions: ['rag:read', 'rag:write', 'rag:activate'],
    ...overrides,
  };
}

// Helper to create user actor with read permission
function createUserActor(
  userId: string,
  overrides?: Partial<ActorContext>
): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: ['rag:read'],
    ...overrides,
  };
}

// Track created resources for cleanup
const createdConfigIds: string[] = [];
const createdUserIds: string[] = [];

// Will be set in beforeAll
let TEST_USER_ID: string;

describe.skipIf(!HAS_CREDENTIALS)('RAGConfigService Integration', () => {
  let supabase: SupabaseClient;
  let ragConfigService: RAGConfigService;

  beforeAll(async () => {
    // Create Supabase client with service role key (bypasses RLS)
    supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Create a test user for this test suite
    const testUserId = testId('rag_user');
    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({
        id: testUserId,
        email: `${testUserId}@test.bakame.ai`,
        status: 'active',
      })
      .select()
      .single();

    if (userError) {
      throw new Error(`Failed to create test user: ${userError.message}`);
    }
    TEST_USER_ID = user.id;
    createdUserIds.push(TEST_USER_ID);

    // Create database adapters
    const ragConfigDb = createRAGConfigServiceDb(supabase);

    // Create RAG config service
    ragConfigService = createRAGConfigService({
      db: ragConfigDb,
      auditService: { log: async () => ({ success: true, data: undefined }) },
    });
  });

  afterAll(async () => {
    // Clean up created configs
    for (const configId of createdConfigIds) {
      try {
        // First deactivate if active
        await supabase
          .from('rag_configs')
          .update({ is_active: false })
          .eq('id', configId);
        // Then delete
        await supabase.from('rag_configs').delete().eq('id', configId);
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clean up created users
    for (const userId of createdUserIds) {
      try {
        await supabase.from('users').delete().eq('id', userId);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // createConfig
  // ─────────────────────────────────────────────────────────────

  describe('createConfig', () => {
    it('should create a RAG config with default values', async () => {
      const actor = createAdminActor(TEST_USER_ID);
      const configName = testId('config');

      const result = await ragConfigService.createConfig(actor, {
        name: configName,
        description: 'Test config with defaults',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdConfigIds.push(result.data.id);
        expect(result.data.name).toBe(configName);
        expect(result.data.memoryTokenBudget).toBe(2000);
        expect(result.data.knowledgeTokenBudget).toBe(4000);
        expect(result.data.memoryLimit).toBe(10);
        expect(result.data.minSimilarity).toBe(0.7);
        expect(result.data.isActive).toBe(false);
      }
    });

    it('should create a RAG config with custom values', async () => {
      const actor = createAdminActor(TEST_USER_ID);
      const configName = testId('custom');

      const result = await ragConfigService.createConfig(actor, {
        name: configName,
        memoryLimit: 20,
        knowledgeLimit: 10,
        minSimilarity: 0.85,
        importanceWeight: 0.4,
        similarityWeight: 0.4,
        recencyWeight: 0.2,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        createdConfigIds.push(result.data.id);
        expect(result.data.memoryLimit).toBe(20);
        expect(result.data.knowledgeLimit).toBe(10);
        expect(result.data.minSimilarity).toBe(0.85);
        expect(result.data.importanceWeight).toBe(0.4);
      }
    });

    it('should reject when user lacks rag:write permission', async () => {
      const actor = createUserActor(TEST_USER_ID);

      const result = await ragConfigService.createConfig(actor, {
        name: testId('unauthorized'),
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getConfig
  // ─────────────────────────────────────────────────────────────

  describe('getConfig', () => {
    it('should retrieve a config by ID', async () => {
      const adminActor = createAdminActor(TEST_USER_ID);
      const configName = testId('get-test');

      // Create config
      const createResult = await ragConfigService.createConfig(adminActor, {
        name: configName,
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdConfigIds.push(createResult.data.id);

      // Get config
      const getResult = await ragConfigService.getConfig(
        adminActor,
        createResult.data.id
      );

      expect(getResult.success).toBe(true);
      if (getResult.success) {
        expect(getResult.data.name).toBe(configName);
        expect(getResult.data.id).toBe(createResult.data.id);
      }
    });

    it('should return NOT_FOUND for nonexistent config', async () => {
      const actor = createAdminActor(TEST_USER_ID);

      const result = await ragConfigService.getConfig(
        actor,
        '00000000-0000-0000-0000-000000000000'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // updateConfig
  // ─────────────────────────────────────────────────────────────

  describe('updateConfig', () => {
    it('should update config settings', async () => {
      const actor = createAdminActor(TEST_USER_ID);
      const configName = testId('update-test');

      // Create config
      const createResult = await ragConfigService.createConfig(actor, {
        name: configName,
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdConfigIds.push(createResult.data.id);

      // Update config
      const updateResult = await ragConfigService.updateConfig(
        actor,
        createResult.data.id,
        {
          memoryLimit: 25,
          minSimilarity: 0.9,
        }
      );

      expect(updateResult.success).toBe(true);
      if (updateResult.success) {
        expect(updateResult.data.memoryLimit).toBe(25);
        expect(updateResult.data.minSimilarity).toBe(0.9);
      }
    });

    it('should reject invalid reranking weights', async () => {
      const actor = createAdminActor(TEST_USER_ID);
      const configName = testId('invalid-weights');

      // Create config
      const createResult = await ragConfigService.createConfig(actor, {
        name: configName,
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdConfigIds.push(createResult.data.id);

      // Try to update with invalid weights (sum > 1.0)
      const updateResult = await ragConfigService.updateConfig(
        actor,
        createResult.data.id,
        {
          importanceWeight: 0.5,
          similarityWeight: 0.5,
          recencyWeight: 0.5,
        }
      );

      expect(updateResult.success).toBe(false);
      if (!updateResult.success) {
        expect(updateResult.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // activateConfig / deactivateConfig
  // ─────────────────────────────────────────────────────────────

  describe('activate/deactivate', () => {
    it('should activate a config and deactivate others', async () => {
      const actor = createAdminActor(TEST_USER_ID);

      // Create two configs
      const config1Result = await ragConfigService.createConfig(actor, {
        name: testId('activate-1'),
      });
      expect(config1Result.success).toBe(true);
      if (!config1Result.success) {
        return;
      }
      createdConfigIds.push(config1Result.data.id);

      const config2Result = await ragConfigService.createConfig(actor, {
        name: testId('activate-2'),
      });
      expect(config2Result.success).toBe(true);
      if (!config2Result.success) {
        return;
      }
      createdConfigIds.push(config2Result.data.id);

      // Activate first config
      const activate1Result = await ragConfigService.activateConfig(
        actor,
        config1Result.data.id
      );
      expect(activate1Result.success).toBe(true);
      if (activate1Result.success) {
        expect(activate1Result.data.isActive).toBe(true);
      }

      // Activate second config (should deactivate first)
      const activate2Result = await ragConfigService.activateConfig(
        actor,
        config2Result.data.id
      );
      expect(activate2Result.success).toBe(true);
      if (activate2Result.success) {
        expect(activate2Result.data.isActive).toBe(true);
      }

      // Verify first is now inactive
      const getConfig1 = await ragConfigService.getConfig(
        actor,
        config1Result.data.id
      );
      expect(getConfig1.success).toBe(true);
      if (getConfig1.success) {
        expect(getConfig1.data.isActive).toBe(false);
      }
    });

    it('should deactivate a config', async () => {
      const actor = createAdminActor(TEST_USER_ID);

      // Create and activate config
      const createResult = await ragConfigService.createConfig(actor, {
        name: testId('deactivate-test'),
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdConfigIds.push(createResult.data.id);

      await ragConfigService.activateConfig(actor, createResult.data.id);

      // Deactivate
      const deactivateResult = await ragConfigService.deactivateConfig(
        actor,
        createResult.data.id
      );

      expect(deactivateResult.success).toBe(true);
      if (deactivateResult.success) {
        expect(deactivateResult.data.isActive).toBe(false);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getActiveConfig
  // ─────────────────────────────────────────────────────────────

  describe('getActiveConfig', () => {
    it('should return the active config', async () => {
      const actor = createAdminActor(TEST_USER_ID);

      // Create and activate a config
      const createResult = await ragConfigService.createConfig(actor, {
        name: testId('active-test'),
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdConfigIds.push(createResult.data.id);

      await ragConfigService.activateConfig(actor, createResult.data.id);

      // Get active config
      const activeResult = await ragConfigService.getActiveConfig(actor);

      expect(activeResult.success).toBe(true);
      if (activeResult.success) {
        expect(activeResult.data.id).toBe(createResult.data.id);
        expect(activeResult.data.isActive).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // listConfigs
  // ─────────────────────────────────────────────────────────────

  describe('listConfigs', () => {
    it('should list all configs', async () => {
      const actor = createAdminActor(TEST_USER_ID);

      const result = await ragConfigService.listConfigs(actor, { limit: 100 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.length).toBeGreaterThan(0);
      }
    });

    it('should filter by isActive', async () => {
      const actor = createAdminActor(TEST_USER_ID);

      // Create and activate a config
      const createResult = await ragConfigService.createConfig(actor, {
        name: testId('filter-active'),
      });
      if (createResult.success) {
        createdConfigIds.push(createResult.data.id);
        await ragConfigService.activateConfig(actor, createResult.data.id);
      }

      const result = await ragConfigService.listConfigs(actor, {
        isActive: true,
        limit: 10,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.every((c) => c.isActive)).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // deleteConfig
  // ─────────────────────────────────────────────────────────────

  describe('deleteConfig', () => {
    it('should delete an inactive config', async () => {
      const actor = createAdminActor(TEST_USER_ID);

      // Create config
      const createResult = await ragConfigService.createConfig(actor, {
        name: testId('delete-test'),
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      // Don't add to cleanup since we're deleting

      // Delete config
      const deleteResult = await ragConfigService.deleteConfig(
        actor,
        createResult.data.id
      );

      expect(deleteResult.success).toBe(true);

      // Verify deleted
      const getResult = await ragConfigService.getConfig(
        actor,
        createResult.data.id
      );
      expect(getResult.success).toBe(false);
    });

    it('should reject deletion of active config', async () => {
      const actor = createAdminActor(TEST_USER_ID);

      // Create and activate config
      const createResult = await ragConfigService.createConfig(actor, {
        name: testId('delete-active'),
      });
      expect(createResult.success).toBe(true);
      if (!createResult.success) {
        return;
      }
      createdConfigIds.push(createResult.data.id);

      await ragConfigService.activateConfig(actor, createResult.data.id);

      // Try to delete
      const deleteResult = await ragConfigService.deleteConfig(
        actor,
        createResult.data.id
      );

      expect(deleteResult.success).toBe(false);
      if (!deleteResult.success) {
        expect(deleteResult.error.code).toBe('INVALID_STATE');
      }
    });
  });
});
