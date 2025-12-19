# Bakame AI Backend Architecture

> A comprehensive guide to the Bakame AI platform architecture, designed for new developers onboarding to the project.

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Service Layer](#2-service-layer)
3. [AI Orchestrator](#3-ai-orchestrator)
4. [Tool Execution](#4-tool-execution)
5. [Database Schema](#5-database-schema)
6. [Actor Pattern](#6-actor-pattern)
7. [RAG Pipeline](#7-rag-pipeline)

---

## 1. System Architecture

### 1.1 High-Level Architecture Diagram

```
+------------------------------------------------------------------+
|                         CLIENT LAYER                              |
|    (Web App / Mobile App / API Consumers)                        |
+------------------------------------------------------------------+
                                |
                                | HTTP/SSE
                                v
+------------------------------------------------------------------+
|                          API LAYER                                |
|    REST Endpoints / SSE Streaming / Authentication               |
+------------------------------------------------------------------+
                                |
                                v
+------------------------------------------------------------------+
|                       SERVICE LAYER                               |
|  +------------+  +------------+  +------------+  +------------+  |
|  | AuthService|  |UserService |  |ChatService |  |MemoryServ. |  |
|  +------------+  +------------+  +------------+  +------------+  |
|  +------------+  +------------+  +------------+  +------------+  |
|  |KnowledgeSv.|  |ApprovalSv. |  |PromptServ. |  |ToolService |  |
|  +------------+  +------------+  +------------+  +------------+  |
|  +------------+  +------------+  +------------+  +------------+  |
|  |Subscript.Sv|  |FileService |  |ContextServ.|  |RAGConfigSv.|  |
|  +------------+  +------------+  +------------+  +------------+  |
|  +------------+  +------------+                                  |
|  |EmbeddingSv.|  |AuditService|                                  |
|  +------------+  +------------+                                  |
+------------------------------------------------------------------+
                                |
          +---------------------+---------------------+
          |                     |                     |
          v                     v                     v
+----------------+   +-------------------+   +------------------+
|  AI ORCHESTRATOR|   |  TOOL EXECUTOR   |   |   DATABASE       |
|  - PromptBuilder|   |  - Local Tools   |   |   (Supabase/     |
|  - ToolLoop     |   |  - MCP Client    |   |    PostgreSQL)   |
|  - LLM Client   |   |  - n8n Workflows |   |                  |
+----------------+   +-------------------+   +------------------+
         |                    |
         v                    v
+----------------+   +-------------------+
|   OpenRouter   |   |  External Tools   |
|   (LLM API)    |   |  - MCP Servers    |
+----------------+   |  - n8n Webhooks   |
                     +-------------------+
```

### 1.2 Request Flow

```
User Request --> API Layer --> Service Layer --> Database
                     |
                     +--> Orchestrator --> LLM (OpenRouter)
                              |
                              +--> Tool Executor --> External Tools
                              |
                              +--> Context Service --> Assemble Context
                                       |
                                       +--> Memory Search
                                       +--> Knowledge Search (RAG)
                                       +--> User Preferences
                                       +--> System Prompt
```

### 1.3 Core Design Principles

| Principle | Description |
|-----------|-------------|
| **Backend-first** | Database and governance define everything |
| **Service Gateway** | All data access goes through services |
| **AI Isolation** | AI never talks to the database directly |
| **Admins are Users** | No hardcoded admin power |
| **Auditable** | All privileged actions are logged |
| **AI as Orchestrator** | AI coordinates, services execute |
| **Stateless Tools** | Tools are deterministic and stateless |
| **Explicit Personalization** | No silent inference |
| **Layered Prompts** | Immutable core with governed layers |
| **Design for Replacement** | Models, tools swappable |

---

## 2. Service Layer

The service layer is the **only gateway to the database**. All business logic lives here.

### 2.1 Service Overview

| Service | Owns Tables | Dependencies |
|---------|-------------|--------------|
| AuditService | `audit_logs` | None (lowest level) |
| AuthService | `permissions`, `roles`, `role_permissions`, `user_roles` | AuditService |
| UserService | `users`, `profiles`, `ai_preferences` | AuditService |
| ChatService | `chats`, `messages` | AuditService |
| MemoryService | `memories`, `memory_vectors` | AuditService |
| KnowledgeService | `knowledge_items`, `knowledge_versions` | AuditService, ApprovalService |
| ApprovalService | `approval_requests` | AuditService |
| PromptService | `system_prompts` | AuditService |
| ToolService | `tools`, `tool_invocations` | AuditService, SubscriptionService |
| SubscriptionService | `plans`, `subscriptions`, `entitlements`, `usage` | AuditService |
| FileService | `files` | AuditService, SubscriptionService |
| ContextService | None (read-only aggregator) | All above services |
| RAGConfigService | `rag_configs` | AuditService |
| EmbeddingService | None (external API) | None |

### 2.2 AuditService

**Purpose**: Immutable audit logging for compliance and debugging.

**File**: `/home/bahati/bakamev2/src/services/audit.service.ts`

**Key Methods**:
```typescript
interface AuditService {
  // Log a single audit event (no permission check - all services can log)
  log(actor: ActorContext, event: AuditEvent): Promise<Result<void>>;

  // Log multiple events atomically
  logBatch(actor: ActorContext, events: AuditEvent[]): Promise<Result<void>>;

  // Query logs (requires 'audit:read' permission)
  queryLogs(actor: ActorContext, params: AuditQueryParams): Promise<Result<PaginatedResult<AuditLog>>>;

  // Get history for a specific resource
  getResourceHistory(actor: ActorContext, resourceType: string, resourceId: string): Promise<Result<AuditLog[]>>;

  // Get history for a specific actor
  getActorHistory(actor: ActorContext, targetActorId: string, params: PaginationParams): Promise<Result<PaginatedResult<AuditLog>>>;
}
```

**Guardrails**:
- Audit logs are IMMUTABLE (no update/delete)
- Database triggers prevent modification
- Writing requires no permission (defense in depth)
- Reading requires `audit:read` permission

### 2.3 AuthService

**Purpose**: Authentication and authorization decisions.

**File**: `/home/bahati/bakamev2/src/services/auth.service.ts`

**Key Methods**:
```typescript
interface AuthService {
  // Check single permission
  hasPermission(actor: ActorContext, permission: string): Promise<boolean>;

  // Check ALL permissions are present
  hasAllPermissions(actor: ActorContext, permissions: string[]): Promise<boolean>;

  // Check ANY permission is present
  hasAnyPermission(actor: ActorContext, permissions: string[]): Promise<boolean>;

  // Resolve permissions for a user (used to build ActorContext)
  resolvePermissions(userId: string): Promise<Result<string[]>>;

  // Assign role (requires 'role:assign')
  assignRole(actor: ActorContext, params: AssignRoleParams): Promise<Result<void>>;

  // Revoke role (requires 'role:assign')
  revokeRole(actor: ActorContext, params: RevokeRoleParams): Promise<Result<void>>;
}
```

**Authentication Flow**:
```
1. User authenticates via Supabase Auth
2. API layer extracts JWT token
3. AuthService.resolvePermissions() builds permission list
4. ActorContext created with permissions
5. All subsequent service calls use ActorContext
```

### 2.4 UserService

**Purpose**: User profiles and AI preferences management.

**File**: `/home/bahati/bakamev2/src/services/user.service.ts`

**Key Methods**:
```typescript
interface UserService {
  onUserSignup(actor: ActorContext, params: UserSignupParams): Promise<Result<User>>;
  getUser(actor: ActorContext, userId: string): Promise<Result<User>>;
  suspendUser(actor: ActorContext, userId: string, reason: string): Promise<Result<void>>;
  reactivateUser(actor: ActorContext, userId: string): Promise<Result<void>>;
  getProfile(actor: ActorContext, userId: string): Promise<Result<Profile>>;
  updateProfile(actor: ActorContext, userId: string, updates: ProfileUpdate): Promise<Result<Profile>>;
  getAIPreferences(actor: ActorContext, userId: string): Promise<Result<AIPreferences>>;
  updateAIPreferences(actor: ActorContext, userId: string, updates: AIPreferencesUpdate): Promise<Result<AIPreferences>>;
}
```

**Guardrails**:
- AI_ACTOR cannot mutate user data (read-only for context)
- Users can only access their own data (unless `user:read` permission)
- All mutations emit audit events
- Soft delete only

### 2.5 ChatService

**Purpose**: Conversation and message management.

**File**: `/home/bahati/bakamev2/src/services/chat.service.ts`

**Key Methods**:
```typescript
interface ChatService {
  createChat(actor: ActorContext, params: CreateChatParams): Promise<Result<Chat>>;
  getChat(actor: ActorContext, chatId: string): Promise<Result<Chat>>;
  listChats(actor: ActorContext, params: ListChatsParams): Promise<Result<PaginatedResult<ChatSummary>>>;
  updateChat(actor: ActorContext, chatId: string, updates: ChatUpdate): Promise<Result<Chat>>;
  archiveChat(actor: ActorContext, chatId: string): Promise<Result<void>>;
  addMessage(actor: ActorContext, params: AddMessageParams): Promise<Result<Message>>;
  getMessages(actor: ActorContext, chatId: string, params: GetMessagesParams): Promise<Result<PaginatedResult<Message>>>;
  redactMessage(actor: ActorContext, messageId: string, reason: string): Promise<Result<void>>;
}
```

**Critical Policy**: Messages are **IMMUTABLE** (append-only)
- No `updateMessage` method
- No `deleteMessage` method
- Redaction = soft delete (metadata.redacted = true)

**AI Access**:
- AI_ACTOR CAN read chats/messages (context assembly)
- AI_ACTOR CAN add messages (assistant responses)
- AI_ACTOR CANNOT create/update/archive chats
- AI_ACTOR CANNOT redact messages

### 2.6 MemoryService

**Purpose**: Long-term user memory management for personalization.

**File**: `/home/bahati/bakamev2/src/services/memory.service.ts`

**Key Methods**:
```typescript
interface MemoryService {
  createMemory(actor: ActorContext, params: CreateMemoryParams): Promise<Result<Memory>>;
  getMemory(actor: ActorContext, memoryId: string): Promise<Result<Memory>>;
  listMemories(actor: ActorContext, userId: string, params: ListMemoriesParams): Promise<Result<PaginatedResult<Memory>>>;
  updateMemory(actor: ActorContext, memoryId: string, updates: MemoryUpdate): Promise<Result<Memory>>;
  archiveMemory(actor: ActorContext, memoryId: string): Promise<Result<void>>;
  deleteMemory(actor: ActorContext, memoryId: string): Promise<Result<void>>;
  searchMemories(actor: ActorContext, userId: string, params: SearchMemoriesParams): Promise<Result<MemorySearchResult[]>>;
  archiveInactiveMemories(actor: ActorContext): Promise<Result<{ archivedCount: number }>>;
  reembedUserMemories(actor: ActorContext, userId: string, newModel: string): Promise<Result<{ processedCount: number }>>;
}
```

**Memory Retention Policy**:
- Default retention: Indefinite
- Auto-archive: After 180 days of no access
- Auto-delete: Never (user must explicitly delete)
- User override: Always allowed

**AI-Agnostic Principle**: Embedding generation is scheduled asynchronously, not synchronous.

### 2.7 KnowledgeService

**Purpose**: RAG knowledge base management with governance.

**File**: `/home/bahati/bakamev2/src/services/knowledge.service.ts`

**Key Methods**:
```typescript
interface KnowledgeService {
  createItem(actor: ActorContext, params: CreateKnowledgeItemParams): Promise<Result<KnowledgeItem>>;
  getItem(actor: ActorContext, itemId: string): Promise<Result<KnowledgeItem>>;
  updateItem(actor: ActorContext, itemId: string, updates: KnowledgeItemUpdate): Promise<Result<KnowledgeItem>>;
  submitForReview(actor: ActorContext, itemId: string): Promise<Result<void>>;
  publishItem(actor: ActorContext, itemId: string): Promise<Result<void>>;
  searchKnowledge(actor: ActorContext, params: SearchKnowledgeParams): Promise<Result<KnowledgeSearchResult[]>>;
}
```

**Governance Flow**:
```
draft --> pending_review --> published
          (requires approval)
```

### 2.8 ApprovalService

**Purpose**: Content approval workflow for knowledge and prompts.

**File**: `/home/bahati/bakamev2/src/services/approval.service.ts`

**Key Methods**:
```typescript
interface ApprovalService {
  createRequest(actor: ActorContext, params: CreateApprovalRequestParams): Promise<Result<ApprovalRequest>>;
  approveRequest(actor: ActorContext, requestId: string, comment?: string): Promise<Result<void>>;
  rejectRequest(actor: ActorContext, requestId: string, reason: string): Promise<Result<void>>;
  listPendingRequests(actor: ActorContext, params: ListPendingRequestsParams): Promise<Result<PaginatedApprovalRequests>>;
}
```

### 2.9 PromptService

**Purpose**: System prompt management with versioning.

**File**: `/home/bahati/bakamev2/src/services/prompt.service.ts`

**Key Methods**:
```typescript
interface PromptService {
  createPrompt(actor: ActorContext, params: CreatePromptParams): Promise<Result<SystemPrompt>>;
  getPrompt(actor: ActorContext, promptId: string): Promise<Result<SystemPrompt>>;
  getActivePrompt(actor: ActorContext): Promise<Result<SystemPrompt>>;
  updatePrompt(actor: ActorContext, promptId: string, updates: PromptUpdate): Promise<Result<SystemPrompt>>;
  activatePrompt(actor: ActorContext, promptId: string): Promise<Result<void>>;
  listPrompts(actor: ActorContext, params: ListPromptsParams): Promise<Result<PaginatedResult<SystemPrompt>>>;
}
```

### 2.10 ToolService

**Purpose**: Tool registry and invocation tracking.

**File**: `/home/bahati/bakamev2/src/services/tool.service.ts`

**Key Methods**:
```typescript
interface ToolService {
  registerTool(actor: ActorContext, definition: ToolDefinition): Promise<Result<Tool>>;
  getTool(actor: ActorContext, toolId: string): Promise<Result<Tool>>;
  listAvailableTools(actor: ActorContext): Promise<Result<{ items: ToolDefinition[] }>>;
  canInvokeTool(actor: ActorContext, toolName: string): Promise<Result<CanInvokeResult>>;
  logInvocationStart(actor: ActorContext, params: LogInvocationStartParams): Promise<Result<InvocationStartResult>>;
  logInvocationComplete(actor: ActorContext, params: LogInvocationCompleteParams): Promise<Result<void>>;
}
```

### 2.11 SubscriptionService

**Purpose**: Usage tracking and limits enforcement.

**File**: `/home/bahati/bakamev2/src/services/subscription.service.ts`

**Key Methods**:
```typescript
interface SubscriptionService {
  createSubscription(actor: ActorContext, params: CreateSubscriptionParams): Promise<Result<Subscription>>;
  getSubscription(actor: ActorContext, userId: string): Promise<Result<Subscription>>;
  checkLimit(actor: ActorContext, userId: string, entitlementKey: string): Promise<Result<UsageLimitCheck>>;
  recordUsage(actor: ActorContext, params: RecordUsageParams): Promise<Result<void>>;
  getUsageSummary(actor: ActorContext, params: GetUsageSummaryParams): Promise<Result<UsageSummary>>;
}
```

### 2.12 FileService

**Purpose**: File upload management with storage.

**File**: `/home/bahati/bakamev2/src/services/file.service.ts`

**Key Methods**:
```typescript
interface FileService {
  initiateUpload(actor: ActorContext, params: InitiateUploadParams): Promise<Result<UploadInitiation>>;
  confirmUpload(actor: ActorContext, fileId: string): Promise<Result<File>>;
  getFile(actor: ActorContext, fileId: string): Promise<Result<File>>;
  getDownloadUrl(actor: ActorContext, fileId: string): Promise<Result<DownloadUrl>>;
  deleteFile(actor: ActorContext, fileId: string): Promise<Result<void>>;
  listFiles(actor: ActorContext, params: ListFilesParams): Promise<Result<PaginatedResult<File>>>;
  getStorageUsage(actor: ActorContext, userId: string): Promise<Result<StorageUsage>>;
}
```

### 2.13 ContextService

**Purpose**: AI context assembly - bridge between services and orchestrator.

**File**: `/home/bahati/bakamev2/src/services/context.service.ts`

**Key Methods**:
```typescript
interface ContextService {
  buildContext(actor: ActorContext, params: BuildContextParams): Promise<Result<AIContext>>;
  getAvailableTools(actor: ActorContext): Promise<Result<ToolDefinition[]>>;
  persistResponse(actor: ActorContext, params: PersistResponseParams): Promise<Result<void>>;
}
```

**Context Assembly**:
```
buildContext() assembles:
1. Core instructions (immutable safety rules)
2. System prompt (from PromptService)
3. User preferences (from UserService)
4. Memories (from MemoryService - semantic search)
5. Knowledge (from KnowledgeService - RAG)
6. Messages (from ChatService - conversation history)
7. Tools (from ToolService)
```

**Critical Pattern**: Uses `SYSTEM_ACTOR` for writes to avoid giving AI_ACTOR permissions.

### 2.14 RAGConfigService

**Purpose**: Admin-configurable RAG retrieval settings.

**File**: `/home/bahati/bakamev2/src/services/rag-config.service.ts`

**Key Methods**:
```typescript
interface RAGConfigService {
  createConfig(actor: ActorContext, params: CreateRAGConfigParams): Promise<Result<RAGConfig>>;
  getConfig(actor: ActorContext, configId: string): Promise<Result<RAGConfig>>;
  getActiveConfig(actor: ActorContext): Promise<Result<RAGConfig>>;
  updateConfig(actor: ActorContext, configId: string, updates: RAGConfigUpdate): Promise<Result<RAGConfig>>;
  activateConfig(actor: ActorContext, configId: string): Promise<Result<RAGConfig>>;
  deactivateConfig(actor: ActorContext, configId: string): Promise<Result<RAGConfig>>;
  deleteConfig(actor: ActorContext, configId: string): Promise<Result<void>>;
}
```

**RAG Configuration Options**:
```typescript
interface RAGConfig {
  memoryLimit: number;          // Max memories to retrieve
  knowledgeLimit: number;       // Max knowledge chunks
  memoryTokenBudget: number;    // Token budget for memories
  knowledgeTokenBudget: number; // Token budget for knowledge
  conversationTokenBudget: number; // Token budget for history
  minSimilarity: number;        // Minimum similarity threshold
  importanceWeight: number;     // Weight for importance scoring
  similarityWeight: number;     // Weight for similarity scoring
  recencyWeight: number;        // Weight for recency scoring
}
```

### 2.15 EmbeddingService

**Purpose**: Vector embedding generation for semantic search.

**File**: `/home/bahati/bakamev2/src/services/embedding.service.ts`

**Key Methods**:
```typescript
interface EmbeddingService {
  generateEmbedding(text: string, config?: EmbeddingConfig): Promise<Result<EmbeddingResult>>;
  generateBatchEmbeddings(texts: string[], config?: EmbeddingConfig): Promise<Result<BatchEmbeddingResult>>;
  chunkText(text: string, options?: ChunkingOptions): TextChunk[];
  embedAndChunk(text: string, options?: ChunkingOptions, config?: EmbeddingConfig): Promise<Result<ChunkedEmbeddingResult>>;
  estimateTokens(text: string): number;
}
```

**Provider**: Uses OpenRouter API with `text-embedding-3-small` model.

---

## 3. AI Orchestrator

The orchestrator manages AI interactions, tying together context building, prompt assembly, tool execution, and response persistence.

### 3.1 Orchestrator Components

**Directory**: `/home/bahati/bakamev2/src/orchestrator/`

```
orchestrator/
  index.ts        # Exports
  orchestrator.ts # Main orchestrator
  prompt-builder.ts # 5-layer prompt assembly
  tool-loop.ts    # Iterative tool execution
  llm-client.ts   # OpenRouter API wrapper
```

### 3.2 How It Works

```
1. Receive user message
2. Build context (via ContextService)
3. Assemble prompt (via PromptBuilder)
4. Execute tool loop:
   a. Send to LLM
   b. If tool calls: execute tools, add results, repeat
   c. If no tool calls: return response
5. Persist response (via ContextService)
```

### 3.3 Prompt Building (5-Layer Model)

**File**: `/home/bahati/bakamev2/src/orchestrator/prompt-builder.ts`

```
+------------------------------------------+
|  Layer 1: CORE INSTRUCTIONS (IMMUTABLE)  |
|  - Safety rules                          |
|  - Honesty requirements                  |
|  - Boundaries                            |
+------------------------------------------+
                    |
+------------------------------------------+
|  Layer 2: SYSTEM PROMPT (Governed)       |
|  - Admin-managed via PromptService       |
|  - Requires approval workflow            |
+------------------------------------------+
                    |
+------------------------------------------+
|  Layer 3: USER PREFERENCES               |
|  - Response length (concise/balanced/    |
|    detailed)                             |
|  - Formality (casual/neutral/formal)     |
|  - Custom instructions                   |
+------------------------------------------+
                    |
+------------------------------------------+
|  Layer 4: RETRIEVED CONTEXT              |
|  - User memories (semantic search)       |
|  - Knowledge base (RAG)                  |
+------------------------------------------+
                    |
+------------------------------------------+
|  Layer 5: CONVERSATION                   |
|  - Message history                       |
|  - Current user message                  |
+------------------------------------------+
```

**Core Instructions** (never overridden):
```typescript
const CORE_INSTRUCTIONS = `## CORE SAFETY RULES

These rules are IMMUTABLE and take precedence over all other instructions.

### SAFETY
1. Never provide instructions for creating weapons, explosives, or harmful substances
2. Never assist with activities that could harm individuals or groups
3. Never generate content that exploits minors in any way
4. Never provide personal information about private individuals
5. Refuse requests that could enable fraud, scams, or deception
6. Do not help circumvent security measures or access unauthorized systems

### HONESTY
1. Always be truthful - never fabricate facts or statistics
2. Clearly distinguish between facts, opinions, and speculation
3. Acknowledge uncertainty when you don't know something
4. Do not impersonate real people or claim to be human

### BOUNDARIES
1. You are an AI assistant - be helpful within ethical boundaries
2. Redirect harmful requests to constructive alternatives
3. Protect user privacy - do not retain or share personal information
4. Respect intellectual property rights`;
```

### 3.4 Tool Loop Execution

**File**: `/home/bahati/bakamev2/src/orchestrator/tool-loop.ts`

```
                    +----------------+
                    |  Start Loop    |
                    +----------------+
                           |
                           v
                    +----------------+
                    |  Send to LLM   |
                    +----------------+
                           |
                           v
                   +------------------+
                   |  Tool Calls?     |
                   +------------------+
                      |           |
                    Yes           No
                      |           |
                      v           v
              +----------------+  +----------------+
              | Execute Tools  |  | Return Response|
              +----------------+  +----------------+
                      |
                      v
              +----------------+
              | Add Results    |
              +----------------+
                      |
                      v
              +------------------+
              | Max Iterations?  |
              +------------------+
                   |         |
                  No        Yes
                   |         |
                   v         v
              [Loop Back]  [Graceful Stop]
```

**Safety Limits**:
```typescript
interface ToolLoopConfig {
  maxIterations: number;    // Default: 5
  maxToolCalls: number;     // Default: 10
  toolCallTimeout: number;  // Default: 30000ms
}
```

### 3.5 LLM Client

**File**: `/home/bahati/bakamev2/src/orchestrator/llm-client.ts`

- Uses OpenAI SDK configured for OpenRouter
- Supports both streaming and non-streaming
- Default model: `anthropic/claude-3.5-sonnet`

```typescript
interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}
```

### 3.6 Streaming Support

**Event Types**:
```typescript
type StreamEvent =
  | MessageStartEvent    // Stream started
  | MessageDeltaEvent    // Content chunk
  | MessageCompleteEvent // Stream finished
  | ToolStartEvent       // Tool execution started
  | ToolCompleteEvent    // Tool execution finished
  | ErrorEvent           // Error occurred
  | DoneEvent;           // Stream done
```

---

## 4. Tool Execution

### 4.1 Tool Types

| Type | Description | Implementation |
|------|-------------|----------------|
| `local` | In-process tools | Direct function call |
| `mcp` | MCP server tools | Stdio/SSE protocol |
| `n8n` | n8n workflows | Webhook invocation |

### 4.2 Tool Executor

**File**: `/home/bahati/bakamev2/src/tools/executor.ts`

```typescript
interface ToolExecutor {
  execute(
    toolName: string,
    input: Record<string, unknown>,
    context: { userId: string; chatId: string; requestId: string }
  ): Promise<ToolExecutionResult>;
}
```

**Routing Logic**:
```
1. Look up route in ToolRouteRegistry
2. Switch on route.type:
   - 'local': Execute via LocalToolRegistry
   - 'mcp': Execute via MCPClient
   - 'n8n': Execute via WorkflowClient
```

### 4.3 Local Tools (Calculator)

**File**: `/home/bahati/bakamev2/src/tools/local/calculator.ts`

**Purpose**: Safe math expression evaluation without code injection.

**Features**:
- Basic arithmetic: `+`, `-`, `*`, `/`, `%`
- Powers: `^`
- Functions: `sqrt`, `sin`, `cos`, `tan`, `log`, `exp`, etc.
- Constants: `pi`, `e`

**Security**:
```typescript
// Dangerous patterns blocked
const dangerousPatterns = [
  /import\b/i, /require\b/i, /eval\b/i, /function\b/i,
  /=>/, /\$/, /;/, /&&/, /\|\|/, /`/, /\[/, /\]/,
  /\{/, /\}/, /"/, /'/, /new\b/i, /this\b/i,
  /window\b/i, /global\b/i, /process\b/i,
];
```

**Usage**:
```typescript
// Tool definition
{
  name: 'calculator',
  description: 'Evaluate mathematical expressions',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string' }
    },
    required: ['expression']
  }
}

// Example
calculator({ expression: 'sqrt(16) + 2^3' })
// Returns: { expression: 'sqrt(16) + 2^3', result: 12, resultType: 'number' }
```

### 4.4 MCP Integration (Stub)

**File**: `/home/bahati/bakamev2/src/tools/mcp/client.ts`

**Current Status**: Stub implementation - returns "not configured" errors.

**Future Implementation**:
```typescript
interface MCPClient {
  callTool(serverName: string, toolName: string, input: Record<string, unknown>, timeout: number): Promise<MCPToolResult>;
  listTools(serverName: string): Promise<MCPToolInfo[]>;
  isHealthy(): boolean;
}
```

**MCP Server Configuration**:
```typescript
interface MCPServerConfig {
  command: string;    // e.g., 'npx'
  args: string[];     // e.g., ['-y', '@mcp/server-brave-search']
  env?: Record<string, string>;
}
```

### 4.5 n8n Workflow Integration (Stub)

**File**: `/home/bahati/bakamev2/src/tools/workflow/client.ts`

**Current Status**: Stub implementation - returns "not configured" errors.

**Future Implementation**:
```typescript
interface WorkflowClient {
  invoke(workflowId: string, input: Record<string, unknown>, timeout: number): Promise<WorkflowResult>;
  isHealthy(): boolean;
}
```

---

## 5. Database Schema

### 5.1 Tables Overview

```
Auth Domain:
  - permissions          # Atomic capabilities
  - roles               # Named permission collections
  - role_permissions    # Role-permission mapping
  - user_roles          # User-role assignments

Audit Domain:
  - audit_logs          # Immutable event log

User Domain:
  - users               # Identity anchor
  - profiles            # Presentation data
  - ai_preferences      # AI behavior settings

Chat Domain:
  - chats               # Conversations
  - messages            # Chat messages (append-only)

Memory Domain:
  - memories            # Long-term memories
  - memory_vectors      # Vector embeddings

File Domain:
  - files               # Uploaded files

Subscription Domain:
  - plans               # Subscription plans
  - subscriptions       # User subscriptions
  - entitlements        # Plan features
  - usage               # Usage tracking

Approval Domain:
  - approval_requests   # Governance workflow

Tool Domain:
  - tools               # Tool registry
  - tool_invocations    # Invocation logs

Knowledge Domain:
  - knowledge_items     # RAG content
  - knowledge_versions  # Version history
  - knowledge_vectors   # Vector embeddings

Prompt Domain:
  - system_prompts      # Managed prompts

RAG Config Domain:
  - rag_configs         # RAG settings
```

### 5.2 Key Relationships

```
users
  |-- profiles (1:1)
  |-- ai_preferences (1:1)
  |-- user_roles (1:N) --> roles --> role_permissions --> permissions
  |-- chats (1:N) --> messages (1:N)
  |-- memories (1:N) --> memory_vectors (1:N)
  |-- files (1:N)
  |-- subscriptions (1:1) --> plans --> entitlements

knowledge_items
  |-- knowledge_versions (1:N)
  |-- knowledge_vectors (1:N)
  |-- approval_requests (1:N)

system_prompts
  |-- approval_requests (1:N)

tools
  |-- tool_invocations (1:N)
```

### 5.3 Row Level Security (RLS)

All tables have RLS enabled. Example from `users`:

```sql
-- Users can read their own record or with user:read permission
CREATE POLICY users_read_own ON users
    FOR SELECT
    USING (
        id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'user:read'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );
```

**RLS Bypass**: Service role (used by backend) bypasses RLS.

---

## 6. Actor Pattern

### 6.1 ActorContext Types

**File**: `/home/bahati/bakamev2/src/types/auth.ts`

```typescript
interface ActorContext {
  type: 'user' | 'admin' | 'system' | 'ai' | 'anonymous';
  userId?: string;
  sessionId?: string;
  requestId: string;
  permissions: string[];
  ip?: string;
  userAgent?: string;
}
```

### 6.2 Special Actors

**SYSTEM_ACTOR**:
```typescript
const SYSTEM_ACTOR: ActorContext = {
  type: 'system',
  requestId: 'system',
  permissions: ['*'],  // Wildcard - has all permissions
};
```

**AI_ACTOR**:
```typescript
const AI_ACTOR: ActorContext = {
  type: 'ai',
  requestId: 'ai',
  permissions: [],  // EMPTY - AI has NO permissions
};
```

### 6.3 Permission System

**Permission Format**: `{resource}:{action}`

**Examples**:
- `chat:read` - Read chat messages
- `chat:write` - Write chat messages
- `memory:delete` - Delete memories
- `knowledge:publish` - Publish knowledge items
- `role:assign` - Assign roles
- `audit:read` - Read audit logs

**Wildcard**: `*` grants all permissions (SYSTEM_ACTOR only)

### 6.4 Default Roles

| Role | Permissions |
|------|-------------|
| `user` | chat:read, chat:write, memory:read, memory:write, tool:invoke |
| `editor` | user + knowledge:write, prompt:write |
| `reviewer` | editor + knowledge:review, prompt:review |
| `admin` | reviewer + knowledge:publish, prompt:activate, user:manage, role:assign |
| `auditor` | audit:read (read-only) |
| `super_admin` | ALL permissions |

### 6.5 Security Model

```
Request --> API Layer --> Resolve Permissions
                              |
                              v
                    Build ActorContext
                              |
                              v
                    Service Layer
                         |
                         v
         +---------------+---------------+
         |               |               |
    Permission      Permission      Permission
     Check 1         Check 2         Check 3
         |               |               |
         v               v               v
      SUCCESS         SUCCESS         DENIED
```

**AI Security**:
1. AI_ACTOR has NO permissions
2. AI can READ data (services explicitly allow for context)
3. AI cannot WRITE directly (must go through ContextService)
4. ContextService uses SYSTEM_ACTOR for writes
5. Writes are tagged with `metadata.actorType = 'ai'`

---

## 7. RAG Pipeline

### 7.1 Context Building Layers

```
+--------------------------------------------------+
|              USER MESSAGE                         |
+--------------------------------------------------+
                      |
                      v
+--------------------------------------------------+
|           CONTEXT SERVICE                         |
+--------------------------------------------------+
         |                    |                    |
         v                    v                    v
+----------------+   +----------------+   +----------------+
| MEMORY SERVICE |   | KNOWLEDGE SVC  |   | PROMPT SERVICE |
| (User Memories)|   | (RAG KB)       |   | (System Prompt)|
+----------------+   +----------------+   +----------------+
         |                    |                    |
         v                    v                    v
+----------------+   +----------------+   +----------------+
| Vector Search  |   | Vector Search  |   | Get Active     |
| by similarity  |   | by similarity  |   | Prompt         |
+----------------+   +----------------+   +----------------+
         |                    |                    |
         +--------------------+--------------------+
                              |
                              v
+--------------------------------------------------+
|              ASSEMBLED CONTEXT                    |
| - Core Instructions (immutable)                  |
| - System Prompt (governed)                       |
| - User Preferences                               |
| - Memories (ranked by importance + similarity)   |
| - Knowledge Chunks (ranked by similarity)        |
| - Conversation History                           |
| - Available Tools                                |
+--------------------------------------------------+
```

### 7.2 Knowledge Retrieval

**Search Process**:
1. Generate embedding for user query
2. Vector similarity search in `knowledge_vectors`
3. Filter by minimum similarity threshold
4. Rank by `similarity * weight`
5. Return top K results

**RAG Config Controls**:
```typescript
{
  knowledgeLimit: 5,           // Max chunks
  knowledgeTokenBudget: 2000,  // Max tokens
  minSimilarity: 0.7,          // Threshold
  similarityWeight: 0.7,       // Ranking weight
  recencyWeight: 0.3,          // Ranking weight
}
```

### 7.3 Memory Integration

**Memory Search**:
1. Generate embedding for user query
2. Vector similarity search in `memory_vectors`
3. Score = `(similarity * similarityWeight) + (importance * importanceWeight) + (recency * recencyWeight)`
4. Filter by minimum similarity
5. Return top K results

**Memory Categories**:
- `preference` - User preferences
- `fact` - User facts
- `interaction` - Interaction patterns
- `context` - Contextual information

### 7.4 Embedding Generation

**File**: `/home/bahati/bakamev2/src/services/embedding.service.ts`

**Model**: `text-embedding-3-small` via OpenRouter

**Chunking Strategy**:
- Max chunk size: 512 tokens
- Overlap: 50 tokens
- Sentence-aware splitting

```typescript
// Chunk long content
const chunks = embeddingService.chunkText(content, {
  maxTokens: 512,
  overlapTokens: 50,
});

// Generate embeddings
const result = await embeddingService.embedAndChunk(content);
// Returns: { chunks, embeddings, model, totalTokens }
```

---

## Quick Reference

### File Locations

| Component | Path |
|-----------|------|
| Services | `/home/bahati/bakamev2/src/services/` |
| Orchestrator | `/home/bahati/bakamev2/src/orchestrator/` |
| Tools | `/home/bahati/bakamev2/src/tools/` |
| Types | `/home/bahati/bakamev2/src/types/` |
| Migrations | `/home/bahati/bakamev2/supabase/migrations/` |

### Key Patterns

1. **Result Pattern**: All service methods return `Result<T>` (success/failure)
2. **Actor Pattern**: All methods receive `ActorContext`
3. **Audit Pattern**: All mutations emit audit events
4. **Factory Pattern**: Services created via `createXxxService(deps)`

### Common Errors

| Error Code | Meaning |
|------------|---------|
| `PERMISSION_DENIED` | Actor lacks required permission |
| `NOT_FOUND` | Resource doesn't exist |
| `VALIDATION_ERROR` | Invalid input |
| `INTERNAL_ERROR` | Server error |
| `INVALID_STATE` | Invalid state transition |

---

## Getting Started Checklist

1. [ ] Read this document
2. [ ] Review type definitions in `/home/bahati/bakamev2/src/types/`
3. [ ] Study a service implementation (start with UserService)
4. [ ] Understand ActorContext flow
5. [ ] Run the test suite
6. [ ] Try adding a simple feature

---

*Last updated: December 2024*
