/**
 * E2E Test Utilities
 * Helpers for full end-to-end testing with real services
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

import {
  createAuditService,
  createAuditServiceDb,
  createAuthService,
  createAuthServiceDb,
  createUserService,
  createUserServiceDb,
  createChatService,
  createChatServiceDb,
  createMemoryService,
  createMemoryServiceDb,
  createKnowledgeService,
  createKnowledgeServiceDb,
  createApprovalService,
  createApprovalServiceDb,
  createPromptService,
  createPromptServiceDb,
  createToolService,
  createToolServiceDb,
  createSubscriptionService,
  createSubscriptionServiceDb,
  createFileService,
  createFileServiceDb,
  createContextService,
  createRAGConfigService,
  createRAGConfigServiceDb,
} from '@/services/index.js';
import type {
  AuditService,
  AuthService,
  UserService,
  ChatService,
  MemoryService,
  KnowledgeService,
  ApprovalService,
  PromptService,
  ToolService,
  SubscriptionService,
  FileService,
  ContextService,
  RAGConfigService,
} from '@/services/index.js';
import type { ActorContext } from '@/types/index.js';

/**
 * All wired services for E2E testing
 */
export interface E2EServices {
  auditService: AuditService;
  authService: AuthService;
  userService: UserService;
  chatService: ChatService;
  memoryService: MemoryService;
  knowledgeService: KnowledgeService;
  approvalService: ApprovalService;
  promptService: PromptService;
  toolService: ToolService;
  subscriptionService: SubscriptionService;
  fileService: FileService;
  contextService: ContextService;
  ragConfigService: RAGConfigService;
}

/**
 * Create a Supabase client for E2E tests
 */
export function createE2ESupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_KEY required for E2E tests'
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient(url, key) as SupabaseClient<any, 'public', any>;
}

/**
 * Wire all services together for E2E testing
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createE2EServices(
  supabase: SupabaseClient<any, 'public', any>
): E2EServices {
  // Create all database adapters
  const auditDb = createAuditServiceDb(supabase);
  const authDb = createAuthServiceDb(supabase);
  const userDb = createUserServiceDb(supabase);
  const chatDb = createChatServiceDb(supabase);
  const memoryDb = createMemoryServiceDb(supabase);
  const knowledgeDb = createKnowledgeServiceDb(supabase);
  const approvalDb = createApprovalServiceDb(supabase);
  const promptDb = createPromptServiceDb(supabase);
  const toolDb = createToolServiceDb(supabase);
  const subscriptionDb = createSubscriptionServiceDb(supabase);
  const fileDb = createFileServiceDb(supabase);
  const ragConfigDb = createRAGConfigServiceDb(supabase);

  // Create services with dependencies
  const auditService = createAuditService({ db: auditDb });

  const authService = createAuthService({
    db: authDb,
    auditService: { log: (...args) => auditService.log(...args) },
  });

  const userService = createUserService({
    db: userDb,
    auditService: { log: (...args) => auditService.log(...args) },
  });

  const subscriptionService = createSubscriptionService({
    db: subscriptionDb,
    auditService: { log: (...args) => auditService.log(...args) },
  });

  const approvalService = createApprovalService({
    db: approvalDb,
    auditService: { log: (...args) => auditService.log(...args) },
  });

  const chatService = createChatService({
    db: chatDb,
    auditService: { log: (...args) => auditService.log(...args) },
  });

  const memoryService = createMemoryService({
    db: memoryDb,
    auditService: { log: (...args) => auditService.log(...args) },
  });

  const knowledgeService = createKnowledgeService({
    db: knowledgeDb,
    auditService: { log: (...args) => auditService.log(...args) },
    approvalService: {
      createRequest: (...args) => approvalService.createRequest(...args),
    },
  });

  const promptService = createPromptService({
    db: promptDb,
    auditService: { log: (...args) => auditService.log(...args) },
  });

  const toolService = createToolService({
    db: toolDb,
    auditService: { log: (...args) => auditService.log(...args) },
    subscriptionService: {
      checkEntitlement: (...args) =>
        subscriptionService.checkEntitlement(...args),
    },
  });

  const fileService = createFileService({
    db: fileDb,
    auditService: { log: (...args) => auditService.log(...args) },
    subscriptionService: {
      checkEntitlement: (...args) =>
        subscriptionService.checkEntitlement(...args),
    },
  });

  const ragConfigService = createRAGConfigService({
    db: ragConfigDb,
    auditService: { log: (...args) => auditService.log(...args) },
  });

  const contextService = createContextService({
    userService: {
      getAIPreferences: (...args) => userService.getAIPreferences(...args),
    },
    chatService: {
      getChat: (...args) => chatService.getChat(...args),
      getMessages: async (actor, chatId, params) => {
        const result = await chatService.getMessages(actor, chatId, params);
        if (!result.success) {
          return result;
        }
        // Transform PaginatedResult<Message> to { items: ... }
        return {
          success: true,
          data: {
            items: result.data.items.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
            })),
          },
        };
      },
      addMessage: async (actor, chatId, params) => {
        // Transform 3-arg call to 2-arg ChatService signature
        const result = await chatService.addMessage(actor, {
          chatId,
          role: params.role,
          content: params.content,
          metadata: params.metadata,
        });
        if (!result.success) {
          return result;
        }
        return { success: true, data: { id: result.data.id } };
      },
    },
    memoryService: {
      searchMemories: (actor, params) =>
        memoryService.searchMemories(actor, params.userId, {
          query: params.query,
          limit: params.limit,
        }),
    },
    knowledgeService: {
      searchKnowledge: async (actor, params) => {
        const result = await knowledgeService.searchKnowledge(actor, params);
        if (!result.success) {
          return result;
        }
        // Transform KnowledgeSearchResult[] to expected format
        return {
          success: true,
          data: result.data.map((r) => ({
            title: r.item.title,
            content: r.chunk, // Use chunk for content (truncated)
            similarity: r.similarity,
          })),
        };
      },
    },
    promptService: {
      getActivePrompt: (...args) => promptService.getActivePrompt(...args),
    },
    toolService: {
      listAvailableTools: async (actor) => {
        const result = await toolService.listAvailableTools(actor);
        if (!result.success) {
          return result;
        }
        // Transform Tool[] to { items: ToolDefinition[] }
        return {
          success: true,
          data: {
            items: result.data.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          },
        };
      },
    },
    ragConfigService: {
      getActiveConfig: (...args) => ragConfigService.getActiveConfig(...args),
    },
  });

  return {
    auditService,
    authService,
    userService,
    chatService,
    memoryService,
    knowledgeService,
    approvalService,
    promptService,
    toolService,
    subscriptionService,
    fileService,
    contextService,
    ragConfigService,
  };
}

/**
 * Generate a unique test ID with prefix
 */
