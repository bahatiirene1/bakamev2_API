/**
 * RAGConfigService Implementation
 * Phase 5: Config-driven RAG system
 *
 * Reference: docs/stage-4-ai-orchestrator.md Section 2.4
 *
 * SCOPE: Admin-configurable RAG settings
 *
 * Owns: rag_configs
 *
 * GUARDRAILS:
 * - createConfig requires 'rag:write' permission
 * - Active configs visible to anyone with 'rag:read'
 * - updateConfig requires 'rag:write' permission
 * - activateConfig/deactivateConfig require 'rag:activate' permission
 * - deleteConfig requires 'rag:write' and config must be inactive
 * - SYSTEM_ACTOR can perform any operation
 */

import type {
  ActorContext,
  Result,
  RAGConfig,
  CreateRAGConfigParams,
  RAGConfigUpdate,
  ListRAGConfigsParams,
  PaginationParams,
  PaginatedResult,
  AuditEvent,
} from '@/types/index.js';
import { success, failure, DEFAULT_RAG_CONFIG } from '@/types/index.js';

/**
 * Database interface for RAGConfigService
 */
export interface RAGConfigServiceDb {
  createConfig: (
    authorId: string,
    params: CreateRAGConfigParams
  ) => Promise<RAGConfig>;

  getConfig: (configId: string) => Promise<RAGConfig | null>;

  getActiveConfig: () => Promise<RAGConfig | null>;

  listConfigs: (
    params: ListRAGConfigsParams & PaginationParams
  ) => Promise<PaginatedResult<RAGConfig>>;

  updateConfig: (
    configId: string,
    updates: RAGConfigUpdate
  ) => Promise<RAGConfig>;

  activateConfig: (configId: string) => Promise<RAGConfig>;

  deactivateConfig: (configId: string) => Promise<RAGConfig>;

  deleteConfig: (configId: string) => Promise<void>;
}

/**
 * Minimal AuditService interface
 */
export interface RAGConfigServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * RAGConfigService interface
 */
export interface RAGConfigService {
  createConfig(
    actor: ActorContext,
    params: CreateRAGConfigParams
  ): Promise<Result<RAGConfig>>;

  getConfig(actor: ActorContext, configId: string): Promise<Result<RAGConfig>>;

  getActiveConfig(actor: ActorContext): Promise<Result<RAGConfig>>;

  listConfigs(
    actor: ActorContext,
    params: ListRAGConfigsParams & PaginationParams
  ): Promise<Result<PaginatedResult<RAGConfig>>>;

  updateConfig(
    actor: ActorContext,
    configId: string,
    updates: RAGConfigUpdate
  ): Promise<Result<RAGConfig>>;

  activateConfig(
    actor: ActorContext,
    configId: string
  ): Promise<Result<RAGConfig>>;

  deactivateConfig(
    actor: ActorContext,
    configId: string
  ): Promise<Result<RAGConfig>>;

  deleteConfig(actor: ActorContext, configId: string): Promise<Result<void>>;
}

/**
 * Check if actor has permission
 */
function hasPermission(actor: ActorContext, permission: string): boolean {
  // SYSTEM_ACTOR has all permissions
  if (actor.type === 'system') {
    return true;
  }
  // Admin with wildcard has all permissions
  if (actor.permissions.includes('*')) {
    return true;
  }
  return actor.permissions.includes(permission);
}

/**
 * Get actor's user ID
 */
function getActorUserId(actor: ActorContext): string {
  if (actor.type === 'system') {
    return '00000000-0000-0000-0000-000000000001'; // SYSTEM_ACTOR_ID
  }
  return actor.userId ?? '';
}

/**
 * Validate RAG config update
 */
