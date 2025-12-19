/**
 * AuditService Integration Tests
 * Phase 2: Tests with real Supabase database
 *
 * These tests require:
 * - SUPABASE_URL environment variable
 * - SUPABASE_SERVICE_KEY environment variable
 * - Database with audit_logs table
 *
 * Tests are skipped if credentials are not available.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { createAuditService, createAuditServiceDb } from '@/services/index.js';
import type { AuditService } from '@/services/index.js';
import type { ActorContext, AuditEvent } from '@/types/index.js';
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

// Helper to create auditor actor (with audit:read permission)
function createAuditorActor(overrides?: Partial<ActorContext>): ActorContext {
  return {
    type: 'admin',
    userId: testId('auditor'),
    requestId: testId('req'),
    permissions: ['audit:read'],
    ...overrides,
  };
}

// Helper to create test event
function createTestEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  return {
    action: 'test:action',
    resourceType: 'test_resource',
    resourceId: testId('resource'),
    details: { testPrefix: TEST_PREFIX },
    ...overrides,
  };
}

describe.skipIf(!HAS_CREDENTIALS)('AuditService Integration', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let supabase: SupabaseClient<any, 'public', any>;
  let auditService: AuditService;

  beforeAll(async () => {
    // Create Supabase client with service key (bypasses RLS)
    supabase = createClient(
      SUPABASE_URL!,
      SUPABASE_SERVICE_KEY!
    ) as SupabaseClient<any, 'public', any>;

    // Create database adapter and service
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const db = createAuditServiceDb(supabase);
    auditService = createAuditService({ db });
  });

  afterAll(async () => {
    // Cleanup test audit logs (note: this uses service role which bypasses RLS)
    // Since we didn't enable immutability triggers for testing, we can delete test data
    // In production, audit logs would be truly immutable
    try {
      await supabase
        .from('audit_logs')
        .delete()
        .like('request_id', `${TEST_PREFIX}%`);
    } catch {
      // Cleanup failure is acceptable - tests use unique prefixes
    }
  });

  beforeEach(async () => {
    // Each test uses unique IDs, no cleanup needed between tests
  });

  describe('log', () => {
    it('should insert an audit log into the database', async () => {
      const actor = createTestActor();
      const event = createTestEvent({ action: 'integration:test:insert' });

      const result = await auditService.log(actor, event);

      expect(result.success).toBe(true);

      // Verify log was inserted
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'integration:test:insert')
        .eq('actor_id', actor.userId)
        .single();

      expect(data).not.toBeNull();
      expect(data?.actor_type).toBe('user');
      expect(data?.resource_type).toBe('test_resource');
    });

    it('should capture all actor context fields', async () => {
      const actor = createTestActor({
        type: 'admin',
        ip: '192.168.1.1',
        userAgent: 'TestAgent/1.0',
      });
      const event = createTestEvent({ action: 'integration:test:context' });

      await auditService.log(actor, event);

      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('action', 'integration:test:context')
        .eq('actor_id', actor.userId)
        .single();

      expect(data?.actor_type).toBe('admin');
      expect(data?.ip_address).toBe('192.168.1.1');
      expect(data?.user_agent).toBe('TestAgent/1.0');
      expect(data?.request_id).toBe(actor.requestId);
    });

    it('should handle system actor with null actor_id', async () => {
      const uniqueAction = `integration:test:system:${testId('sys')}`;
      const event = createTestEvent({ action: uniqueAction });

      const result = await auditService.log(SYSTEM_ACTOR, event);

      expect(result.success).toBe(true);

      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('action', uniqueAction)
        .is('actor_id', null)
        .single();

      expect(data).not.toBeNull();
      expect(data?.actor_type).toBe('system');
    });

    it('should store JSONB details correctly', async () => {
      const actor = createTestActor();
      const complexDetails = {
        nested: { value: 123 },
        array: [1, 2, 3],
        string: 'test',
        bool: true,
      };
      const event = createTestEvent({
        action: 'integration:test:jsonb',
        details: complexDetails,
      });

      await auditService.log(actor, event);

      const { data } = await supabase
        .from('audit_logs')
        .select('details')
        .eq('action', 'integration:test:jsonb')
        .eq('actor_id', actor.userId)
        .single();

      expect(data?.details).toEqual(complexDetails);
    });
  });

  describe('logBatch', () => {
    it('should insert multiple logs atomically', async () => {
      const actor = createTestActor();
      const batchId = testId('batch');
      const events = [
        createTestEvent({ action: `batch:${batchId}:1` }),
        createTestEvent({ action: `batch:${batchId}:2` }),
        createTestEvent({ action: `batch:${batchId}:3` }),
      ];

      const result = await auditService.logBatch(actor, events);

      expect(result.success).toBe(true);

      // Verify all logs were inserted
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .like('action', `batch:${batchId}:%`)
        .eq('actor_id', actor.userId);

      expect(data).toHaveLength(3);
    });
  });

  describe('queryLogs', () => {
    it('should return logs with pagination', async () => {
      const actor = createTestActor();
      const queryId = testId('query');

      // Insert test logs
      for (let i = 0; i < 5; i++) {
        await auditService.log(
          actor,
          createTestEvent({
            action: `query:${queryId}:${i}`,
            resourceId: queryId,
          })
        );
      }

      const auditor = createAuditorActor();
      const result = await auditService.queryLogs(auditor, {
        resourceId: queryId,
        limit: 3,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.length).toBeLessThanOrEqual(3);
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBeDefined();
      }
    });

    it('should filter by actorType', async () => {
      const userActor = createTestActor({ type: 'user' });
      const adminActor = createTestActor({ type: 'admin' });
      const filterId = testId('filter');

      await auditService.log(
        userActor,
        createTestEvent({
          action: `filter:${filterId}:user`,
          resourceId: filterId,
        })
      );
      await auditService.log(
        adminActor,
        createTestEvent({
          action: `filter:${filterId}:admin`,
          resourceId: filterId,
        })
      );

      const auditor = createAuditorActor();
      const result = await auditService.queryLogs(auditor, {
        resourceId: filterId,
        actorType: 'admin',
        limit: 20,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(
          result.data.items.every((log) => log.actorType === 'admin')
        ).toBe(true);
      }
    });

    it('should filter by action', async () => {
      const actor = createTestActor();
      const actionId = testId('action');
      const targetAction = `action:${actionId}:target`;

      await auditService.log(actor, createTestEvent({ action: targetAction }));
      await auditService.log(
        actor,
        createTestEvent({ action: `action:${actionId}:other` })
      );

      const auditor = createAuditorActor();
      const result = await auditService.queryLogs(auditor, {
        action: targetAction,
        limit: 20,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(
          result.data.items.every((log) => log.action === targetAction)
        ).toBe(true);
      }
    });

    it('should require audit:read permission', async () => {
      const actor = createTestActor({ permissions: [] });

      const result = await auditService.queryLogs(actor, { limit: 20 });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  describe('getResourceHistory', () => {
    it('should return all logs for a resource', async () => {
      const actor = createTestActor();
      const resourceId = testId('resource');

      // Create multiple logs for the same resource
      await auditService.log(
        actor,
        createTestEvent({
          action: 'resource:create',
          resourceType: 'test_item',
          resourceId,
        })
      );
      await auditService.log(
        actor,
        createTestEvent({
          action: 'resource:update',
          resourceType: 'test_item',
          resourceId,
        })
      );

      const auditor = createAuditorActor();
      const result = await auditService.getResourceHistory(
        auditor,
        'test_item',
        resourceId
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.length).toBeGreaterThanOrEqual(2);
        expect(result.data.every((log) => log.resourceId === resourceId)).toBe(
          true
        );
      }
    });

    it('should return empty array for non-existent resource', async () => {
      const auditor = createAuditorActor();
      const result = await auditService.getResourceHistory(
        auditor,
        'nonexistent_type',
        testId('nonexistent')
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  describe('getActorHistory', () => {
    it('should return all logs for an actor', async () => {
      const targetActorId = testId('targetActor');
      const actor = createTestActor({ userId: targetActorId });

      // Create multiple logs for the same actor
      await auditService.log(
        actor,
        createTestEvent({ action: 'actor:action1' })
      );
      await auditService.log(
        actor,
        createTestEvent({ action: 'actor:action2' })
      );

      const auditor = createAuditorActor();
      const result = await auditService.getActorHistory(
        auditor,
        targetActorId,
        { limit: 20 }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.length).toBeGreaterThanOrEqual(2);
        expect(
          result.data.items.every((log) => log.actorId === targetActorId)
        ).toBe(true);
      }
    });

    it('should support pagination', async () => {
      const targetActorId = testId('paginatedActor');
      const actor = createTestActor({ userId: targetActorId });

      // Create 5 logs
      for (let i = 0; i < 5; i++) {
        await auditService.log(
          actor,
          createTestEvent({
            action: `paginated:action:${i}`,
          })
        );
      }

      const auditor = createAuditorActor();
      const result = await auditService.getActorHistory(
        auditor,
        targetActorId,
        { limit: 2 }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.items.length).toBe(2);
        expect(result.data.hasMore).toBe(true);
        expect(result.data.nextCursor).toBeDefined();

        // Get next page
        const nextResult = await auditService.getActorHistory(
          auditor,
          targetActorId,
          { limit: 2, cursor: result.data.nextCursor }
        );

        expect(nextResult.success).toBe(true);
        if (nextResult.success) {
          expect(nextResult.data.items.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