export function testId(prefix: string): string {
  return `e2e_${prefix}_${nanoid(8)}`;
}

/**
 * Create a user actor context for testing
 */
export function createUserActor(userId: string): ActorContext {
  return {
    type: 'user',
    userId,
    requestId: testId('req'),
    permissions: [
      'chat:read',
      'chat:write',
      'memory:read',
      'memory:write',
      'knowledge:read',
      'knowledge:write',
      'tool:read',
      'tool:execute',
      'rag:read',
      'rag:write',
      'user:read',
      'user:write',
    ],
  };
}

/**
 * Create an admin actor context for testing
 */
export function createAdminActor(userId?: string): ActorContext {
  return {
    type: 'admin',
    userId: userId ?? testId('admin'),
    requestId: testId('req'),
    permissions: ['admin:*', 'approval:*'],
  };
}

/**
 * Create a system actor context for testing
 */
export function createSystemActor(): ActorContext {
  return {
    type: 'system',
    userId: 'system',
    requestId: testId('req'),
    permissions: ['system:*'],
  };
}

/**
 * Test data cleanup helper
 */
export class E2ECleanup {
  private userIds: string[] = [];
  private chatIds: string[] = [];
  private knowledgeIds: string[] = [];
  private approvalIds: string[] = [];
  private memoryIds: string[] = [];

  trackUser(id: string): void {
    this.userIds.push(id);
  }

  trackChat(id: string): void {
    this.chatIds.push(id);
  }

  trackKnowledge(id: string): void {
    this.knowledgeIds.push(id);
  }

  trackApproval(id: string): void {
    this.approvalIds.push(id);
  }

  trackMemory(id: string): void {
    this.memoryIds.push(id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async cleanup(supabase: SupabaseClient<any, 'public', any>): Promise<void> {
    // Delete in reverse dependency order
    for (const id of this.approvalIds) {
      await supabase.from('approval_requests').delete().eq('id', id);
    }

    for (const id of this.memoryIds) {
      await supabase.from('memories').delete().eq('id', id);
    }

    for (const id of this.knowledgeIds) {
      await supabase.from('knowledge_items').delete().eq('id', id);
    }

    for (const id of this.chatIds) {
      await supabase.from('messages').delete().eq('chat_id', id);
      await supabase.from('chats').delete().eq('id', id);
    }

    for (const id of this.userIds) {
      await supabase.from('ai_preferences').delete().eq('user_id', id);
      await supabase.from('profiles').delete().eq('user_id', id);
      await supabase.from('users').delete().eq('id', id);
    }
  }
}

/**
 * Check if E2E credentials are available
 */
export function hasE2ECredentials(): boolean {
  return (
    process.env.SUPABASE_URL !== undefined &&
    process.env.SUPABASE_URL !== '' &&
    process.env.SUPABASE_SERVICE_KEY !== undefined &&
    process.env.SUPABASE_SERVICE_KEY !== ''
  );
}

/**
 * Check if LLM credentials are available
 */
export function hasLLMCredentials(): boolean {
  return (
    process.env.OPENROUTER_API_KEY !== undefined &&
    process.env.OPENROUTER_API_KEY !== ''
  );
}
