/**
 * PromptService Unit Tests
 * RED PHASE: All tests should fail with "Not implemented"
 *
 * Reference: docs/stage-2-service-layer.md Section 3.6
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  createPromptService,
  type PromptService,
  type PromptServiceDb,
  type PromptServiceAudit,
} from '@/services/prompt.service.js';
import type {
  ActorContext,
  SystemPrompt,
  CreatePromptParams,
  PromptUpdate,
  ListPromptsParams,
  PaginationParams,
  PaginatedResult,
} from '@/types/index.js';
import { SYSTEM_ACTOR, AI_ACTOR } from '@/types/index.js';

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
    permissions: [
      'prompt:read',
      'prompt:write',
      'prompt:review',
      'prompt:activate',
    ],
  };
}

function createMockPrompt(overrides: Partial<SystemPrompt> = {}): SystemPrompt {
  return {
    id: 'prompt-123',
    name: 'Test Prompt',
    description: 'A test system prompt',
    content: 'You are a helpful assistant.',
    status: 'draft',
    authorId: 'user-1',
    reviewerId: null,
    version: 1,
    isDefault: false,
    activatedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  };
}

function createMockDb(): PromptServiceDb {
  return {
    createPrompt: vi.fn(),
    getPrompt: vi.fn(),
    getActivePrompt: vi.fn(),
    listPrompts: vi.fn(),
    updatePrompt: vi.fn(),
    updatePromptStatus: vi.fn(),
    activatePrompt: vi.fn(),
    getPromptVersionHistory: vi.fn(),
    createVersion: vi.fn(),
  };
}

function createMockAuditService(): PromptServiceAudit {
  return {
    log: vi.fn().mockResolvedValue({ success: true, data: undefined }),
  };
}

// ─────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────

describe('PromptService', () => {
  let service: PromptService;
  let mockDb: PromptServiceDb;
  let mockAuditService: PromptServiceAudit;

  beforeEach(() => {
    mockDb = createMockDb();
    mockAuditService = createMockAuditService();
    service = createPromptService({
      db: mockDb,
      auditService: mockAuditService,
    });
  });

  // ─────────────────────────────────────────────────────────────
  // createPrompt
  // ─────────────────────────────────────────────────────────────

  describe('createPrompt', () => {
    const validParams: CreatePromptParams = {
      name: 'Test Prompt',
      description: 'A test prompt',
      content: 'You are a helpful assistant.',
    };

    it('should create a prompt when user has prompt:write permission', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({ authorId: 'user-1' });
      vi.mocked(mockDb.createPrompt).mockResolvedValue(mockPrompt);

      const result = await service.createPrompt(actor, validParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Test Prompt');
        expect(result.data.status).toBe('draft');
        expect(result.data.authorId).toBe('user-1');
      }
    });

    it('should create a prompt when admin has prompt:write permission', async () => {
      const actor = createAdminActor('admin-1');
      const mockPrompt = createMockPrompt({ authorId: 'admin-1' });
      vi.mocked(mockDb.createPrompt).mockResolvedValue(mockPrompt);

      const result = await service.createPrompt(actor, validParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.authorId).toBe('admin-1');
      }
    });

    it('should reject when user lacks prompt:write permission', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);

      const result = await service.createPrompt(actor, validParams);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to create prompts', async () => {
      const mockPrompt = createMockPrompt({ authorId: 'system' });
      vi.mocked(mockDb.createPrompt).mockResolvedValue(mockPrompt);

      const result = await service.createPrompt(SYSTEM_ACTOR, validParams);

      expect(result.success).toBe(true);
    });

    it('should allow AI_ACTOR to create draft prompts', async () => {
      const mockPrompt = createMockPrompt({ authorId: 'ai' });
      vi.mocked(mockDb.createPrompt).mockResolvedValue(mockPrompt);

      const result = await service.createPrompt(AI_ACTOR, validParams);

      expect(result.success).toBe(true);
    });

    it('should create prompt without description', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const params: CreatePromptParams = {
        name: 'Minimal Prompt',
        content: 'You are helpful.',
      };
      const mockPrompt = createMockPrompt({
        name: 'Minimal Prompt',
        description: null,
      });
      vi.mocked(mockDb.createPrompt).mockResolvedValue(mockPrompt);

      const result = await service.createPrompt(actor, params);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.description).toBeNull();
      }
    });

    it('should start new prompts as draft status', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({ status: 'draft' });
      vi.mocked(mockDb.createPrompt).mockResolvedValue(mockPrompt);

      const result = await service.createPrompt(actor, validParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('draft');
      }
    });

    it('should start new prompts with version 1', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({ version: 1 });
      vi.mocked(mockDb.createPrompt).mockResolvedValue(mockPrompt);

      const result = await service.createPrompt(actor, validParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getPrompt
  // ─────────────────────────────────────────────────────────────

  describe('getPrompt', () => {
    it('should return active prompt when user has prompt:read permission', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      const mockPrompt = createMockPrompt({ status: 'active' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.getPrompt(actor, 'prompt-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('prompt-123');
      }
    });

    it('should return draft prompt to its author', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.getPrompt(actor, 'prompt-123');

      expect(result.success).toBe(true);
    });

    it('should deny draft prompt to non-author', async () => {
      const actor = createUserActor('user-2', ['prompt:read']);
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.getPrompt(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to view any prompt', async () => {
      const actor = createAdminActor('admin-1');
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.getPrompt(actor, 'prompt-123');

      expect(result.success).toBe(true);
    });

    it('should return NOT_FOUND for non-existent prompt', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      vi.mocked(mockDb.getPrompt).mockResolvedValue(null);

      const result = await service.getPrompt(actor, 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should reject when user lacks prompt:read permission', async () => {
      const actor = createUserActor('user-1', []);

      const result = await service.getPrompt(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to read any prompt', async () => {
      const mockPrompt = createMockPrompt({ status: 'draft' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.getPrompt(SYSTEM_ACTOR, 'prompt-123');

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getActivePrompt
  // ─────────────────────────────────────────────────────────────

  describe('getActivePrompt', () => {
    it('should return the active default prompt', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      const mockPrompt = createMockPrompt({
        status: 'active',
        isDefault: true,
      });
      vi.mocked(mockDb.getActivePrompt).mockResolvedValue(mockPrompt);

      const result = await service.getActivePrompt(actor);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isDefault).toBe(true);
        expect(result.data.status).toBe('active');
      }
    });

    it('should return NOT_FOUND when no active prompt exists', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      vi.mocked(mockDb.getActivePrompt).mockResolvedValue(null);

      const result = await service.getActivePrompt(actor);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow SYSTEM_ACTOR to get active prompt', async () => {
      const mockPrompt = createMockPrompt({
        status: 'active',
        isDefault: true,
      });
      vi.mocked(mockDb.getActivePrompt).mockResolvedValue(mockPrompt);

      const result = await service.getActivePrompt(SYSTEM_ACTOR);

      expect(result.success).toBe(true);
    });

    it('should allow AI_ACTOR to get active prompt', async () => {
      const mockPrompt = createMockPrompt({
        status: 'active',
        isDefault: true,
      });
      vi.mocked(mockDb.getActivePrompt).mockResolvedValue(mockPrompt);

      const result = await service.getActivePrompt(AI_ACTOR);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // listPrompts
  // ─────────────────────────────────────────────────────────────

  describe('listPrompts', () => {
    const defaultParams: ListPromptsParams & PaginationParams = {};

    it('should list prompts when user has prompt:read permission', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      const mockResult: PaginatedResult<SystemPrompt> = {
        items: [createMockPrompt()],
        hasMore: false,
      };
      vi.mocked(mockDb.listPrompts).mockResolvedValue(mockResult);

      const result = await service.listPrompts(actor, defaultParams);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
      }
    });

    it('should filter by status', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      const params: ListPromptsParams & PaginationParams = { status: 'active' };
      const mockResult: PaginatedResult<SystemPrompt> = {
        items: [createMockPrompt({ status: 'active' })],
        hasMore: false,
      };
      vi.mocked(mockDb.listPrompts).mockResolvedValue(mockResult);

      const result = await service.listPrompts(actor, params);

      expect(result.success).toBe(true);
      expect(mockDb.listPrompts).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active' })
      );
    });

    it('should support pagination', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      const params: ListPromptsParams & PaginationParams = {
        limit: 10,
        cursor: 'cursor-123',
      };
      const mockResult: PaginatedResult<SystemPrompt> = {
        items: [createMockPrompt()],
        hasMore: true,
        nextCursor: 'next-cursor',
      };
      vi.mocked(mockDb.listPrompts).mockResolvedValue(mockResult);

      const result = await service.listPrompts(actor, params);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBe('next-cursor');
      }
    });

    it('should reject when user lacks prompt:read permission', async () => {
      const actor = createUserActor('user-1', []);

      const result = await service.listPrompts(actor, defaultParams);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to list prompts', async () => {
      const mockResult: PaginatedResult<SystemPrompt> = {
        items: [],
        hasMore: false,
      };
      vi.mocked(mockDb.listPrompts).mockResolvedValue(mockResult);

      const result = await service.listPrompts(SYSTEM_ACTOR, defaultParams);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // updatePrompt
  // ─────────────────────────────────────────────────────────────

  describe('updatePrompt', () => {
    const validUpdates: PromptUpdate = {
      name: 'Updated Prompt',
      content: 'Updated content.',
    };

    it('should update draft prompt when user is author', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
      });
      const updatedPrompt = createMockPrompt({
        ...mockPrompt,
        name: 'Updated Prompt',
        version: 2,
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePrompt).mockResolvedValue(updatedPrompt);

      const result = await service.updatePrompt(
        actor,
        'prompt-123',
        validUpdates
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('Updated Prompt');
      }
    });

    it('should reject update when user is not author', async () => {
      const actor = createUserActor('user-2', ['prompt:write']);
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.updatePrompt(
        actor,
        'prompt-123',
        validUpdates
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to update any prompt', async () => {
      const actor = createAdminActor('admin-1');
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
      });
      const updatedPrompt = createMockPrompt({
        ...mockPrompt,
        name: 'Updated Prompt',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePrompt).mockResolvedValue(updatedPrompt);

      const result = await service.updatePrompt(
        actor,
        'prompt-123',
        validUpdates
      );

      expect(result.success).toBe(true);
    });

    it('should reject update when prompt is not in draft status', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({
        status: 'active',
        authorId: 'user-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.updatePrompt(
        actor,
        'prompt-123',
        validUpdates
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should return NOT_FOUND for non-existent prompt', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      vi.mocked(mockDb.getPrompt).mockResolvedValue(null);

      const result = await service.updatePrompt(
        actor,
        'nonexistent',
        validUpdates
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should reject when user lacks prompt:write permission', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);

      const result = await service.updatePrompt(
        actor,
        'prompt-123',
        validUpdates
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should increment version on content update', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
        version: 1,
      });
      const updatedPrompt = createMockPrompt({
        ...mockPrompt,
        version: 2,
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePrompt).mockResolvedValue(updatedPrompt);

      const result = await service.updatePrompt(actor, 'prompt-123', {
        content: 'New content',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(2);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // submitForReview
  // ─────────────────────────────────────────────────────────────

  describe('submitForReview', () => {
    it('should submit draft prompt for review when user is author', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
      });
      const updatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'pending_review',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePromptStatus).mockResolvedValue(updatedPrompt);

      const result = await service.submitForReview(actor, 'prompt-123');

      expect(result.success).toBe(true);
      expect(mockDb.updatePromptStatus).toHaveBeenCalledWith(
        'prompt-123',
        'pending_review',
        undefined
      );
    });

    it('should reject submission when user is not author', async () => {
      const actor = createUserActor('user-2', ['prompt:write']);
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'user-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.submitForReview(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should reject submission when prompt is not in draft status', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({
        status: 'pending_review',
        authorId: 'user-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.submitForReview(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should return NOT_FOUND for non-existent prompt', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      vi.mocked(mockDb.getPrompt).mockResolvedValue(null);

      const result = await service.submitForReview(actor, 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should allow AI_ACTOR to submit its own draft', async () => {
      const mockPrompt = createMockPrompt({
        status: 'draft',
        authorId: 'ai',
      });
      const updatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'pending_review',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePromptStatus).mockResolvedValue(updatedPrompt);

      const result = await service.submitForReview(AI_ACTOR, 'prompt-123');

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // approvePrompt
  // ─────────────────────────────────────────────────────────────

  describe('approvePrompt', () => {
    it('should approve pending prompt when user has prompt:review permission', async () => {
      const actor = createUserActor('reviewer-1', ['prompt:review']);
      const mockPrompt = createMockPrompt({
        status: 'pending_review',
        authorId: 'user-1',
      });
      const updatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'approved',
        reviewerId: 'reviewer-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePromptStatus).mockResolvedValue(updatedPrompt);

      const result = await service.approvePrompt(actor, 'prompt-123');

      expect(result.success).toBe(true);
      expect(mockDb.updatePromptStatus).toHaveBeenCalledWith(
        'prompt-123',
        'approved',
        'reviewer-1'
      );
    });

    it('should reject approval when user lacks prompt:review permission', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({ status: 'pending_review' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.approvePrompt(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should reject approval when prompt is not pending_review', async () => {
      const actor = createUserActor('reviewer-1', ['prompt:review']);
      const mockPrompt = createMockPrompt({ status: 'draft' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.approvePrompt(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should reject self-approval', async () => {
      const actor = createUserActor('user-1', ['prompt:review']);
      const mockPrompt = createMockPrompt({
        status: 'pending_review',
        authorId: 'user-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.approvePrompt(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should prevent AI_ACTOR from approving prompts', async () => {
      const mockPrompt = createMockPrompt({ status: 'pending_review' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.approvePrompt(AI_ACTOR, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow admin to approve prompts they did not author', async () => {
      const actor = createAdminActor('admin-1');
      const mockPrompt = createMockPrompt({
        status: 'pending_review',
        authorId: 'user-1',
      });
      const updatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'approved',
        reviewerId: 'admin-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePromptStatus).mockResolvedValue(updatedPrompt);

      const result = await service.approvePrompt(actor, 'prompt-123');

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // rejectPrompt
  // ─────────────────────────────────────────────────────────────

  describe('rejectPrompt', () => {
    it('should reject pending prompt when user has prompt:review permission', async () => {
      const actor = createUserActor('reviewer-1', ['prompt:review']);
      const mockPrompt = createMockPrompt({
        status: 'pending_review',
        authorId: 'user-1',
      });
      const updatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'draft',
        reviewerId: 'reviewer-1',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePromptStatus).mockResolvedValue(updatedPrompt);

      const result = await service.rejectPrompt(
        actor,
        'prompt-123',
        'Needs more work'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updatePromptStatus).toHaveBeenCalledWith(
        'prompt-123',
        'draft',
        'reviewer-1'
      );
    });

    it('should reject rejection when user lacks prompt:review permission', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({ status: 'pending_review' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.rejectPrompt(
        actor,
        'prompt-123',
        'Not good enough'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should reject rejection when prompt is not pending_review', async () => {
      const actor = createUserActor('reviewer-1', ['prompt:review']);
      const mockPrompt = createMockPrompt({ status: 'active' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.rejectPrompt(
        actor,
        'prompt-123',
        'Needs changes'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should require a reason for rejection', async () => {
      const actor = createUserActor('reviewer-1', ['prompt:review']);
      const mockPrompt = createMockPrompt({ status: 'pending_review' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.rejectPrompt(actor, 'prompt-123', '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should prevent AI_ACTOR from rejecting prompts', async () => {
      const mockPrompt = createMockPrompt({ status: 'pending_review' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.rejectPrompt(
        AI_ACTOR,
        'prompt-123',
        'Not good'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // activatePrompt
  // ─────────────────────────────────────────────────────────────

  describe('activatePrompt', () => {
    it('should activate approved prompt when user has prompt:activate permission', async () => {
      const actor = createUserActor('admin-1', ['prompt:activate']);
      const mockPrompt = createMockPrompt({ status: 'approved' });
      const activatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'active',
        isDefault: true,
        activatedAt: new Date(),
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.activatePrompt).mockResolvedValue(activatedPrompt);

      const result = await service.activatePrompt(actor, 'prompt-123');

      expect(result.success).toBe(true);
      expect(mockDb.activatePrompt).toHaveBeenCalledWith('prompt-123');
    });

    it('should reject activation when user lacks prompt:activate permission', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({ status: 'approved' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.activatePrompt(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should reject activation when prompt is not approved', async () => {
      const actor = createUserActor('admin-1', ['prompt:activate']);
      const mockPrompt = createMockPrompt({ status: 'pending_review' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.activatePrompt(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should deactivate previous default prompt atomically', async () => {
      const actor = createAdminActor('admin-1');
      const mockPrompt = createMockPrompt({ status: 'approved' });
      const activatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'active',
        isDefault: true,
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.activatePrompt).mockResolvedValue(activatedPrompt);

      const result = await service.activatePrompt(actor, 'prompt-123');

      expect(result.success).toBe(true);
      // The db adapter should handle atomic deactivation of previous default
      expect(mockDb.activatePrompt).toHaveBeenCalledWith('prompt-123');
    });

    it('should prevent AI_ACTOR from activating prompts', async () => {
      const mockPrompt = createMockPrompt({ status: 'approved' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.activatePrompt(AI_ACTOR, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should return NOT_FOUND for non-existent prompt', async () => {
      const actor = createAdminActor('admin-1');
      vi.mocked(mockDb.getPrompt).mockResolvedValue(null);

      const result = await service.activatePrompt(actor, 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // deprecatePrompt
  // ─────────────────────────────────────────────────────────────

  describe('deprecatePrompt', () => {
    it('should deprecate active prompt when user has prompt:activate permission', async () => {
      const actor = createUserActor('admin-1', ['prompt:activate']);
      const mockPrompt = createMockPrompt({ status: 'active' });
      const deprecatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'deprecated',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePromptStatus).mockResolvedValue(deprecatedPrompt);

      const result = await service.deprecatePrompt(
        actor,
        'prompt-123',
        'No longer needed'
      );

      expect(result.success).toBe(true);
      expect(mockDb.updatePromptStatus).toHaveBeenCalledWith(
        'prompt-123',
        'deprecated',
        undefined
      );
    });

    it('should reject deprecation when user lacks prompt:activate permission', async () => {
      const actor = createUserActor('user-1', ['prompt:write']);
      const mockPrompt = createMockPrompt({ status: 'active' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.deprecatePrompt(
        actor,
        'prompt-123',
        'Outdated'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should reject deprecation of draft prompt', async () => {
      const actor = createUserActor('admin-1', ['prompt:activate']);
      const mockPrompt = createMockPrompt({ status: 'draft' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.deprecatePrompt(
        actor,
        'prompt-123',
        'Not needed'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should reject deprecation of default prompt', async () => {
      const actor = createUserActor('admin-1', ['prompt:activate']);
      const mockPrompt = createMockPrompt({
        status: 'active',
        isDefault: true,
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.deprecatePrompt(
        actor,
        'prompt-123',
        'Outdated'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INVALID_STATE');
      }
    });

    it('should require a reason for deprecation', async () => {
      const actor = createUserActor('admin-1', ['prompt:activate']);
      const mockPrompt = createMockPrompt({ status: 'active' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.deprecatePrompt(actor, 'prompt-123', '');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should prevent AI_ACTOR from deprecating prompts', async () => {
      const mockPrompt = createMockPrompt({ status: 'active' });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);

      const result = await service.deprecatePrompt(
        AI_ACTOR,
        'prompt-123',
        'Outdated'
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow deprecation of approved (non-active) prompt', async () => {
      const actor = createUserActor('admin-1', ['prompt:activate']);
      const mockPrompt = createMockPrompt({ status: 'approved' });
      const deprecatedPrompt = createMockPrompt({
        ...mockPrompt,
        status: 'deprecated',
      });
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.updatePromptStatus).mockResolvedValue(deprecatedPrompt);

      const result = await service.deprecatePrompt(
        actor,
        'prompt-123',
        'No longer needed'
      );

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // getVersionHistory
  // ─────────────────────────────────────────────────────────────

  describe('getVersionHistory', () => {
    const mockVersions = [
      {
        version: 2,
        name: 'Updated Prompt',
        content: 'Updated content.',
        authorId: 'user-1',
        createdAt: new Date('2024-01-02'),
      },
      {
        version: 1,
        name: 'Original Prompt',
        content: 'Original content.',
        authorId: 'user-1',
        createdAt: new Date('2024-01-01'),
      },
    ];

    it('should return version history when user has prompt:read permission', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      const mockPrompt = createMockPrompt();
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.getPromptVersionHistory).mockResolvedValue(mockVersions);

      const result = await service.getVersionHistory(actor, 'prompt-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(2);
        expect(result.data[0].version).toBe(2);
      }
    });

    it('should return NOT_FOUND for non-existent prompt', async () => {
      const actor = createUserActor('user-1', ['prompt:read']);
      vi.mocked(mockDb.getPrompt).mockResolvedValue(null);

      const result = await service.getVersionHistory(actor, 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_FOUND');
      }
    });

    it('should reject when user lacks prompt:read permission', async () => {
      const actor = createUserActor('user-1', []);

      const result = await service.getVersionHistory(actor, 'prompt-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow SYSTEM_ACTOR to view version history', async () => {
      const mockPrompt = createMockPrompt();
      vi.mocked(mockDb.getPrompt).mockResolvedValue(mockPrompt);
      vi.mocked(mockDb.getPromptVersionHistory).mockResolvedValue(mockVersions);

      const result = await service.getVersionHistory(
        SYSTEM_ACTOR,
        'prompt-123'
      );

      expect(result.success).toBe(true);
    });
  });
});
