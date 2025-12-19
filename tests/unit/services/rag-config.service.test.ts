/**
 * RAGConfigService Unit Tests
 * TDD RED PHASE: Tests define the expected behavior
 *
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.4 (Layer 4: Retrieved Context)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  createRAGConfigService,
  type RAGConfigService,
  type RAGConfigServiceDb,
  type RAGConfigServiceAudit,
} from '@/services/rag-config.service.js';
import type {
  ActorContext,
  RAGConfig,
  CreateRAGConfigParams,
  RAGConfigUpdate,
  PaginatedResult,
} from '@/types/index.js';
import { SYSTEM_ACTOR } from '@/types/index.js';

// ─────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────

function createUserActor(
  userId: string,
  permissions: string[] = []
): ActorContext {
  return {
    type: 'user',
    userId,
    permissions,
  };
}

function createAdminActor(userId: string): ActorContext {
  return {
    type: 'admin',
    userId,
    permissions: ['rag:read', 'rag:write', 'rag:activate'],
  };
}

function createMockRAGConfig(overrides: Partial<RAGConfig> = {}): RAGConfig {
  return {
    id: 'rag-config-123',
    name: 'Test Config',
    description: 'A test RAG configuration',

    // Token Budgets
    memoryTokenBudget: 2000,
    knowledgeTokenBudget: 4000,
    conversationTokenBudget: 4000,

    // Retrieval Limits
    memoryLimit: 10,
    knowledgeLimit: 5,
    minSimilarity: 0.7,

    // Reranking Weights
    importanceWeight: 0.3,
    similarityWeight: 0.5,
    recencyWeight: 0.2,

    // Embedding Configuration
    embeddingModel: 'text-embedding-3-small',
    embeddingDimensions: 1536,

    // Memory Extraction Settings
    extractionEnabled: true,
    extractionPrompt: null,
    memoryCategories: ['preference', 'fact', 'event', 'instruction'],

    // Consolidation Settings
    consolidationEnabled: true,
    consolidationThreshold: 0.85,

    // Status
    isActive: false,
    authorId: 'admin-1',

    // Timestamps
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    activatedAt: null,
    ...overrides,
  };
}

function createMockDb(): RAGConfigServiceDb {
  return {
    createConfig: vi.fn(),
    getConfig: vi.fn(),
    getActiveConfig: vi.fn(),
    listConfigs: vi.fn(),
    updateConfig: vi.fn(),
    activateConfig: vi.fn(),
    deactivateConfig: vi.fn(),
    deleteConfig: vi.fn(),
  };
}

function createMockAuditService(): RAGConfigServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('RAGConfigService', () => {
  let service: RAGConfigService;
  let mockDb: RAGConfigServiceDb;
  let mockAuditService: RAGConfigServiceAudit;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    service = createRAGConfigService({
      db: mockDb,
      auditService: mockAuditService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // createConfig
  // ─────────────────────────────────────────────────────────────

  describe('createConfig', () => {
    const validParams: CreateRAGConfigParams = {
      name: 'High Precision Config',
      description: 'A config optimized for precision',
      memoryLimit: 15,
      minSimilarity: 0.8,
    };

    it('should create a config when admin has rag:write permission', async () => {
      const actor = createAdminActor('admin-1');
      const mockConfig = createMockRAGConfig({
        name: 'High Precision Config',
        memoryLimit: 15,
        minSimilarity: 0.8,
        authorId: 'admin-1',
      });
      vi.mocked(mockDb.createConfig).mockResolvedValue(mockConfig);

      const result = await service.createConfig(actor, validParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('High Precision Config');
        expect(result.data.memoryLimit).toBe(15);
        expect(result.data.minSimilarity).toBe(0.8);
        expect(result.data.isActive).toBe(false);
      }
    });

    it('should reject when user lacks rag:write permission', async () => {
      const actor = createUserActor('user-1', ['rag:read']);

      const result = await service.createConfig(actor, validParams);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should use default values for unspecified parameters', async () => {
      const actor = createAdminActor('admin-1');
      const minimalParams: CreateRAGConfigParams = {
        name: 'Minimal Config',
      };
      const mockConfig = createMockRAGConfig({
        name: 'Minimal Config',
        authorId: 'admin-1',
      });
      vi.mocked(mockDb.createConfig).mockResolvedValue(mockConfig);

      const result = await service.createConfig(actor, minimalParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memoryTokenBudget).toBe(2000);
        expect(result.data.knowledgeTokenBudget).toBe(4000);
        expect(result.data.memoryLimit).toBe(10);
      }
    });

    it('should emit audit event on successful creation', async () => {
      const actor = createAdminActor('admin-1');
      const mockConfig = createMockRAGConfig({ authorId: 'admin-1' });
      vi.mocked(mockDb.createConfig).mockResolvedValue(mockConfig);

      await service.createConfig(actor, validParams);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'rag_config:create',
          resourceType: 'rag_config',
          resourceId: mockConfig.id,
        })
      );
    });

    it('should allow SYSTEM_ACTOR to create configs', async () => {
      const mockConfig = createMockRAGConfig({
        authorId: '00000000-0000-0000-0000-000000000001',
      });
      vi.mocked(mockDb.createConfig).mockResolvedValue(mockConfig);

      const result = await service.createConfig(SYSTEM_ACTOR, validParams);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getConfig
  // ─────────────────────────────────────────────────────────────

  describe('getConfig', () => {
    it('should return config when admin has rag:read permission', async () => {
      const actor = createAdminActor('admin-1');
      const mockConfig = createMockRAGConfig();
      vi.mocked(mockDb.getConfig).mockResolvedValue(mockConfig);

      const result = await service.getConfig(actor, 'rag-config-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('rag-config-123');
      }
    });

    it('should return active config to any user with rag:read', async () => {
      const actor = createUserActor('user-1', ['rag:read']);
      const mockConfig = createMockRAGConfig({ isActive: true });
      vi.mocked(mockDb.getConfig).mockResolvedValue(mockConfig);

      const result = await service.getConfig(actor, 'rag-config-123');

      expect(result.success).toBe(true);
    });

    it('should reject when config not found', async () => {
      const actor = createAdminActor('admin-1');
      vi.mocked(mockDb.getConfig).mockResolvedValue(null);

      const result = await service.getConfig(actor, 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getActiveConfig
  // ─────────────────────────────────────────────────────────────

  describe('getActiveConfig', () => {
    it('should return the active config', async () => {
      const actor = createUserActor('user-1', ['rag:read']);
      const mockConfig = createMockRAGConfig({ isActive: true });
      vi.mocked(mockDb.getActiveConfig).mockResolvedValue(mockConfig);

      const result = await service.getActiveConfig(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(true);
      }
    });

    it('should reject when no active config exists', async () => {
      const actor = createUserActor('user-1', ['rag:read']);
      vi.mocked(mockDb.getActiveConfig).mockResolvedValue(null);

      const result = await service.getActiveConfig(actor);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should be accessible to any user with rag:read', async () => {
      const actor = createUserActor('user-1', ['rag:read']);
      const mockConfig = createMockRAGConfig({ isActive: true });
      vi.mocked(mockDb.getActiveConfig).mockResolvedValue(mockConfig);

      const result = await service.getActiveConfig(actor);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // listConfigs
  // ─────────────────────────────────────────────────────────────

  describe('listConfigs', () => {
    it('should list configs for admin', async () => {
      const actor = createAdminActor('admin-1');
      const mockResult: PaginatedResult<RAGConfig> = {
        items: [createMockRAGConfig()],
        hasMore: false,
      };
      vi.mocked(mockDb.listConfigs).mockResolvedValue(mockResult);

      const result = await service.listConfigs(actor, { limit: 10 });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
      }
    });

    it('should filter by isActive', async () => {
      const actor = createAdminActor('admin-1');
      const mockResult: PaginatedResult<RAGConfig> = {
        items: [createMockRAGConfig({ isActive: true })],
        hasMore: false,
      };
      vi.mocked(mockDb.listConfigs).mockResolvedValue(mockResult);

      await service.listConfigs(actor, { isActive: true, limit: 10 });

      expect(mockDb.listConfigs).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true })
      );
    });

    it('should reject when user lacks rag:read permission', async () => {
      const actor = createUserActor('user-1', []);

      const result = await service.listConfigs(actor, { limit: 10 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // updateConfig
  // ─────────────────────────────────────────────────────────────

  describe('updateConfig', () => {
    const validUpdates: RAGConfigUpdate = {
      memoryLimit: 20,
      minSimilarity: 0.85,
    };

    it('should update config when admin has rag:write permission', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig();
      const updatedConfig = createMockRAGConfig({
        memoryLimit: 20,
        minSimilarity: 0.85,
      });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.updateConfig).mockResolvedValue(updatedConfig);

      const result = await service.updateConfig(
        actor,
        'rag-config-123',
        validUpdates
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.memoryLimit).toBe(20);
        expect(result.data.minSimilarity).toBe(0.85);
      }
    });

    it('should reject when user lacks rag:write permission', async () => {
      const actor = createUserActor('user-1', ['rag:read']);

      const result = await service.updateConfig(
        actor,
        'rag-config-123',
        validUpdates
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should reject when config not found', async () => {
      const actor = createAdminActor('admin-1');
      vi.mocked(mockDb.getConfig).mockResolvedValue(null);

      const result = await service.updateConfig(
        actor,
        'nonexistent',
        validUpdates
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should emit audit event on successful update', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig();
      const updatedConfig = createMockRAGConfig(validUpdates);
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.updateConfig).mockResolvedValue(updatedConfig);

      await service.updateConfig(actor, 'rag-config-123', validUpdates);

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'rag_config:update',
          resourceType: 'rag_config',
          resourceId: 'rag-config-123',
        })
      );
    });

    it('should validate reranking weights sum to approximately 1.0', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig();
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);

      const invalidUpdates: RAGConfigUpdate = {
        importanceWeight: 0.5,
        similarityWeight: 0.5,
        recencyWeight: 0.5, // Sum = 1.5, invalid
      };

      const result = await service.updateConfig(
        actor,
        'rag-config-123',
        invalidUpdates
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // activateConfig
  // ─────────────────────────────────────────────────────────────

  describe('activateConfig', () => {
    it('should activate config when admin has rag:activate permission', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig({ isActive: false });
      const activatedConfig = createMockRAGConfig({
        isActive: true,
        activatedAt: new Date(),
      });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.activateConfig).mockResolvedValue(activatedConfig);

      const result = await service.activateConfig(actor, 'rag-config-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(true);
        expect(result.data.activatedAt).not.toBeNull();
      }
    });

    it('should deactivate previous active config atomically', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig({ isActive: false });
      const activatedConfig = createMockRAGConfig({ isActive: true });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.activateConfig).mockResolvedValue(activatedConfig);

      await service.activateConfig(actor, 'rag-config-123');

      expect(mockDb.activateConfig).toHaveBeenCalledWith('rag-config-123');
    });

    it('should reject when user lacks rag:activate permission', async () => {
      const actor = createUserActor('user-1', ['rag:read', 'rag:write']);

      const result = await service.activateConfig(actor, 'rag-config-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should reject when config not found', async () => {
      const actor = createAdminActor('admin-1');
      vi.mocked(mockDb.getConfig).mockResolvedValue(null);

      const result = await service.activateConfig(actor, 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should emit audit event on activation', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig();
      const activatedConfig = createMockRAGConfig({ isActive: true });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.activateConfig).mockResolvedValue(activatedConfig);

      await service.activateConfig(actor, 'rag-config-123');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'rag_config:activate',
          resourceType: 'rag_config',
          resourceId: 'rag-config-123',
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // deactivateConfig
  // ─────────────────────────────────────────────────────────────

  describe('deactivateConfig', () => {
    it('should deactivate config when admin has rag:activate permission', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig({ isActive: true });
      const deactivatedConfig = createMockRAGConfig({ isActive: false });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.deactivateConfig).mockResolvedValue(deactivatedConfig);

      const result = await service.deactivateConfig(actor, 'rag-config-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(false);
      }
    });

    it('should reject when user lacks rag:activate permission', async () => {
      const actor = createUserActor('user-1', ['rag:read', 'rag:write']);

      const result = await service.deactivateConfig(actor, 'rag-config-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // deleteConfig
  // ─────────────────────────────────────────────────────────────

  describe('deleteConfig', () => {
    it('should delete inactive config when admin has rag:write permission', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig({ isActive: false });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.deleteConfig).mockResolvedValue(undefined);

      const result = await service.deleteConfig(actor, 'rag-config-123');

      expect(result.success).toBe(true);
    });

    it('should reject deletion of active config', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig({ isActive: true });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);

      const result = await service.deleteConfig(actor, 'rag-config-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should reject when user lacks rag:write permission', async () => {
      const actor = createUserActor('user-1', ['rag:read']);

      const result = await service.deleteConfig(actor, 'rag-config-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should emit audit event on deletion', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig({ isActive: false });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.deleteConfig).mockResolvedValue(undefined);

      await service.deleteConfig(actor, 'rag-config-123');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({
          action: 'rag_config:delete',
          resourceType: 'rag_config',
          resourceId: 'rag-config-123',
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Validation Tests
  // ─────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('should reject minSimilarity outside 0-1 range', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig();
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);

      const result = await service.updateConfig(actor, 'rag-config-123', {
        minSimilarity: 1.5,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject negative token budgets', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig();
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);

      const result = await service.updateConfig(actor, 'rag-config-123', {
        memoryTokenBudget: -100,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should reject memoryLimit below 1', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig();
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);

      const result = await service.updateConfig(actor, 'rag-config-123', {
        memoryLimit: 0,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should accept valid memory categories', async () => {
      const actor = createAdminActor('admin-1');
      const existingConfig = createMockRAGConfig();
      const updatedConfig = createMockRAGConfig({
        memoryCategories: ['preference', 'fact'],
      });
      vi.mocked(mockDb.getConfig).mockResolvedValue(existingConfig);
      vi.mocked(mockDb.updateConfig).mockResolvedValue(updatedConfig);

      const result = await service.updateConfig(actor, 'rag-config-123', {
        memoryCategories: ['preference', 'fact'],
      });

      expect(result.success).toBe(true);
    });
  });
});
