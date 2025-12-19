/**
 * Core type definitions for Bakame
 * This file exports all shared types used across the application
 */

export type { Result, Success, Failure } from './result.js';
export { success, failure, isSuccess, isFailure } from './result.js';
export type {
  ServiceContext,
  SystemContext,
  MemoryContext,
  KnowledgeContext,
  MessageContext,
  UserPreferencesContext,
  AIContext,
  ToolCallResult,
  AIResponse,
  BuildContextParams,
  PersistResponseParams,
} from './context.js';
export { createSystemContext } from './context.js';
export type {
  ActorContext,
  Role,
  Permission,
  UserRole,
  AssignRoleParams,
  RevokeRoleParams,
} from './auth.js';
export { SYSTEM_ACTOR, AI_ACTOR } from './auth.js';
export type { PaginationParams, PaginatedResult } from './pagination.js';
export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  normalizePaginationParams,
} from './pagination.js';
export type {
  AuditActorType,
  AuditEvent,
  AuditLog,
  AuditQueryParams,
} from './audit.js';
export type {
  User,
  UserStatus,
  Profile,
  ProfileUpdate,
  AIPreferences,
  ResponseLength,
  Formality,
  AIPreferencesUpdate,
  UserSignupParams,
  ListUsersParams,
} from './user.js';
export type {
  Chat,
  ChatStatus,
  ChatSummary,
  ChatUpdate,
  CreateChatParams,
  ListChatsParams,
  Message,
  MessageRole,
  MessageMetadata,
  ToolCall,
  AddMessageParams,
  GetMessagesParams,
} from './chat.js';
export type {
  Memory,
  MemorySource,
  MemoryStatus,
  CreateMemoryParams,
  MemoryUpdate,
  ListMemoriesParams,
  SearchMemoriesParams,
  MemorySearchResult,
  MemoryVector,
} from './memory.js';
export type {
  File,
  FileStatus,
  InitiateUploadParams,
  UploadInitiation,
  DownloadUrl,
  ListFilesParams,
  StorageUsage,
} from './file.js';
export type {
  SubscriptionStatus,
  EntitlementValue,
  Entitlement,
  Plan,
  Subscription,
  UsageLimitCheck,
  UsageSummary,
  UsageRecord,
  CreateSubscriptionParams,
  RecordUsageParams,
  GetUsageSummaryParams,
} from './subscription.js';
export type {
  ApprovalResourceType,
  ApprovalAction,
  ApprovalStatus,
  ApprovalRequest,
  CreateApprovalRequestParams,
  ListPendingRequestsParams,
} from './approval.js';
export type {
  ToolType,
  ToolStatus,
  InvocationStatus,
  ToolCost,
  ToolDefinition,
  Tool,
  ToolUpdate,
  ToolInvocation,
  LogInvocationStartParams,
  InvocationStartResult,
  LogInvocationCompleteParams,
  ListInvocationsParams,
  CanInvokeResult,
} from './tool.js';
export type {
  KnowledgeStatus,
  KnowledgeItem,
  CreateKnowledgeItemParams,
  KnowledgeItemUpdate,
  ListKnowledgeItemsParams,
  KnowledgeSearchResult,
  KnowledgeVersion,
  SearchKnowledgeParams,
} from './knowledge.js';
export type {
  PromptStatus,
  SystemPrompt,
  CreatePromptParams,
  PromptUpdate,
  ListPromptsParams,
} from './prompt.js';
export type {
  LLMMessage,
  LLMToolCall,
  LLMRequest,
  LLMToolDefinition,
  LLMResponse,
  LLMStreamChunk,
  LLMClient,
  OrchestratorConfig,
  BaseStreamEvent,
  MessageStartEvent,
  MessageDeltaEvent,
  MessageCompleteEvent,
  ToolStartEvent,
  ToolCompleteEvent,
  ErrorEvent,
  DoneEvent,
  StreamEvent,
  OrchestratorInput,
  OrchestratorResult,
  PromptBuilderInput,
  PromptBuilderOutput,
  ToolExecutionResult,
  ToolExecutor,
} from './orchestrator.js';
export { DEFAULT_ORCHESTRATOR_CONFIG } from './orchestrator.js';
export type {
  MemoryCategory,
  RAGConfig,
  CreateRAGConfigParams,
  RAGConfigUpdate,
  ListRAGConfigsParams,
} from './rag-config.js';
export { DEFAULT_RAG_CONFIG } from './rag-config.js';
export type {
  EmbeddingConfig,
  EmbeddingResult,
  BatchEmbeddingResult,
  ChunkingOptions,
  TextChunk,
} from './embedding.js';
export { DEFAULT_EMBEDDING_CONFIG } from './embedding.js';
