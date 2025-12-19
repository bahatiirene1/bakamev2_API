/**
 * AuditService Unit Tests
 * Phase 2: TDD - RED phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.10
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { AuditService } from '@/services/audit.service.js';
import { createAuditService } from '@/services/audit.service.js';
import type {
  ActorContext,
  AuditEvent,
  AuditLog,
  AuditQueryParams,
  PaginationParams,
  PaginatedResult,
} from '@/types/index.js';
import { SYSTEM_ACTOR, AI_ACTOR } from '@/types/index.js';

// Test fixtures
const TEST_USER_ID = 'user_test123';
const TEST_ADMIN_ID = 'admin_test123';
const TEST_REQUEST_ID = 'req_test123';
const TEST_RESOURCE_ID = 'resource_test123';
const TEST_LOG_ID = 'log_test123';

const createTestActor = (overrides?: Partial<ActorContext>): ActorContext => ({
  type: 'user',
  userId: TEST_USER_ID,
  requestId: TEST_REQUEST_ID,
  permissions: [],
  ...overrides,
});

const createAuditorActor = (
  overrides?: Partial<ActorContext>
): ActorContext => ({
  type: 'admin',
  userId: TEST_ADMIN_ID,
  requestId: TEST_REQUEST_ID,
  permissions: ['audit:read'],
  ...overrides,
});

const createTestEvent = (overrides?: Partial<AuditEvent>): AuditEvent => ({
  action: 'knowledge:publish',
  resourceType: 'knowledge_item',
  resourceId: TEST_RESOURCE_ID,
  details: { status: 'published' },
  ...overrides,
});

const createTestAuditLog = (overrides?: Partial<AuditLog>): AuditLog => ({
  id: TEST_LOG_ID,
  timestamp: new Date(),
  actorId: TEST_USER_ID,
  actorType: 'user',
  action: 'knowledge:publish',
  resourceType: 'knowledge_item',
  resourceId: TEST_RESOURCE_ID,
  details: { status: 'published' },
  ipAddress: null,
  userAgent: null,
  requestId: TEST_REQUEST_ID,
  ...overrides,
});

describe('AuditService', () => {
  let auditService: AuditService;
  let mockDb: {
    insertLog: ReturnType<typeof vi.fn>;
    insertLogsBatch: ReturnType<typeof vi.fn>;
    queryLogs: ReturnType<typeof vi.fn>;
    getLogsByResource: ReturnType<typeof vi.fn>;
    getLogsByActor: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset mocks before each test
    mockDb = {
      insertLog: vi.fn(),
      insertLogsBatch: vi.fn(),
      queryLogs: vi.fn(),
      getLogsByResource: vi.fn(),
      getLogsByActor: vi.fn(),
    };

    auditService = createAuditService({ db: mockDb });
  });

  // ─────────────────────────────────────────────────────────────
  // LOGGING (Write-only)
  // ─────────────────────────────────────────────────────────────

  describe('log', () => {
    it('should log an event without permission check', async () => {
      const actor = createTestActor({ permissions: [] }); // No permissions
      const event = createTestEvent();
      mockDb.insertLog.mockResolvedValue({ id: TEST_LOG_ID });

      const result = await auditService.log(actor, event);

      expect(result.success).toBe(true);
      expect(mockDb.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: TEST_USER_ID,
          actorType: 'user',
          action: 'knowledge:publish',
          resourceType: 'knowledge_item',
          resourceId: TEST_RESOURCE_ID,
          requestId: TEST_REQUEST_ID,
        })
      );
    });

    it('should capture actor context (actorId, actorType, requestId)', async () => {
      const actor = createTestActor({
        type: 'admin',
        userId: TEST_ADMIN_ID,
        requestId: 'req_unique123',
      });
      const event = createTestEvent();
      mockDb.insertLog.mockResolvedValue({ id: TEST_LOG_ID });

      await auditService.log(actor, event);

      expect(mockDb.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: TEST_ADMIN_ID,
          actorType: 'admin',
          requestId: 'req_unique123',
        })
      );
    });

    it('should allow system actor to log', async () => {
      const event = createTestEvent({ action: 'system:startup' });
      mockDb.insertLog.mockResolvedValue({ id: TEST_LOG_ID });

      const result = await auditService.log(SYSTEM_ACTOR, event);

      expect(result.success).toBe(true);
      expect(mockDb.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'system',
          actorId: null, // System actor has no userId
        })
      );
    });

    it('should allow AI actor to log', async () => {
      const event = createTestEvent({ action: 'ai:response' });
      mockDb.insertLog.mockResolvedValue({ id: TEST_LOG_ID });

      const result = await auditService.log(AI_ACTOR, event);

      expect(result.success).toBe(true);
      expect(mockDb.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: 'ai',
        })
      );
    });

    it('should store event details', async () => {
      const actor = createTestActor();
      const event = createTestEvent({
        details: { oldStatus: 'draft', newStatus: 'published' },
      });
      mockDb.insertLog.mockResolvedValue({ id: TEST_LOG_ID });

      await auditService.log(actor, event);

      expect(mockDb.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: { oldStatus: 'draft', newStatus: 'published' },
        })
      );
    });

    it('should handle event without optional resourceId', async () => {
      const actor = createTestActor();
      const event = createTestEvent({ resourceId: undefined });
      mockDb.insertLog.mockResolvedValue({ id: TEST_LOG_ID });

      const result = await auditService.log(actor, event);

      expect(result.success).toBe(true);
      expect(mockDb.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceId: null,
        })
      );
    });

    it('should handle event without optional details', async () => {
      const actor = createTestActor();
      const event = createTestEvent({ details: undefined });
      mockDb.insertLog.mockResolvedValue({ id: TEST_LOG_ID });

      const result = await auditService.log(actor, event);

      expect(result.success).toBe(true);
      expect(mockDb.insertLog).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {},
        })
      );
    });

    it('should return error on database failure', async () => {
      const actor = createTestActor();
      const event = createTestEvent();
      mockDb.insertLog.mockRejectedValue(new Error('Database error'));

      const result = await auditService.log(actor, event);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('logBatch', () => {
    it('should log multiple events atomically', async () => {
      const actor = createTestActor();
      const events = [
        createTestEvent({ action: 'knowledge:create' }),
        createTestEvent({ action: 'knowledge:publish' }),
      ];
      mockDb.insertLogsBatch.mockResolvedValue({ count: 2 });

      const result = await auditService.logBatch(actor, events);

      expect(result.success).toBe(true);
      expect(mockDb.insertLogsBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ action: 'knowledge:create' }),
          expect.objectContaining({ action: 'knowledge:publish' }),
        ])
      );
    });

    it('should use same actor context for all events', async () => {
      const actor = createTestActor({
        userId: 'batch_user',
        requestId: 'batch_req',
      });
      const events = [
        createTestEvent({ action: 'event:1' }),
        createTestEvent({ action: 'event:2' }),
      ];
      mockDb.insertLogsBatch.mockResolvedValue({ count: 2 });

      await auditService.logBatch(actor, events);

      expect(mockDb.insertLogsBatch).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            actorId: 'batch_user',
            requestId: 'batch_req',
          }),
          expect.objectContaining({
            actorId: 'batch_user',
            requestId: 'batch_req',
          }),
        ])
      );
    });

    it('should return error if batch insert fails', async () => {
      const actor = createTestActor();
      const events = [createTestEvent()];
      mockDb.insertLogsBatch.mockRejectedValue(
        new Error('Batch insert failed')
      );

      const result = await auditService.logBatch(actor, events);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('should handle empty events array', async () => {
      const actor = createTestActor();
      mockDb.insertLogsBatch.mockResolvedValue({ count: 0 });

      const result = await auditService.logBatch(actor, []);

      expect(result.success).toBe(true);
    });

    it('should allow system actor to batch log', async () => {
      const events = [
        createTestEvent({ action: 'system:batch:1' }),
        createTestEvent({ action: 'system:batch:2' }),
      ];
      mockDb.insertLogsBatch.mockResolvedValue({ count: 2 });

      const result = await auditService.logBatch(SYSTEM_ACTOR, events);

      expect(result.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // QUERYING (Auditors only)
  // ─────────────────────────────────────────────────────────────

  describe('queryLogs', () => {
    const mockPaginatedResult: PaginatedResult<AuditLog> = {
      items: [createTestAuditLog()],
      hasMore: false,
      nextCursor: undefined,
    };

    it('should return paginated results', async () => {
      const actor = createAuditorActor();
      const params: AuditQueryParams = { limit: 20 };
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      const result = await auditService.queryLogs(actor, params);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(1);
        expect(result.data.hasMore).toBe(false);
      }
    });

    it('should require audit:read permission', async () => {
      const actor = createTestActor({ permissions: [] });
      const params: AuditQueryParams = { limit: 20 };

      const result = await auditService.queryLogs(actor, params);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow system actor to query', async () => {
      const params: AuditQueryParams = { limit: 20 };
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      const result = await auditService.queryLogs(SYSTEM_ACTOR, params);

      expect(result.success).toBe(true);
    });

    it('should filter by actorId', async () => {
      const actor = createAuditorActor();
      const params: AuditQueryParams = { limit: 20, actorId: 'specific_user' };
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      await auditService.queryLogs(actor, params);

      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'specific_user' })
      );
    });

    it('should filter by actorType', async () => {
      const actor = createAuditorActor();
      const params: AuditQueryParams = { limit: 20, actorType: 'admin' };
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      await auditService.queryLogs(actor, params);

      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'admin' })
      );
    });

    it('should filter by action', async () => {
      const actor = createAuditorActor();
      const params: AuditQueryParams = {
        limit: 20,
        action: 'knowledge:publish',
      };
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      await auditService.queryLogs(actor, params);

      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'knowledge:publish' })
      );
    });

    it('should filter by resourceType', async () => {
      const actor = createAuditorActor();
      const params: AuditQueryParams = {
        limit: 20,
        resourceType: 'knowledge_item',
      };
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      await auditService.queryLogs(actor, params);

      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'knowledge_item' })
      );
    });

    it('should filter by resourceId', async () => {
      const actor = createAuditorActor();
      const params: AuditQueryParams = {
        limit: 20,
        resourceId: TEST_RESOURCE_ID,
      };
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      await auditService.queryLogs(actor, params);

      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: TEST_RESOURCE_ID })
      );
    });

    it('should filter by date range (startDate and endDate)', async () => {
      const actor = createAuditorActor();
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      const params: AuditQueryParams = { limit: 20, startDate, endDate };
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      await auditService.queryLogs(actor, params);

      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ startDate, endDate })
      );
    });

    it('should support cursor-based pagination', async () => {
      const actor = createAuditorActor();
      const cursor = 'cursor_abc123';
      const params: AuditQueryParams = { limit: 20, cursor };
      mockDb.queryLogs.mockResolvedValue({
        ...mockPaginatedResult,
        hasMore: true,
        nextCursor: 'cursor_next',
      });

      const result = await auditService.queryLogs(actor, params);

      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ cursor })
      );
      if (result.success) {
        expect(result.data.nextCursor).toBe('cursor_next');
        expect(result.data.hasMore).toBe(true);
      }
    });

    it('should normalize pagination params (limit within bounds)', async () => {
      const actor = createAuditorActor();
      const params: AuditQueryParams = { limit: 1000 }; // Exceeds max
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      await auditService.queryLogs(actor, params);

      // Should cap limit at MAX_PAGE_LIMIT (100)
      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
    });

    it('should use default limit when not provided', async () => {
      const actor = createAuditorActor();
      const params = {} as AuditQueryParams;
      mockDb.queryLogs.mockResolvedValue(mockPaginatedResult);

      await auditService.queryLogs(actor, params);

      // Should use DEFAULT_PAGE_LIMIT (20)
      expect(mockDb.queryLogs).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20 })
      );
    });
  });

  describe('getResourceHistory', () => {
    const mockLogs = [
      createTestAuditLog({ action: 'knowledge:create' }),
      createTestAuditLog({ action: 'knowledge:update' }),
      createTestAuditLog({ action: 'knowledge:publish' }),
    ];

    it('should return all logs for a resource', async () => {
      const actor = createAuditorActor();
      mockDb.getLogsByResource.mockResolvedValue(mockLogs);

      const result = await auditService.getResourceHistory(
        actor,
        'knowledge_item',
        TEST_RESOURCE_ID
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveLength(3);
        expect(result.data[0].action).toBe('knowledge:create');
      }
    });

    it('should require audit:read permission', async () => {
      const actor = createTestActor({ permissions: [] });

      const result = await auditService.getResourceHistory(
        actor,
        'knowledge_item',
        TEST_RESOURCE_ID
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow system actor to get resource history', async () => {
      mockDb.getLogsByResource.mockResolvedValue(mockLogs);

      const result = await auditService.getResourceHistory(
        SYSTEM_ACTOR,
        'knowledge_item',
        TEST_RESOURCE_ID
      );

      expect(result.success).toBe(true);
    });

    it('should return empty array for resource with no history', async () => {
      const actor = createAuditorActor();
      mockDb.getLogsByResource.mockResolvedValue([]);

      const result = await auditService.getResourceHistory(
        actor,
        'knowledge_item',
        'nonexistent_resource'
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('should pass resourceType and resourceId to database', async () => {
      const actor = createAuditorActor();
      mockDb.getLogsByResource.mockResolvedValue([]);

      await auditService.getResourceHistory(actor, 'chat_session', 'chat_123');

      expect(mockDb.getLogsByResource).toHaveBeenCalledWith(
        'chat_session',
        'chat_123'
      );
    });
  });

  describe('getActorHistory', () => {
    const mockPaginatedResult: PaginatedResult<AuditLog> = {
      items: [
        createTestAuditLog({ actorId: 'target_user' }),
        createTestAuditLog({ actorId: 'target_user', action: 'chat:create' }),
      ],
      hasMore: false,
      nextCursor: undefined,
    };

    it('should return all logs for an actor', async () => {
      const actor = createAuditorActor();
      const params: PaginationParams = { limit: 20 };
      mockDb.getLogsByActor.mockResolvedValue(mockPaginatedResult);

      const result = await auditService.getActorHistory(
        actor,
        'target_user',
        params
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toHaveLength(2);
      }
    });

    it('should require audit:read permission', async () => {
      const actor = createTestActor({ permissions: [] });
      const params: PaginationParams = { limit: 20 };

      const result = await auditService.getActorHistory(
        actor,
        'target_user',
        params
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('should allow system actor to get actor history', async () => {
      const params: PaginationParams = { limit: 20 };
      mockDb.getLogsByActor.mockResolvedValue(mockPaginatedResult);

      const result = await auditService.getActorHistory(
        SYSTEM_ACTOR,
        'target_user',
        params
      );

      expect(result.success).toBe(true);
    });

    it('should support pagination', async () => {
      const actor = createAuditorActor();
      const params: PaginationParams = { limit: 10, cursor: 'cursor_123' };
      mockDb.getLogsByActor.mockResolvedValue({
        ...mockPaginatedResult,
        hasMore: true,
        nextCursor: 'cursor_next',
      });

      const result = await auditService.getActorHistory(
        actor,
        'target_user',
        params
      );

      expect(mockDb.getLogsByActor).toHaveBeenCalledWith(
        'target_user',
        expect.objectContaining({ limit: 10, cursor: 'cursor_123' })
      );
      if (result.success) {
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBe('cursor_next');
      }
    });

    it('should return empty result for actor with no history', async () => {
      const actor = createAuditorActor();
      const params: PaginationParams = { limit: 20 };
      mockDb.getLogsByActor.mockResolvedValue({
        items: [],
        hasMore: false,
        nextCursor: undefined,
      });

      const result = await auditService.getActorHistory(
        actor,
        'nonexistent_actor',
        params
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items).toEqual([]);
      }
    });

    it('should normalize pagination params', async () => {
      const actor = createAuditorActor();
      const params: PaginationParams = { limit: 500 }; // Exceeds max
      mockDb.getLogsByActor.mockResolvedValue(mockPaginatedResult);

      await auditService.getActorHistory(actor, 'target_user', params);

      expect(mockDb.getLogsByActor).toHaveBeenCalledWith(
        'target_user',
        expect.objectContaining({ limit: 100 }) // Capped at MAX_PAGE_LIMIT
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // AI ACTOR INVARIANTS
  // ─────────────────────────────────────────────────────────────

  describe('AI Actor Invariants', () => {
    it('AI_ACTOR should be able to log its own actions', async () => {
      const event = createTestEvent({ action: 'ai:generated_response' });
      mockDb.insertLog.mockResolvedValue({ id: TEST_LOG_ID });

      const result = await auditService.log(AI_ACTOR, event);

      expect(result.success).toBe(true);
    });

    it('AI_ACTOR should NOT be able to query audit logs', async () => {
      const params: AuditQueryParams = { limit: 20 };

      const result = await auditService.queryLogs(AI_ACTOR, params);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('AI_ACTOR should NOT be able to get resource history', async () => {
      const result = await auditService.getResourceHistory(
        AI_ACTOR,
        'knowledge_item',
        TEST_RESOURCE_ID
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });

    it('AI_ACTOR should NOT be able to get actor history', async () => {
      const params: PaginationParams = { limit: 20 };

      const result = await auditService.getActorHistory(
        AI_ACTOR,
        TEST_USER_ID,
        params
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });
});