function validateUpdate(
  updates: RAGConfigUpdate,
  existingConfig: RAGConfig
): { valid: boolean; error?: string } {
  // Validate minSimilarity range
  if (updates.minSimilarity !== undefined) {
    if (updates.minSimilarity < 0 || updates.minSimilarity > 1) {
      return { valid: false, error: 'minSimilarity must be between 0 and 1' };
    }
  }

  // Validate token budgets
  if (
    updates.memoryTokenBudget !== undefined &&
    updates.memoryTokenBudget < 0
  ) {
    return { valid: false, error: 'memoryTokenBudget must be non-negative' };
  }
  if (
    updates.knowledgeTokenBudget !== undefined &&
    updates.knowledgeTokenBudget < 0
  ) {
    return { valid: false, error: 'knowledgeTokenBudget must be non-negative' };
  }
  if (
    updates.conversationTokenBudget !== undefined &&
    updates.conversationTokenBudget < 0
  ) {
    return {
      valid: false,
      error: 'conversationTokenBudget must be non-negative',
    };
  }

  // Validate limits
  if (updates.memoryLimit !== undefined && updates.memoryLimit < 1) {
    return { valid: false, error: 'memoryLimit must be at least 1' };
  }
  if (updates.knowledgeLimit !== undefined && updates.knowledgeLimit < 1) {
    return { valid: false, error: 'knowledgeLimit must be at least 1' };
  }

  // Validate reranking weights sum (if any are being updated)
  if (
    updates.importanceWeight !== undefined ||
    updates.similarityWeight !== undefined ||
    updates.recencyWeight !== undefined
  ) {
    const importance =
      updates.importanceWeight ?? existingConfig.importanceWeight;
    const similarity =
      updates.similarityWeight ?? existingConfig.similarityWeight;
    const recency = updates.recencyWeight ?? existingConfig.recencyWeight;
    const sum = importance + similarity + recency;

    // Allow small floating point tolerance
    if (sum < 0.95 || sum > 1.05) {
      return {
        valid: false,
        error: `Reranking weights must sum to approximately 1.0 (got ${sum.toFixed(2)})`,
      };
    }
  }

  // Validate consolidation threshold
  if (updates.consolidationThreshold !== undefined) {
    if (
      updates.consolidationThreshold < 0.5 ||
      updates.consolidationThreshold > 1
    ) {
      return {
        valid: false,
        error: 'consolidationThreshold must be between 0.5 and 1',
      };
    }
  }

  return { valid: true };
}

/**
 * Validate create params
 */
function validateCreateParams(params: CreateRAGConfigParams): {
  valid: boolean;
  error?: string;
} {
  // Validate name
  if (!params.name || params.name.trim().length === 0) {
    return { valid: false, error: 'name is required' };
  }

  // Use defaults for validation
  const mockConfig: RAGConfig = {
    ...DEFAULT_RAG_CONFIG,
    id: '',
    name: params.name,
    authorId: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    activatedAt: null,
  };

  // Validate any provided values
  return validateUpdate(params as RAGConfigUpdate, mockConfig);
}

/**
 * Create RAGConfigService instance
 */
