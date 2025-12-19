/**
 * Service Layer Exports
 * Phase 2 will implement these services following Stage 2 design
 *
 * Services are the ONLY gateway to the database.
 * All business logic lives here.
 */

// AuthService - Phase 2
export type { AuthService, AuthServiceDb } from './auth.service.js';
export { createAuthService } from './auth.service.js';
export { createAuthServiceDb } from './auth.db.js';

// AuditService - Phase 2
export type { AuditService, AuditServiceDb } from './audit.service.js';
export { createAuditService } from './audit.service.js';
export { createAuditServiceDb } from './audit.db.js';

// UserService - Phase 2
export type {
  UserService,
  UserServiceDb,
  UserServiceAudit,
} from './user.service.js';
export { createUserService } from './user.service.js';
export { createUserServiceDb } from './user.db.js';

// ChatService - Phase 2
export type {
  ChatService,
  ChatServiceDb,
  ChatServiceAudit,
} from './chat.service.js';
export { createChatService } from './chat.service.js';
export { createChatServiceDb } from './chat.db.js';

// MemoryService - Phase 2
export type {
  MemoryService,
  MemoryServiceDb,
  MemoryServiceAudit,
} from './memory.service.js';
export { createMemoryService } from './memory.service.js';
export { createMemoryServiceDb } from './memory.db.js';

// FileService - Phase 2
export type {
  FileService,
  FileServiceDb,
  FileServiceAudit,
  FileServiceStorage,
  FileServiceSubscription,
} from './file.service.js';
export { createFileService } from './file.service.js';
export { createFileServiceDb } from './file.db.js';

// SubscriptionService - Phase 2
export type {
  SubscriptionService,
  SubscriptionServiceDb,
  SubscriptionServiceAudit,
} from './subscription.service.js';
export { createSubscriptionService } from './subscription.service.js';
export { createSubscriptionServiceDb } from './subscription.db.js';

// ApprovalService - Phase 2
export type {
  ApprovalService,
  ApprovalServiceDb,
  ApprovalServiceAudit,
  PaginatedApprovalRequests,
  ListPendingParams,
} from './approval.service.js';
export { createApprovalService } from './approval.service.js';
export { createApprovalServiceDb } from './approval.db.js';

// ToolService - Phase 2
export type {
  ToolService,
  ToolServiceDb,
  ToolServiceAudit,
  ToolServiceSubscription,
} from './tool.service.js';
export { createToolService } from './tool.service.js';
export { createToolServiceDb } from './tool.db.js';

// KnowledgeService - Phase 2
export type {
  KnowledgeService,
  KnowledgeServiceDb,
  KnowledgeServiceAudit,
  KnowledgeServiceApproval,
} from './knowledge.service.js';
export { createKnowledgeService } from './knowledge.service.js';
export { createKnowledgeServiceDb } from './knowledge.db.js';

// PromptService - Phase 2
export type {
  PromptService,
  PromptServiceDb,
  PromptServiceAudit,
  PromptVersion,
} from './prompt.service.js';
export { createPromptService } from './prompt.service.js';
export { createPromptServiceDb } from './prompt.db.js';

// ContextService - Phase 2
export type {
  ContextService,
  ContextServiceUserDep,
  ContextServiceChatDep,
  ContextServiceMemoryDep,
  ContextServiceKnowledgeDep,
  ContextServicePromptDep,
  ContextServiceToolDep,
  ContextServiceRAGConfigDep,
} from './context.service.js';
export { createContextService } from './context.service.js';

// RAGConfigService - Phase 5
export type {
  RAGConfigService,
  RAGConfigServiceDb,
  RAGConfigServiceAudit,
} from './rag-config.service.js';
export { createRAGConfigService } from './rag-config.service.js';
export { createRAGConfigServiceDb } from './rag-config.db.js';

// EmbeddingService - Phase 5 RAG
export type {
  EmbeddingService,
  EmbeddingServiceClient,
  ChunkedEmbeddingResult,
} from './embedding.service.js';
export {
  createEmbeddingService,
  createOpenRouterEmbeddingClient,
} from './embedding.service.js';

// Export services as they are implemented
// export { UserService } from './user.service.js';
// export { OrganizationService } from './organization.service.js';
// export { ChatService } from './chat.service.js';
// export { MemoryService } from './memory.service.js';
// export { KnowledgeService } from './knowledge.service.js';
// export { ToolService } from './tool.service.js';
// export { SubscriptionService } from './subscription.service.js';
