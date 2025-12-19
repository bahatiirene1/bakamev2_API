/**
 * KnowledgeService Implementation
 * Phase 2: TDD - RED phase (stub only)
 *
 * Reference: docs/stage-2-service-layer.md Section 3.5
 *
 * SCOPE: RAG knowledge base management with governance
 *
 * Owns: knowledge_items, knowledge_vectors
 *
 * GUARDRAILS:
 * - createKnowledgeItem requires 'knowledge:write' permission
 * - Published items visible to anyone with 'knowledge:read'
 * - Draft items visible only to author or 'knowledge:review' permission
 * - submitForReview requires author ownership
 * - approveItem/rejectItem require 'knowledge:review' permission
 * - publishItem requires 'knowledge:publish' permission
 * - AI_ACTOR cannot approve/reject/publish (governance is human-only)
 * - SYSTEM_ACTOR can perform any operation
 *
 * Dependencies: AuditService, ApprovalService
 */

import type {
  ActorContext,
  KnowledgeItem,
  CreateKnowledgeItemParams,
  KnowledgeItemUpdate,
  ListKnowledgeItemsParams,
  KnowledgeSearchResult,
  KnowledgeVersion,
  SearchKnowledgeParams,
  PaginationParams,
  PaginatedResult,
  Result,
  AuditEvent,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Database abstraction interface for KnowledgeService
 */
export interface KnowledgeServiceDb {
  createItem: (
    authorId: string,
    params: CreateKnowledgeItemParams
  ) => Promise<KnowledgeItem>;
  getItem: (itemId: string) => Promise<KnowledgeItem | null>;
  listItems: (
    params: ListKnowledgeItemsParams & PaginationParams
  ) => Promise<PaginatedResult<KnowledgeItem>>;
  updateItem: (
    itemId: string,
    updates: KnowledgeItemUpdate
  ) => Promise<KnowledgeItem>;
  updateItemStatus: (
    itemId: string,
    status: KnowledgeItem['status'],
    reviewerId?: string | null
  ) => Promise<KnowledgeItem>;
  publishItem: (itemId: string) => Promise<KnowledgeItem>;
  createVersion: (
    itemId: string,
    version: Omit<KnowledgeVersion, 'createdAt'>
  ) => Promise<KnowledgeVersion>;
  getVersionHistory: (itemId: string) => Promise<KnowledgeVersion[]>;
  searchItems: (
    params: SearchKnowledgeParams
  ) => Promise<KnowledgeSearchResult[]>;
}

/**
 * Minimal AuditService interface
 */
export interface KnowledgeServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * Minimal ApprovalService interface
 */
export interface KnowledgeServiceApproval {
  createRequest: (
    actor: ActorContext,
    params: {
      resourceType: 'knowledge_item' | 'system_prompt';
      resourceId: string;
      action: 'publish' | 'activate' | 'deprecate';
      notes?: string;
    }
  ) => Promise<Result<{ id: string }>>;
}

/**
 * KnowledgeService interface
 */
export interface KnowledgeService {
  // Knowledge lifecycle
  createKnowledgeItem(
    actor: ActorContext,
    params: CreateKnowledgeItemParams
  ): Promise<Result<KnowledgeItem>>;
  getKnowledgeItem(
    actor: ActorContext,
    itemId: string
  ): Promise<Result<KnowledgeItem>>;
  listKnowledgeItems(
    actor: ActorContext,
    params: ListKnowledgeItemsParams & PaginationParams
  ): Promise<Result<PaginatedResult<KnowledgeItem>>>;
  updateKnowledgeItem(
    actor: ActorContext,
    itemId: string,
    updates: KnowledgeItemUpdate
  ): Promise<Result<KnowledgeItem>>;

  // Governance workflow
  submitForReview(
    actor: ActorContext,
    itemId: string,
    notes?: string
  ): Promise<Result<void>>;
  approveItem(
    actor: ActorContext,
    itemId: string,
    notes?: string
  ): Promise<Result<void>>;
  rejectItem(
    actor: ActorContext,
    itemId: string,
    reason: string
  ): Promise<Result<void>>;
  publishItem(actor: ActorContext, itemId: string): Promise<Result<void>>;
  archiveItem(
    actor: ActorContext,
    itemId: string,
    reason: string
  ): Promise<Result<void>>;

  // Semantic search (for RAG)
  searchKnowledge(
    actor: ActorContext,
    params: SearchKnowledgeParams
  ): Promise<Result<KnowledgeSearchResult[]>>;

  // Version history
  getVersionHistory(
    actor: ActorContext,
    itemId: string
  ): Promise<Result<KnowledgeVersion[]>>;
}

/**
 * Create KnowledgeService instance
 */
export function createKnowledgeService(deps: {
  db: KnowledgeServiceDb;
  auditService: KnowledgeServiceAudit;
  approvalService: KnowledgeServiceApproval;
}): KnowledgeService {
  const { db, auditService, approvalService } = deps;

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
    // Check for specific permission, wildcard, or admin prefix
    return (
      actor.permissions.includes(permission) ||
      actor.permissions.includes('*') ||
      actor.permissions.some((p) => p.startsWith('admin:'))
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

  function canViewItem(actor: ActorContext, item: KnowledgeItem): boolean {
    // SYSTEM_ACTOR can view any item
    if (isSystemActor(actor)) {
      return true;
    }

    // Published items visible to anyone with knowledge:read (including AI for RAG)
    if (item.status === 'published') {
      return hasPermission(actor, 'knowledge:read') || isAiActor(actor);
    }

    // AI_ACTOR cannot view non-published items
    if (isAiActor(actor)) {
      return false;
    }

    // Author can view their own items
    if (item.authorId === getActorUserId(actor)) {
      return true;
    }

    // Reviewers can view any item
    if (hasPermission(actor, 'knowledge:review')) {
      return true;
    }

    return false;
  }

  function isItemEditable(item: KnowledgeItem): boolean {
    // Only draft and pending_review items can be edited
    return item.status === 'draft' || item.status === 'pending_review';
  }

  // ─────────────────────────────────────────────────────────────
  // SERVICE IMPLEMENTATION
  // ─────────────────────────────────────────────────────────────

  return {
    async createKnowledgeItem(
      actor: ActorContext,
      params: CreateKnowledgeItemParams
    ): Promise<Result<KnowledgeItem>> {
      // AI_ACTOR cannot create items
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot create knowledge items');
      }

      // Requires knowledge:write permission
      if (!hasPermission(actor, 'knowledge:write')) {
        return failure(
          'PERMISSION_DENIED',
          'Missing knowledge:write permission'
        );
      }

      const authorId = getActorUserId(actor);
      const item = await db.createItem(authorId, params);

      // Audit log
      await auditService.log(actor, {
        action: 'knowledge.create',
        resourceType: 'knowledge_item',
        resourceId: item.id,
        details: { title: item.title },
      });

      return success(item);
    },

    async getKnowledgeItem(
      actor: ActorContext,
      itemId: string
    ): Promise<Result<KnowledgeItem>> {
      const item = await db.getItem(itemId);
      if (item === null) {
        return failure('NOT_FOUND', `Knowledge item not found: ${itemId}`);
      }

      if (!canViewItem(actor, item)) {
        return failure('PERMISSION_DENIED', 'Cannot view this knowledge item');
      }

      return success(item);
    },

    async listKnowledgeItems(
      _actor: ActorContext,
      params: ListKnowledgeItemsParams & PaginationParams
    ): Promise<Result<PaginatedResult<KnowledgeItem>>> {
      const result = await db.listItems(params);
      return success(result);
    },

    async updateKnowledgeItem(
      actor: ActorContext,
      itemId: string,
      updates: KnowledgeItemUpdate
    ): Promise<Result<KnowledgeItem>> {
      // AI_ACTOR cannot update items
      if (isAiActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot update knowledge items');
      }

      const item = await db.getItem(itemId);
      if (item === null) {
        return failure('NOT_FOUND', `Knowledge item not found: ${itemId}`);
      }

      // Check item is editable
      if (!isItemEditable(item)) {
        return failure(
          'INVALID_STATE',
          `Cannot update item in ${item.status} status`
        );
      }

      // Check permission: author or admin
      const actorUserId = getActorUserId(actor);
      const isAuthor = item.authorId === actorUserId;
      const isAdmin =
        actor.type === 'admin' || hasPermission(actor, 'knowledge:review');

      if (!isSystemActor(actor) && !isAuthor && !isAdmin) {
        return failure(
          'PERMISSION_DENIED',
          'Only author or admin can update this item'
        );
      }

      // Create version if content is being updated
      if (updates.content !== undefined) {
        await db.createVersion(itemId, {
          version: item.version + 1,
          title: updates.title ?? item.title,
          content: updates.content,
          authorId: actorUserId,
        });
      }

      const updatedItem = await db.updateItem(itemId, updates);

      // Audit log
      await auditService.log(actor, {
        action: 'knowledge.update',
        resourceType: 'knowledge_item',
        resourceId: itemId,
        details: { updates: Object.keys(updates) },
      });

      return success(updatedItem);
    },

    async submitForReview(
      actor: ActorContext,
      itemId: string,
      notes?: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot submit for review
      if (isAiActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'AI cannot submit items for review'
        );
      }

      const item = await db.getItem(itemId);
      if (item === null) {
        return failure('NOT_FOUND', `Knowledge item not found: ${itemId}`);
      }

      // Only draft items can be submitted
      if (item.status !== 'draft') {
        return failure(
          'INVALID_STATE',
          `Cannot submit item in ${item.status} status`
        );
      }

      // Only author can submit (or SYSTEM_ACTOR)
      const actorUserId = getActorUserId(actor);
      if (!isSystemActor(actor) && item.authorId !== actorUserId) {
        return failure(
          'PERMISSION_DENIED',
          'Only the author can submit for review'
        );
      }

      // Update status
      await db.updateItemStatus(itemId, 'pending_review', undefined);

      // Create approval request
      const approvalParams: Parameters<
        typeof approvalService.createRequest
      >[1] = {
        resourceType: 'knowledge_item',
        resourceId: itemId,
        action: 'publish',
      };
      if (notes !== undefined) {
        approvalParams.notes = notes;
      }
      await approvalService.createRequest(actor, approvalParams);

      // Audit log
      await auditService.log(actor, {
        action: 'knowledge.submit_review',
        resourceType: 'knowledge_item',
        resourceId: itemId,
        details: { notes },
      });

      return success(undefined);
    },

    async approveItem(
      actor: ActorContext,
      itemId: string,
      notes?: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot approve (governance is human-only)
      if (isAiActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Governance actions require human approval'
        );
      }

      // Requires knowledge:review permission
      if (!hasPermission(actor, 'knowledge:review')) {
        return failure(
          'PERMISSION_DENIED',
          'Missing knowledge:review permission'
        );
      }

      const item = await db.getItem(itemId);
      if (item === null) {
        return failure('NOT_FOUND', `Knowledge item not found: ${itemId}`);
      }

      // Only pending_review items can be approved
      if (item.status !== 'pending_review') {
        return failure(
          'INVALID_STATE',
          `Cannot approve item in ${item.status} status`
        );
      }

      // Self-approval is not allowed (except SYSTEM_ACTOR)
      const actorUserId = getActorUserId(actor);
      if (!isSystemActor(actor) && item.authorId === actorUserId) {
        return failure('PERMISSION_DENIED', 'Cannot approve your own item');
      }

      // Update status with reviewer
      await db.updateItemStatus(itemId, 'approved', actorUserId);

      // Audit log
      await auditService.log(actor, {
        action: 'knowledge.approve',
        resourceType: 'knowledge_item',
        resourceId: itemId,
        details: { notes },
      });

      return success(undefined);
    },

    async rejectItem(
      actor: ActorContext,
      itemId: string,
      reason: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot reject (governance is human-only)
      if (isAiActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Governance actions require human approval'
        );
      }

      // Requires knowledge:review permission
      if (!hasPermission(actor, 'knowledge:review')) {
        return failure(
          'PERMISSION_DENIED',
          'Missing knowledge:review permission'
        );
      }

      const item = await db.getItem(itemId);
      if (item === null) {
        return failure('NOT_FOUND', `Knowledge item not found: ${itemId}`);
      }

      // Only pending_review items can be rejected
      if (item.status !== 'pending_review') {
        return failure(
          'INVALID_STATE',
          `Cannot reject item in ${item.status} status`
        );
      }

      // Reset to draft, clear reviewer
      await db.updateItemStatus(itemId, 'draft', null);

      // Audit log
      await auditService.log(actor, {
        action: 'knowledge.reject',
        resourceType: 'knowledge_item',
        resourceId: itemId,
        details: { reason },
      });

      return success(undefined);
    },

    async publishItem(
      actor: ActorContext,
      itemId: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot publish (governance is human-only)
      if (isAiActor(actor)) {
        return failure(
          'PERMISSION_DENIED',
          'Governance actions require human approval'
        );
      }

      // Requires knowledge:publish permission
      if (!hasPermission(actor, 'knowledge:publish')) {
        return failure(
          'PERMISSION_DENIED',
          'Missing knowledge:publish permission'
        );
      }

      const item = await db.getItem(itemId);
      if (item === null) {
        return failure('NOT_FOUND', `Knowledge item not found: ${itemId}`);
      }

      // Only approved items can be published
      if (item.status !== 'approved') {
        return failure(
          'INVALID_STATE',
          `Cannot publish item in ${item.status} status (must be approved first)`
        );
      }

      // Publish the item
      await db.publishItem(itemId);

      // Audit log
      await auditService.log(actor, {
        action: 'knowledge.publish',
        resourceType: 'knowledge_item',
        resourceId: itemId,
        details: {},
      });

      return success(undefined);
    },

    async archiveItem(
      actor: ActorContext,
      itemId: string,
      reason: string
    ): Promise<Result<void>> {
      const item = await db.getItem(itemId);
      if (item === null) {
        return failure('NOT_FOUND', `Knowledge item not found: ${itemId}`);
      }

      // Cannot archive already archived items
      if (item.status === 'archived') {
        return failure('INVALID_STATE', 'Item is already archived');
      }

      // Check permission: author, admin, or SYSTEM_ACTOR
      const actorUserId = getActorUserId(actor);
      const isAuthor = item.authorId === actorUserId;
      const isAdmin =
        actor.type === 'admin' || hasPermission(actor, 'knowledge:review');

      if (!isSystemActor(actor) && !isAuthor && !isAdmin) {
        return failure(
          'PERMISSION_DENIED',
          'Only author or admin can archive this item'
        );
      }

      // Archive the item
      await db.updateItemStatus(itemId, 'archived', undefined);

      // Audit log
      await auditService.log(actor, {
        action: 'knowledge.archive',
        resourceType: 'knowledge_item',
        resourceId: itemId,
        details: { reason },
      });

      return success(undefined);
    },

    async searchKnowledge(
      actor: ActorContext,
      params: SearchKnowledgeParams
    ): Promise<Result<KnowledgeSearchResult[]>> {
      // AI_ACTOR can search for RAG
      // Others need knowledge:read
      if (!isAiActor(actor) && !hasPermission(actor, 'knowledge:read')) {
        return failure(
          'PERMISSION_DENIED',
          'Missing knowledge:read permission'
        );
      }

      const results = await db.searchItems(params);
      return success(results);
    },

    async getVersionHistory(
      actor: ActorContext,
      itemId: string
    ): Promise<Result<KnowledgeVersion[]>> {
      const item = await db.getItem(itemId);
      if (item === null) {
        return failure('NOT_FOUND', `Knowledge item not found: ${itemId}`);
      }

      // Must be able to view the item to see its history
      if (!canViewItem(actor, item)) {
        return failure('PERMISSION_DENIED', 'Cannot view this knowledge item');
      }

      const versions = await db.getVersionHistory(itemId);
      return success(versions);
    },
  };
}