export function createRAGConfigService(deps: {
  db: RAGConfigServiceDb;
  auditService: RAGConfigServiceAudit;
}): RAGConfigService {
  const { db, auditService } = deps;

  return {
    async createConfig(
      actor: ActorContext,
      params: CreateRAGConfigParams
    ): Promise<Result<RAGConfig>> {
      // Check permission
      if (!hasPermission(actor, 'rag:write')) {
        return failure('PERMISSION_DENIED', 'Missing rag:write permission');
      }

      // Validate params
      const validation = validateCreateParams(params);
      if (!validation.valid) {
        return failure(
          'VALIDATION_ERROR',
          validation.error ?? 'Invalid parameters'
        );
      }

      try {
        const authorId = getActorUserId(actor);
        const config = await db.createConfig(authorId, params);

        // Emit audit event
        await auditService.log(actor, {
          action: 'rag_config:create',
          resourceType: 'rag_config',
          resourceId: config.id,
          details: { name: config.name },
        });

        return success(config);
      } catch (error) {
        return failure('INTERNAL_ERROR', 'Failed to create RAG config', {
          error,
        });
      }
    },

    async getConfig(
      actor: ActorContext,
      configId: string
    ): Promise<Result<RAGConfig>> {
      // Check permission
      if (!hasPermission(actor, 'rag:read')) {
        return failure('PERMISSION_DENIED', 'Missing rag:read permission');
      }

      try {
        const config = await db.getConfig(configId);

        if (!config) {
          return failure('NOT_FOUND', 'RAG config not found');
        }

        return success(config);
      } catch (error) {
        return failure('INTERNAL_ERROR', 'Failed to get RAG config', { error });
      }
    },

    async getActiveConfig(actor: ActorContext): Promise<Result<RAGConfig>> {
      // Check permission
      if (!hasPermission(actor, 'rag:read')) {
        return failure('PERMISSION_DENIED', 'Missing rag:read permission');
      }

      try {
        const config = await db.getActiveConfig();

        if (!config) {
          return failure('NOT_FOUND', 'No active RAG config found');
        }

        return success(config);
      } catch (error) {
        return failure('INTERNAL_ERROR', 'Failed to get active RAG config', {
          error,
        });
      }
    },

    async listConfigs(
      actor: ActorContext,
      params: ListRAGConfigsParams & PaginationParams
    ): Promise<Result<PaginatedResult<RAGConfig>>> {
      // Check permission
      if (!hasPermission(actor, 'rag:read')) {
        return failure('PERMISSION_DENIED', 'Missing rag:read permission');
      }

      try {
        const result = await db.listConfigs(params);
        return success(result);
      } catch (error) {
        return failure('INTERNAL_ERROR', 'Failed to list RAG configs', {
          error,
        });
      }
    },

    async updateConfig(
      actor: ActorContext,
      configId: string,
      updates: RAGConfigUpdate
    ): Promise<Result<RAGConfig>> {
      // Check permission
      if (!hasPermission(actor, 'rag:write')) {
        return failure('PERMISSION_DENIED', 'Missing rag:write permission');
      }

      try {
        // Get existing config
        const existing = await db.getConfig(configId);
        if (!existing) {
          return failure('NOT_FOUND', 'RAG config not found');
        }

        // Validate updates
        const validation = validateUpdate(updates, existing);
        if (!validation.valid) {
          return failure(
            'VALIDATION_ERROR',
            validation.error ?? 'Invalid parameters'
          );
        }

        const updated = await db.updateConfig(configId, updates);

        // Emit audit event
        await auditService.log(actor, {
          action: 'rag_config:update',
          resourceType: 'rag_config',
          resourceId: configId,
          details: { updates },
        });

        return success(updated);
      } catch (error) {
        return failure('INTERNAL_ERROR', 'Failed to update RAG config', {
          error,
        });
      }
    },

    async activateConfig(
      actor: ActorContext,
      configId: string
    ): Promise<Result<RAGConfig>> {
      // Check permission
      if (!hasPermission(actor, 'rag:activate')) {
        return failure('PERMISSION_DENIED', 'Missing rag:activate permission');
      }

      try {
        // Check config exists
        const existing = await db.getConfig(configId);
        if (!existing) {
          return failure('NOT_FOUND', 'RAG config not found');
        }

        // Activate (this atomically deactivates any other active config)
        const activated = await db.activateConfig(configId);

        // Emit audit event
        await auditService.log(actor, {
          action: 'rag_config:activate',
          resourceType: 'rag_config',
          resourceId: configId,
          details: { name: activated.name },
        });

        return success(activated);
      } catch (error) {
        return failure('INTERNAL_ERROR', 'Failed to activate RAG config', {
          error,
        });
      }
    },

    async deactivateConfig(
      actor: ActorContext,
      configId: string
    ): Promise<Result<RAGConfig>> {
      // Check permission
      if (!hasPermission(actor, 'rag:activate')) {
        return failure('PERMISSION_DENIED', 'Missing rag:activate permission');
      }

      try {
        // Check config exists
        const existing = await db.getConfig(configId);
        if (!existing) {
          return failure('NOT_FOUND', 'RAG config not found');
        }

        const deactivated = await db.deactivateConfig(configId);

        // Emit audit event
        await auditService.log(actor, {
          action: 'rag_config:deactivate',
          resourceType: 'rag_config',
          resourceId: configId,
          details: { name: deactivated.name },
        });

        return success(deactivated);
      } catch (error) {
        return failure('INTERNAL_ERROR', 'Failed to deactivate RAG config', {
          error,
        });
      }
    },

    async deleteConfig(
      actor: ActorContext,
      configId: string
    ): Promise<Result<void>> {
      // Check permission
      if (!hasPermission(actor, 'rag:write')) {
        return failure('PERMISSION_DENIED', 'Missing rag:write permission');
      }

      try {
        // Check config exists
        const existing = await db.getConfig(configId);
        if (!existing) {
          return failure('NOT_FOUND', 'RAG config not found');
        }

        // Cannot delete active config
        if (existing.isActive) {
          return failure(
            'INVALID_STATE',
            'Cannot delete active config. Deactivate it first.'
          );
        }

        await db.deleteConfig(configId);

        // Emit audit event
        await auditService.log(actor, {
          action: 'rag_config:delete',
          resourceType: 'rag_config',
          resourceId: configId,
          details: { name: existing.name },
        });

        return success(undefined);
      } catch (error) {
        return failure('INTERNAL_ERROR', 'Failed to delete RAG config', {
          error,
        });
      }
    },
  };
}
