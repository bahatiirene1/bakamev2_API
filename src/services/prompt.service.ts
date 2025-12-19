/**
 * PromptService Implementation
 * Phase 2: TDD - System prompt governance
 *
 * Reference: docs/stage-2-service-layer.md Section 3.6
 *
 * SCOPE: System prompt governance
 *
 * Owns: system_prompts
 *
 * GUARDRAILS:
 * - createPrompt requires 'prompt:write' permission
 * - Active prompts visible to anyone with 'prompt:read'
 * - Draft prompts visible only to author or admin
 * - submitForReview requires author ownership
 * - approvePrompt/rejectPrompt require 'prompt:review' permission
 * - activatePrompt/deprecatePrompt require 'prompt:activate' permission
 * - AI_ACTOR can create drafts and submit for review, but cannot approve/reject/activate/deprecate
 * - SYSTEM_ACTOR can perform any operation
 * - Self-approval is prohibited
 *
 * Workflow: draft → pending_review → approved → active → deprecated
 */

import type {
  ActorContext,
  Result,
  SystemPrompt,
  CreatePromptParams,
  PromptUpdate,
  ListPromptsParams,
  PaginationParams,
  PaginatedResult,
  AuditEvent,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Prompt version entry
 */
export interface PromptVersion {
  version: number;
  name: string;
  content: string;
  authorId: string;
  createdAt: Date;
}

/**
 * Database interface for PromptService
 */
export interface PromptServiceDb {
  createPrompt: (
    authorId: string,
    params: CreatePromptParams
  ) => Promise<SystemPrompt>;

  getPrompt: (promptId: string) => Promise<SystemPrompt | null>;

  getActivePrompt: () => Promise<SystemPrompt | null>;

  listPrompts: (
    params: ListPromptsParams & PaginationParams
  ) => Promise<PaginatedResult<SystemPrompt>>;

  updatePrompt: (
    promptId: string,
    updates: PromptUpdate
  ) => Promise<SystemPrompt>;

  updatePromptStatus: (
    promptId: string,
    status: SystemPrompt['status'],
    reviewerId?: string | null
  ) => Promise<SystemPrompt>;

  activatePrompt: (promptId: string) => Promise<SystemPrompt>;

  getPromptVersionHistory: (promptId: string) => Promise<PromptVersion[]>;

  createVersion: (
    promptId: string,
    version: Omit<PromptVersion, 'createdAt'>
  ) => Promise<PromptVersion>;
}

/**
 * Minimal AuditService interface
 */
export interface PromptServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * PromptService interface
 */
export interface PromptService {
  createPrompt(
    actor: ActorContext,
    params: CreatePromptParams
  ): Promise<Result<SystemPrompt>>;

  getPrompt(
    actor: ActorContext,
    promptId: string
  ): Promise<Result<SystemPrompt>>;

  getActivePrompt(actor: ActorContext): Promise<Result<SystemPrompt>>;

  listPrompts(
    actor: ActorContext,
    params: ListPromptsParams & PaginationParams
  ): Promise<Result<PaginatedResult<SystemPrompt>>>;

  updatePrompt(
    actor: ActorContext,
    promptId: string,
    updates: PromptUpdate
  ): Promise<Result<SystemPrompt>>;

  submitForReview(actor: ActorContext, promptId: string): Promise<Result<void>>;

  approvePrompt(
    actor: ActorContext,
    promptId: string,
    notes?: string
  ): Promise<Result<void>>;

  rejectPrompt(
    actor: ActorContext,
    promptId: string,
    reason: string
  ): Promise<Result<void>>;

  activatePrompt(actor: ActorContext, promptId: string): Promise<Result<void>>;

  deprecatePrompt(
    actor: ActorContext,
    promptId: string,
    reason: string
  ): Promise<Result<void>>;

  getVersionHistory(
    actor: ActorContext,
    promptId: string
  ): Promise<Result<PromptVersion[]>>;
}

/**
 * Create PromptService instance
 */
export function createPromptService(deps: {
  db: PromptServiceDb;
  auditService: PromptServiceAudit;
}): PromptService {
  const { db, auditService } = deps;

  // ─────────────────────────────────────────────────────────────
  // HELPER FUNCTIONS
  // ─────────────────────────────────────────────────────────────

  function isSystemActor(actor: ActorContext): boolean {
    return actor.type === 'system';
  }

  function isAiActor(actor: ActorContext): boolean {
    return actor.type === 'ai';
  }

  function hasPermission(actor: ActorContext, permission: string): boolean {
    if (isSystemActor(actor)) {
      return true;
    }
    if (isAiActor(actor)) {
      // AI has implicit read permission
      if (permission === 'prompt:read') {
        return true;
      }
      // AI has implicit write permission for drafts
      if (permission === 'prompt:write') {
        return true;
      }
      return false;
    }
    return (
      actor.permissions.includes(permission) || actor.permissions.includes('*')
    );
  }

  function getActorUserId(actor: ActorContext): string {
    if (isSystemActor(actor)) {
      return 'system';
    }
    if (isAiActor(actor)) {
      return 'ai';
    }
    return actor.userId ?? 'unknown';
  }

  function canViewPrompt(actor: ActorContext, prompt: SystemPrompt): boolean {
    // SYSTEM_ACTOR can view any prompt
    if (isSystemActor(actor)) {
      return true;
    }

    // Active and approved prompts visible to anyone with prompt:read (including AI)
    if (prompt.status === 'active' || prompt.status === 'approved') {
      return hasPermission(actor, 'prompt:read');
    }

    // AI_ACTOR cannot view drafts or pending_review (except its own)
    if (isAiActor(actor)) {
      return prompt.authorId === 'ai';
    }

    // Author can view their own prompts
    if (prompt.authorId === getActorUserId(actor)) {
      return true;
    }

    // Admin can view any prompt
    if (actor.type === 'admin') {
      return true;
    }

    // Reviewers can view any prompt
    if (hasPermission(actor, 'prompt:review')) {
      return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // SERVICE IMPLEMENTATION
  // ─────────────────────────────────────────────────────────────

  return {
    async createPrompt(
      actor: ActorContext,
      params: CreatePromptParams
    ): Promise<Result<SystemPrompt>> {
      // Requires prompt:write permission
      if (!hasPermission(actor, 'prompt:write')) {
        return failure('PERMISSION_DENIED', 'Missing prompt:write permission');
      }

      const authorId = getActorUserId(actor);
      const prompt = await db.createPrompt(authorId, params);

      // Audit log
      await auditService.log(actor, {
        action: 'prompt.create',
        resourceType: 'system_prompt',
        resourceId: prompt.id,
        details: { name: prompt.name },
      });

      return success(prompt);
    },

    async getPrompt(
      actor: ActorContext,
      promptId: string
    ): Promise<Result<SystemPrompt>> {
      // Check basic read permission first
      if (!hasPermission(actor, 'prompt:read')) {
        return failure('PERMISSION_DENIED', 'Missing prompt:read permission');
      }

      const prompt = await db.getPrompt(promptId);
      if (prompt === null) {
        return failure('NOT_FOUND', `Prompt not found: ${promptId}`);
      }

      if (!canViewPrompt(actor, prompt)) {
        return failure('PERMISSION_DENIED', 'Cannot view this prompt');
      }

      return success(prompt);
    },

    async getActivePrompt(actor: ActorContext): Promise<Result<SystemPrompt>> {
      // AI and SYSTEM can always get active prompt (for context building)
      if (!isSystemActor(actor) && !isAiActor(actor)) {
        if (!hasPermission(actor, 'prompt:read')) {
          return failure('PERMISSION_DENIED', 'Missing prompt:read permission');
        }
      }

      const prompt = await db.getActivePrompt();
      if (prompt === null) {
        return failure('NOT_FOUND', 'No active prompt found');
      }

      return success(prompt);
    },

    async listPrompts(
      actor: ActorContext,
      params: ListPromptsParams & PaginationParams
    ): Promise<Result<PaginatedResult<SystemPrompt>>> {
      // Requires prompt:read permission
      if (!hasPermission(actor, 'prompt:read')) {
        return failure('PERMISSION_DENIED', 'Missing prompt:read permission');
      }

      const result = await db.listPrompts(params);
      return success(result);
    },

    async updatePrompt(
      actor: ActorContext,
      promptId: string,
      updates: PromptUpdate
    ): Promise<Result<SystemPrompt>> {
      // Requires prompt:write permission
      if (!hasPermission(actor, 'prompt:write')) {
        return failure('PERMISSION_DENIED', 'Missing prompt:write permission');
      }

      const prompt = await db.getPrompt(promptId);
      if (prompt === null) {
        return failure('NOT_FOUND', `Prompt not found: ${promptId}`);
      }

      // Only draft prompts can be updated
      if (prompt.status !== 'draft') {
        return failure(
          'INVALID_STATE',
          `Cannot update prompt in ${prompt.status} status`
        );
      }

      // Check permission: author or admin
      const actorUserId = getActorUserId(actor);
      const isAuthor = prompt.authorId === actorUserId;
      const isAdmin = actor.type === 'admin';

      if (!isSystemActor(actor) && !isAuthor && !isAdmin) {
        return failure(
          'PERMISSION_DENIED',
          'Only author or admin can update this prompt'
        );
      }

      // Create version if content is being updated
      if (updates.content !== undefined) {
        await db.createVersion(promptId, {
          version: prompt.version + 1,
          name: updates.name ?? prompt.name,
          content: updates.content,
          authorId: actorUserId,
        });
      }

      const updatedPrompt = await db.updatePrompt(promptId, updates);

      // Audit log
      await auditService.log(actor, {
        action: 'prompt.update',
        resourceType: 'system_prompt',
        resourceId: promptId,
        details: { updates: Object.keys(updates) },
      });

      return success(updatedPrompt);
    },

    async submitForReview(
      actor: ActorContext,
      promptId: string
    ): Promise<Result<void>> {
      const prompt = await db.getPrompt(promptId);
      if (prompt === null) {
        return failure('NOT_FOUND', `Prompt not found: ${promptId}`);
      }

      // Only draft prompts can be submitted
      if (prompt.status !== 'draft') {
        return failure(
          'INVALID_STATE',
          `Cannot submit prompt in ${prompt.status} status`
        );
      }

      // Only author can submit (or SYSTEM_ACTOR)
      const actorUserId = getActorUserId(actor);
      if (!isSystemActor(actor) && prompt.authorId !== actorUserId) {
        return failure(
          'PERMISSION_DENIED',
          'Only the author can submit for review'
        );
      }

      // Update status
      await db.updatePromptStatus(promptId, 'pending_review', undefined);

      // Audit log
      await auditService.log(actor, {
        action: 'prompt.submit_for_review',
        resourceType: 'system_prompt',
        resourceId: promptId,
        details: {},
      });

      return success(undefined);
    },

    async approvePrompt(
      actor: ActorContext,
      promptId: string,
      _notes?: string
    ): Promise<Result<void>> {
      // AI cannot approve prompts (governance is human-only)
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot approve prompts');
      }

      // Requires prompt:review permission
      if (!hasPermission(actor, 'prompt:review')) {
        return failure('PERMISSION_DENIED', 'Missing prompt:review permission');
      }

      const prompt = await db.getPrompt(promptId);
      if (prompt === null) {
        return failure('NOT_FOUND', `Prompt not found: ${promptId}`);
      }

      // Only pending_review prompts can be approved
      if (prompt.status !== 'pending_review') {
        return failure(
          'INVALID_STATE',
          `Cannot approve prompt in ${prompt.status} status`
        );
      }

      // Self-approval is prohibited
      const actorUserId = getActorUserId(actor);
      if (prompt.authorId === actorUserId) {
        return failure('PERMISSION_DENIED', 'Cannot approve your own prompt');
      }

      // Update status
      await db.updatePromptStatus(promptId, 'approved', actorUserId);

      // Audit log
      await auditService.log(actor, {
        action: 'prompt.approve',
        resourceType: 'system_prompt',
        resourceId: promptId,
        details: {},
      });

      return success(undefined);
    },

    async rejectPrompt(
      actor: ActorContext,
      promptId: string,
      reason: string
    ): Promise<Result<void>> {
      // AI cannot reject prompts (governance is human-only)
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot reject prompts');
      }

      // Requires prompt:review permission
      if (!hasPermission(actor, 'prompt:review')) {
        return failure('PERMISSION_DENIED', 'Missing prompt:review permission');
      }

      // Reason is required
      if (reason.trim() === '') {
        return failure('VALIDATION_ERROR', 'Reason is required');
      }

      const prompt = await db.getPrompt(promptId);
      if (prompt === null) {
        return failure('NOT_FOUND', `Prompt not found: ${promptId}`);
      }

      // Only pending_review prompts can be rejected
      if (prompt.status !== 'pending_review') {
        return failure(
          'INVALID_STATE',
          `Cannot reject prompt in ${prompt.status} status`
        );
      }

      // Update status back to draft
      const reviewerId = getActorUserId(actor);
      await db.updatePromptStatus(promptId, 'draft', reviewerId);

      // Audit log
      await auditService.log(actor, {
        action: 'prompt.reject',
        resourceType: 'system_prompt',
        resourceId: promptId,
        details: { reason },
      });

      return success(undefined);
    },

    async activatePrompt(
      actor: ActorContext,
      promptId: string
    ): Promise<Result<void>> {
      // AI cannot activate prompts (governance is human-only)
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot activate prompts');
      }

      // Requires prompt:activate permission
      if (!hasPermission(actor, 'prompt:activate')) {
        return failure(
          'PERMISSION_DENIED',
          'Missing prompt:activate permission'
        );
      }

      const prompt = await db.getPrompt(promptId);
      if (prompt === null) {
        return failure('NOT_FOUND', `Prompt not found: ${promptId}`);
      }

      // Only approved prompts can be activated
      if (prompt.status !== 'approved') {
        return failure(
          'INVALID_STATE',
          `Cannot activate prompt in ${prompt.status} status`
        );
      }

      // Activate prompt (db adapter handles atomic deactivation of previous)
      await db.activatePrompt(promptId);

      // Audit log
      await auditService.log(actor, {
        action: 'prompt.activate',
        resourceType: 'system_prompt',
        resourceId: promptId,
        details: {},
      });

      return success(undefined);
    },

    async deprecatePrompt(
      actor: ActorContext,
      promptId: string,
      reason: string
    ): Promise<Result<void>> {
      // AI cannot deprecate prompts (governance is human-only)
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot deprecate prompts');
      }

      // Requires prompt:activate permission
      if (!hasPermission(actor, 'prompt:activate')) {
        return failure(
          'PERMISSION_DENIED',
          'Missing prompt:activate permission'
        );
      }

      // Reason is required
      if (reason.trim() === '') {
        return failure('VALIDATION_ERROR', 'Reason is required');
      }

      const prompt = await db.getPrompt(promptId);
      if (prompt === null) {
        return failure('NOT_FOUND', `Prompt not found: ${promptId}`);
      }

      // Cannot deprecate draft prompts
      if (prompt.status === 'draft') {
        return failure('INVALID_STATE', 'Cannot deprecate draft prompt');
      }

      // Cannot deprecate the default prompt
      if (prompt.isDefault) {
        return failure('INVALID_STATE', 'Cannot deprecate the default prompt');
      }

      // Update status
      await db.updatePromptStatus(promptId, 'deprecated', undefined);

      // Audit log
      await auditService.log(actor, {
        action: 'prompt.deprecate',
        resourceType: 'system_prompt',
        resourceId: promptId,
        details: { reason },
      });

      return success(undefined);
    },

    async getVersionHistory(
      actor: ActorContext,
      promptId: string
    ): Promise<Result<PromptVersion[]>> {
      // Requires prompt:read permission
      if (!hasPermission(actor, 'prompt:read')) {
        return failure('PERMISSION_DENIED', 'Missing prompt:read permission');
      }

      const prompt = await db.getPrompt(promptId);
      if (prompt === null) {
        return failure('NOT_FOUND', `Prompt not found: ${promptId}`);
      }

      const versions = await db.getPromptVersionHistory(promptId);
      return success(versions);
    },
  };
}
