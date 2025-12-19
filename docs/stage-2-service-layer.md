# STAGE 2: SERVICE (DOMAIN LOGIC) LAYER

**Layer**: 2 of 6
**Status**: APPROVED (with corrections applied)
**References**:
- `docs/stage-1-database-governance.md` (IMMUTABLE SOURCE OF TRUTH)
- `docs/architecture.md` (Stage 3: Service Layer)
- `docs/methodology.md` (Section 3: Test Strategy)

---

## 0. STAGE 1 COMPLIANCE

This stage **MUST NOT** introduce schema changes. All services operate on the Stage 1 schema.

| Stage 1 Table | Owning Service |
|---------------|----------------|
| `users`, `profiles` | UserService |
| `permissions`, `roles`, `role_permissions`, `user_roles` | AuthService |
| `audit_logs` | AuditService |
| `chats`, `messages`, `message_files` | ChatService |
| `ai_preferences` | UserService |
| `memories`, `memory_vectors` | MemoryService |
| `files` | FileService |
| `plans`, `subscriptions`, `entitlements`, `usage_records` | SubscriptionService |
| `knowledge_items`, `knowledge_vectors` | KnowledgeService |
| `system_prompts` | PromptService |
| `tool_registry`, `tool_invocation_logs` | ToolService |
| `approval_requests` | ApprovalService |

---

## 1. SERVICE LAYER PRINCIPLES

### 1.1 Non-Negotiable Rules

From `architecture.md`:

1. **Services expose intent-based methods, not CRUD**
2. **Services are transport-agnostic** (no HTTP, no WebSocket knowledge)
3. **Services are AI-agnostic** (no LLM logic, no prompt construction)
4. **Services emit audit events** (every significant action logged)
5. **Services are testable without AI** (pure business logic)

### 1.2 What Services MUST Do

- Enforce business rules
- Validate inputs
- Check permissions
- Emit audit events
- Return typed results
- Handle errors gracefully
- Respect Stage 1 data policies

### 1.3 What Services MUST NEVER Do

- Construct prompts
- Call LLMs directly
- Know about HTTP/REST/WebSocket
- Bypass permission checks
- Write directly to audit_logs (use AuditService)
- Implement UI logic
- Make assumptions about caller identity

### 1.4 Service-to-Service Trust Rule

**Services may trust other services' permission checks and must not re-validate unless explicitly required.**

This means:
- If `ContextService` calls `ChatService.addMessage()` with a valid `ActorContext`, ChatService trusts that ContextService already validated the context
- Permission checks happen at the **entry point** (API layer constructs ActorContext)
- Services do NOT re-check permissions that a calling service already validated
- Exception: When a service needs to enforce **additional** permissions beyond what the caller checked

This avoids:
- Double-checking hell
- Performance degradation
- Confusion about "who is responsible for what"

### 1.5 Service Communication Pattern

```
┌─────────────────────────────────────────────────────────────────┐
│                     API LAYER (Stage 6)                         │
│         (HTTP/REST/WebSocket - NOT THIS STAGE)                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SERVICE LAYER (THIS STAGE)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │AuthSvc   │ │UserSvc   │ │ChatSvc   │ │MemorySvc │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │KnowledgeSvc│ToolSvc   │ │SubSvc    │ │AuditSvc  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                        │
│  │PromptSvc │ │FileSvc   │ │ApprovalSvc│                       │
│  └──────────┘ └──────────┘ └──────────┘                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────┐          │
│  │              ContextService                       │          │
│  │    (Orchestrates context assembly for AI)         │          │
│  └──────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ uses service_role
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATABASE (Stage 1)                          │
│                     Supabase + Postgres                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. COMMON TYPES & INTERFACES

### 2.1 Result Pattern

All services return `Result<T, E>` for explicit error handling.

```typescript
// Result type for all service methods
type Result<T, E = ServiceError> =
  | { success: true; data: T }
  | { success: false; error: E };

// Standard service error
interface ServiceError {
  code: string;           // e.g., 'PERMISSION_DENIED', 'NOT_FOUND'
  message: string;        // Human-readable
  details?: unknown;      // Additional context
}

// Common error codes
type ErrorCode =
  | 'UNAUTHORIZED'        // No valid session
  | 'PERMISSION_DENIED'   // Lacks required permission
  | 'NOT_FOUND'          // Resource doesn't exist
  | 'VALIDATION_ERROR'   // Invalid input
  | 'CONFLICT'           // State conflict (e.g., already exists)
  | 'RATE_LIMITED'       // Quota exceeded
  | 'INTERNAL_ERROR';    // Unexpected failure
```

### 2.2 Actor Context

Every service method receives an actor context (who is making the request).

```typescript
// Who is performing the action
interface ActorContext {
  type: 'user' | 'admin' | 'system' | 'ai';
  userId?: string;        // UUID, present for user/admin
  sessionId?: string;     // For tracing
  requestId: string;      // Correlation ID (UUIDv7)
  permissions: string[];  // Resolved permissions for this actor
  ip?: string;            // For audit
  userAgent?: string;     // For audit
}

// System actor (for background jobs, triggers)
const SYSTEM_ACTOR: ActorContext = {
  type: 'system',
  requestId: generateUUIDv7(),
  permissions: ['*'], // System has all permissions
};

// AI actor (for orchestrator-initiated actions)
const AI_ACTOR: ActorContext = {
  type: 'ai',
  requestId: generateUUIDv7(),
  permissions: [], // AI has NO direct permissions - must go through services
};
```

**AI_ACTOR INVARIANTS (CRITICAL):**

| Rule | Rationale |
|------|-----------|
| `AI_ACTOR.permissions` MUST always be `[]` | AI has no implicit authority |
| `AI_ACTOR` MAY NEVER be passed to `AuthService.resolvePermissions()` | Prevents "helpfully" granting AI roles |
| AI cannot escalate to admin/system | Blocks prompt injection escalation |
| All AI actions flow through ContextService | Single controlled entry point |

This prevents:
- Prompt injection escalation
- "AI accidentally becomes admin"
- Auditing ambiguity

### 2.3 Pagination

```typescript
interface PaginationParams {
  cursor?: string;        // UUIDv7 of last item (cursor-based)
  limit: number;          // Max items per page (default: 20, max: 100)
}

interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;    // Null if no more items
  hasMore: boolean;
}
```

---

## 3. SERVICE CONTRACTS

### 3.1 AuthService

**Purpose**: Authentication and authorization decisions.

**Owns**: `permissions`, `roles`, `role_permissions`, `user_roles`

**Dependencies**: AuditService

```typescript
interface AuthService {
  // ─────────────────────────────────────────────────────────────
  // PERMISSION CHECKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if actor has a specific permission
   * MUST be called before any privileged operation
   */
  hasPermission(
    actor: ActorContext,
    permission: string
  ): Promise<boolean>;

  /**
   * Check multiple permissions at once
   * Returns true only if ALL permissions are present
   */
  hasAllPermissions(
    actor: ActorContext,
    permissions: string[]
  ): Promise<boolean>;

  /**
   * Check if actor has ANY of the specified permissions
   */
  hasAnyPermission(
    actor: ActorContext,
    permissions: string[]
  ): Promise<boolean>;

  /**
   * Resolve all permissions for a user (from their roles)
   * Used to build ActorContext at request start
   */
  resolvePermissions(
    userId: string
  ): Promise<Result<string[]>>;

  // ─────────────────────────────────────────────────────────────
  // ROLE MANAGEMENT (Admin operations)
  // ─────────────────────────────────────────────────────────────

  /**
   * Assign a role to a user
   * Requires: 'role:assign' permission
   * Emits: audit event
   */
  assignRole(
    actor: ActorContext,
    params: {
      targetUserId: string;
      roleId: string;
      expiresAt?: Date;
    }
  ): Promise<Result<void>>;

  /**
   * Revoke a role from a user
   * Requires: 'role:assign' permission
   * Emits: audit event
   */
  revokeRole(
    actor: ActorContext,
    params: {
      targetUserId: string;
      roleId: string;
    }
  ): Promise<Result<void>>;

  /**
   * Get all roles for a user
   */
  getUserRoles(
    actor: ActorContext,
    userId: string
  ): Promise<Result<Role[]>>;

  /**
   * List all available roles
   */
  listRoles(
    actor: ActorContext
  ): Promise<Result<Role[]>>;
}

// Types
interface Role {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: Permission[];
}

interface Permission {
  id: string;
  code: string;
  description: string;
  category: string;
}
```

**What AuthService MUST NOT do:**
- Handle login/logout (that's Supabase Auth)
- Store sessions (that's Supabase Auth)
- Hash passwords (that's Supabase Auth)
- Issue tokens (that's Supabase Auth)

---

### 3.2 UserService

**Purpose**: User identity and profile management.

**Owns**: `users`, `profiles`, `ai_preferences`

**Dependencies**: AuthService, AuditService

```typescript
interface UserService {
  // ─────────────────────────────────────────────────────────────
  // USER LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /**
   * Called after Supabase auth signup to create application user
   * Creates: user record, profile, default ai_preferences
   * Assigns: default 'user' role
   * Emits: audit event
   */
  onUserSignup(
    actor: ActorContext,
    params: {
      authUserId: string;  // From Supabase auth.users
      email: string;
    }
  ): Promise<Result<User>>;

  /**
   * Get user by ID
   * Users can only get themselves unless they have 'user:read' permission
   */
  getUser(
    actor: ActorContext,
    userId: string
  ): Promise<Result<User>>;

  /**
   * Suspend a user account
   * Requires: 'user:manage' permission
   * Emits: audit event
   */
  suspendUser(
    actor: ActorContext,
    userId: string,
    reason: string
  ): Promise<Result<void>>;

  /**
   * Reactivate a suspended user
   * Requires: 'user:manage' permission
   * Emits: audit event
   */
  reactivateUser(
    actor: ActorContext,
    userId: string
  ): Promise<Result<void>>;

  // ─────────────────────────────────────────────────────────────
  // PROFILE MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  /**
   * Get user's profile
   * Users can only access their own profile
   */
  getProfile(
    actor: ActorContext,
    userId: string
  ): Promise<Result<Profile>>;

  /**
   * Update user's profile
   * Users can only update their own profile
   * Emits: audit event
   */
  updateProfile(
    actor: ActorContext,
    userId: string,
    updates: ProfileUpdate
  ): Promise<Result<Profile>>;

  // ─────────────────────────────────────────────────────────────
  // AI PREFERENCES
  // ─────────────────────────────────────────────────────────────

  /**
   * Get user's AI preferences
   * Users can only access their own preferences
   */
  getAIPreferences(
    actor: ActorContext,
    userId: string
  ): Promise<Result<AIPreferences>>;

  /**
   * Update user's AI preferences
   * Users can only update their own preferences
   * Emits: audit event
   */
  updateAIPreferences(
    actor: ActorContext,
    userId: string,
    updates: AIPreferencesUpdate
  ): Promise<Result<AIPreferences>>;
}

// Types
interface User {
  id: string;
  email: string;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: Date;
}

interface Profile {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
}

interface ProfileUpdate {
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  locale?: string;
}

interface AIPreferences {
  id: string;
  userId: string;
  responseLength: 'concise' | 'balanced' | 'detailed';
  formality: 'casual' | 'neutral' | 'formal';
  allowMemory: boolean;
  allowWebSearch: boolean;
  customInstructions: string | null;
}

interface AIPreferencesUpdate {
  responseLength?: 'concise' | 'balanced' | 'detailed';
  formality?: 'casual' | 'neutral' | 'formal';
  allowMemory?: boolean;
  allowWebSearch?: boolean;
  customInstructions?: string | null;
}
```

---

### 3.3 ChatService

**Purpose**: Conversation management.

**Owns**: `chats`, `messages`, `message_files`

**Dependencies**: AuthService, AuditService, FileService

**Policy Enforcement**: Message immutability (Stage 1 Section 2.4)

```typescript
interface ChatService {
  // ─────────────────────────────────────────────────────────────
  // CHAT LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new chat
   * Requires: 'chat:write' permission
   */
  createChat(
    actor: ActorContext,
    params: {
      title?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<Result<Chat>>;

  /**
   * Get a chat by ID
   * Users can only access their own chats
   */
  getChat(
    actor: ActorContext,
    chatId: string
  ): Promise<Result<Chat>>;

  /**
   * List user's chats
   * Requires: 'chat:read' permission
   */
  listChats(
    actor: ActorContext,
    params: PaginationParams & {
      status?: 'active' | 'archived';
    }
  ): Promise<Result<PaginatedResult<ChatSummary>>>;

  /**
   * Update chat metadata (title, etc.)
   * Users can only update their own chats
   */
  updateChat(
    actor: ActorContext,
    chatId: string,
    updates: ChatUpdate
  ): Promise<Result<Chat>>;

  /**
   * Archive a chat (soft delete)
   * Users can only archive their own chats
   * Emits: audit event
   */
  archiveChat(
    actor: ActorContext,
    chatId: string
  ): Promise<Result<void>>;

  // ─────────────────────────────────────────────────────────────
  // MESSAGE OPERATIONS (APPEND-ONLY)
  // ─────────────────────────────────────────────────────────────

  /**
   * Add a message to a chat
   * This is the ONLY way to add messages (append-only)
   * Requires: 'chat:write' permission
   */
  addMessage(
    actor: ActorContext,
    params: {
      chatId: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata?: MessageMetadata;
      fileIds?: string[];  // Attach files to message
    }
  ): Promise<Result<Message>>;

  /**
   * Get messages in a chat
   * Returns messages in chronological order
   * Users can only access their own chat messages
   */
  getMessages(
    actor: ActorContext,
    chatId: string,
    params: PaginationParams
  ): Promise<Result<PaginatedResult<Message>>>;

  /**
   * Redact a message (soft delete)
   * Sets metadata.redacted = true
   * Content is preserved for audit but hidden from UI
   * Users can only redact their own messages
   * Emits: audit event
   */
  redactMessage(
    actor: ActorContext,
    messageId: string,
    reason: string
  ): Promise<Result<void>>;

  // NOTE: There is NO updateMessage or deleteMessage method
  // Messages are immutable per Stage 1 policy
}

// Types
interface Chat {
  id: string;
  userId: string;
  title: string | null;
  status: 'active' | 'archived' | 'deleted';
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface ChatSummary {
  id: string;
  title: string | null;
  status: 'active' | 'archived';
  lastMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
}

interface ChatUpdate {
  title?: string;
  metadata?: Record<string, unknown>;
}

interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: MessageMetadata;
  files: FileReference[];
  createdAt: Date;
}

interface MessageMetadata {
  model?: string;           // LLM model used
  tokenCount?: number;      // Tokens in message
  toolCalls?: ToolCall[];   // Tools invoked
  redacted?: boolean;       // If message was redacted
  redactedAt?: Date;
  redactedReason?: string;
  replacesId?: string;      // If this "edits" another message
}

interface FileReference {
  id: string;
  filename: string;
  mimeType: string;
}
```

---

### 3.4 MemoryService

**Purpose**: Long-term user memory management.

**Owns**: `memories`, `memory_vectors`

**Dependencies**: AuthService, AuditService

**Policy Enforcement**: Memory retention policy (Stage 1 Section 9.2)

**Embedding Responsibility (IMPORTANT):**
MemoryService owns `memory_vectors` table but does NOT generate embeddings directly.
- Embedding = model-dependent AI logic (violates AI-agnostic principle)
- MemoryService creates memory record and schedules embedding job
- Actual embedding done via Stage 5 (Tool Execution) or dedicated EmbeddingJob
- This allows: model changes, batch re-embedding, cost control, offline processing

```typescript
interface MemoryService {
  // ─────────────────────────────────────────────────────────────
  // MEMORY CRUD
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new memory
   * Requires: 'memory:write' permission
   * NOTE: Schedules embedding generation (async via Stage 5 tool/job)
   *       Does NOT generate embedding synchronously (AI-agnostic principle)
   */
  createMemory(
    actor: ActorContext,
    params: {
      userId: string;       // Must be actor's own user (unless system)
      content: string;
      category?: string;
      source: 'conversation' | 'user_input' | 'system';
      importance?: number;  // 1-10, default 5
    }
  ): Promise<Result<Memory>>;

  /**
   * Get a memory by ID
   * Users can only access their own memories
   * Updates last_accessed timestamp
   */
  getMemory(
    actor: ActorContext,
    memoryId: string
  ): Promise<Result<Memory>>;

  /**
   * List user's memories
   * Requires: 'memory:read' permission
   */
  listMemories(
    actor: ActorContext,
    userId: string,
    params: PaginationParams & {
      category?: string;
      status?: 'active' | 'archived';
    }
  ): Promise<Result<PaginatedResult<Memory>>>;

  /**
   * Update memory content
   * Schedules re-embedding (async via Stage 5 tool/job)
   * Users can only update their own memories
   * Emits: audit event
   */
  updateMemory(
    actor: ActorContext,
    memoryId: string,
    updates: MemoryUpdate
  ): Promise<Result<Memory>>;

  /**
   * Archive a memory (reversible)
   * Users can only archive their own memories
   * Emits: audit event
   */
  archiveMemory(
    actor: ActorContext,
    memoryId: string
  ): Promise<Result<void>>;

  /**
   * Delete a memory (user-initiated, per policy)
   * Requires: 'memory:delete' permission
   * Emits: audit event
   */
  deleteMemory(
    actor: ActorContext,
    memoryId: string
  ): Promise<Result<void>>;

  // ─────────────────────────────────────────────────────────────
  // SEMANTIC SEARCH
  // ─────────────────────────────────────────────────────────────

  /**
   * Search memories by semantic similarity
   * Used by ContextService to retrieve relevant memories
   * Users can only search their own memories
   */
  searchMemories(
    actor: ActorContext,
    userId: string,
    params: {
      query: string;        // Natural language query
      limit?: number;       // Max results (default: 10)
      minSimilarity?: number; // Threshold (default: 0.7)
      categories?: string[];  // Filter by category
    }
  ): Promise<Result<MemorySearchResult[]>>;

  // ─────────────────────────────────────────────────────────────
  // MAINTENANCE (System operations)
  // ─────────────────────────────────────────────────────────────

  /**
   * Auto-archive inactive memories (per policy: 180 days)
   * Called by system job
   * Requires: system actor
   */
  archiveInactiveMemories(
    actor: ActorContext  // Must be SYSTEM_ACTOR
  ): Promise<Result<{ archivedCount: number }>>;

  /**
   * Re-embed all memories for a user (when model changes)
   * Requires: system actor
   */
  reembedUserMemories(
    actor: ActorContext,  // Must be SYSTEM_ACTOR
    userId: string,
    newModel: string
  ): Promise<Result<{ processedCount: number }>>;
}

// Types
interface Memory {
  id: string;
  userId: string;
  content: string;
  category: string | null;
  source: 'conversation' | 'user_input' | 'system';
  importance: number;
  status: 'active' | 'archived' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
  lastAccessed: Date | null;
}

interface MemoryUpdate {
  content?: string;
  category?: string;
  importance?: number;
}

interface MemorySearchResult {
  memory: Memory;
  similarity: number;  // 0-1
}
```

---

### 3.5 KnowledgeService

**Purpose**: RAG knowledge base management with governance.

**Owns**: `knowledge_items`, `knowledge_vectors`

**Dependencies**: AuthService, AuditService, ApprovalService

**Policy Enforcement**: Knowledge versioning policy (Stage 1 Section 9.3)

```typescript
interface KnowledgeService {
  // ─────────────────────────────────────────────────────────────
  // KNOWLEDGE LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a knowledge item (starts as draft)
   * Requires: 'knowledge:write' permission
   * Emits: audit event
   */
  createKnowledgeItem(
    actor: ActorContext,
    params: {
      title: string;
      content: string;
      category?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<Result<KnowledgeItem>>;

  /**
   * Get a knowledge item
   * Published items: anyone with 'knowledge:read'
   * Draft items: author only or 'knowledge:review' permission
   */
  getKnowledgeItem(
    actor: ActorContext,
    itemId: string
  ): Promise<Result<KnowledgeItem>>;

  /**
   * List knowledge items
   * Filters by status based on permissions
   */
  listKnowledgeItems(
    actor: ActorContext,
    params: PaginationParams & {
      status?: 'draft' | 'pending_review' | 'published' | 'archived';
      category?: string;
      authorId?: string;
    }
  ): Promise<Result<PaginatedResult<KnowledgeItem>>>;

  /**
   * Update a knowledge item
   * Creates new version if published
   * Requires: author or 'knowledge:write' permission
   * Emits: audit event
   */
  updateKnowledgeItem(
    actor: ActorContext,
    itemId: string,
    updates: KnowledgeItemUpdate
  ): Promise<Result<KnowledgeItem>>;

  // ─────────────────────────────────────────────────────────────
  // GOVERNANCE WORKFLOW
  // ─────────────────────────────────────────────────────────────

  /**
   * Submit item for review
   * Changes status: draft -> pending_review
   * Creates approval request
   * Requires: author of the item
   * Emits: audit event
   */
  submitForReview(
    actor: ActorContext,
    itemId: string,
    notes?: string
  ): Promise<Result<void>>;

  /**
   * Approve a knowledge item
   * Changes status: pending_review -> approved (ready for publish)
   * Requires: 'knowledge:review' permission
   * Emits: audit event
   */
  approveItem(
    actor: ActorContext,
    itemId: string,
    notes?: string
  ): Promise<Result<void>>;

  /**
   * Reject a knowledge item
   * Changes status: pending_review -> draft
   * Requires: 'knowledge:review' permission
   * Emits: audit event
   */
  rejectItem(
    actor: ActorContext,
    itemId: string,
    reason: string
  ): Promise<Result<void>>;

  /**
   * Publish an approved item
   * Changes status: approved -> published
   * Schedules embedding generation (async via Stage 5 job/tool)
   * Requires: 'knowledge:publish' permission
   * Emits: audit event
   */
  publishItem(
    actor: ActorContext,
    itemId: string
  ): Promise<Result<void>>;

  /**
   * Archive a published item (remove from RAG)
   * Changes status: published -> archived
   * Requires: 'knowledge:publish' permission
   * Emits: audit event
   */
  archiveItem(
    actor: ActorContext,
    itemId: string,
    reason: string
  ): Promise<Result<void>>;

  // ─────────────────────────────────────────────────────────────
  // SEMANTIC SEARCH (For RAG)
  // ─────────────────────────────────────────────────────────────

  /**
   * Search published knowledge by semantic similarity
   * Used by ContextService for RAG
   * Only searches published items
   */
  searchKnowledge(
    actor: ActorContext,
    params: {
      query: string;
      limit?: number;
      minSimilarity?: number;
      categories?: string[];
    }
  ): Promise<Result<KnowledgeSearchResult[]>>;

  // ─────────────────────────────────────────────────────────────
  // VERSION HISTORY
  // ─────────────────────────────────────────────────────────────

  /**
   * Get version history for an item
   * Full history retained per policy
   */
  getVersionHistory(
    actor: ActorContext,
    itemId: string
  ): Promise<Result<KnowledgeVersion[]>>;
}

// Types
interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string | null;
  status: 'draft' | 'pending_review' | 'published' | 'archived';
  authorId: string;
  reviewerId: string | null;
  publishedAt: Date | null;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface KnowledgeItemUpdate {
  title?: string;
  content?: string;
  category?: string;
  metadata?: Record<string, unknown>;
}

interface KnowledgeSearchResult {
  item: KnowledgeItem;
  chunk: string;        // The matching chunk
  chunkIndex: number;
  similarity: number;
}

interface KnowledgeVersion {
  version: number;
  title: string;
  content: string;
  authorId: string;
  createdAt: Date;
}
```

---

### 3.6 PromptService

**Purpose**: System prompt governance.

**Owns**: `system_prompts`

**Dependencies**: AuthService, AuditService, ApprovalService

```typescript
interface PromptService {
  // ─────────────────────────────────────────────────────────────
  // PROMPT LIFECYCLE
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a system prompt (starts as draft)
   * Requires: 'prompt:write' permission
   * Emits: audit event
   */
  createPrompt(
    actor: ActorContext,
    params: {
      name: string;
      description?: string;
      content: string;
    }
  ): Promise<Result<SystemPrompt>>;

  /**
   * Get a system prompt
   * Active prompts: anyone with 'prompt:read'
   * Draft prompts: author only
   */
  getPrompt(
    actor: ActorContext,
    promptId: string
  ): Promise<Result<SystemPrompt>>;

  /**
   * Get the currently active default prompt
   * Used by ContextService
   */
  getActivePrompt(
    actor: ActorContext
  ): Promise<Result<SystemPrompt>>;

  /**
   * List system prompts
   */
  listPrompts(
    actor: ActorContext,
    params: PaginationParams & {
      status?: 'draft' | 'pending_review' | 'active' | 'deprecated';
    }
  ): Promise<Result<PaginatedResult<SystemPrompt>>>;

  /**
   * Update a system prompt
   * Creates new version
   * Requires: 'prompt:write' permission
   * Emits: audit event
   */
  updatePrompt(
    actor: ActorContext,
    promptId: string,
    updates: PromptUpdate
  ): Promise<Result<SystemPrompt>>;

  // ─────────────────────────────────────────────────────────────
  // GOVERNANCE WORKFLOW
  // ─────────────────────────────────────────────────────────────

  /**
   * Submit prompt for review
   * Requires: author of the prompt
   * Emits: audit event
   */
  submitForReview(
    actor: ActorContext,
    promptId: string
  ): Promise<Result<void>>;

  /**
   * Approve a prompt
   * Requires: 'prompt:review' permission
   * Emits: audit event
   */
  approvePrompt(
    actor: ActorContext,
    promptId: string
  ): Promise<Result<void>>;

  /**
   * Reject a prompt
   * Requires: 'prompt:review' permission
   * Emits: audit event
   */
  rejectPrompt(
    actor: ActorContext,
    promptId: string,
    reason: string
  ): Promise<Result<void>>;

  /**
   * Activate a prompt (make it the default)
   * Atomically deactivates previous default
   * Requires: 'prompt:activate' permission
   * Emits: audit event
   */
  activatePrompt(
    actor: ActorContext,
    promptId: string
  ): Promise<Result<void>>;

  /**
   * Deprecate a prompt
   * Requires: 'prompt:activate' permission
   * Emits: audit event
   */
  deprecatePrompt(
    actor: ActorContext,
    promptId: string,
    reason: string
  ): Promise<Result<void>>;
}

// Types
interface SystemPrompt {
  id: string;
  name: string;
  description: string | null;
  content: string;
  status: 'draft' | 'pending_review' | 'active' | 'deprecated';
  authorId: string;
  reviewerId: string | null;
  version: number;
  isDefault: boolean;
  activatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PromptUpdate {
  name?: string;
  description?: string;
  content?: string;
}
```

---

### 3.7 ToolService

**Purpose**: Tool registry and invocation logging.

**Owns**: `tool_registry`, `tool_invocation_logs`

**Dependencies**: AuthService, AuditService, SubscriptionService

**Policy Enforcement**: Tool cost tracking policy (Stage 1 Section 9.4)

```typescript
interface ToolService {
  // ─────────────────────────────────────────────────────────────
  // TOOL REGISTRY
  // ─────────────────────────────────────────────────────────────

  /**
   * Register a new tool
   * Requires: 'tool:manage' permission
   * Emits: audit event
   */
  registerTool(
    actor: ActorContext,
    params: ToolDefinition
  ): Promise<Result<Tool>>;

  /**
   * Get a tool by ID
   */
  getTool(
    actor: ActorContext,
    toolId: string
  ): Promise<Result<Tool>>;

  /**
   * Get a tool by name
   */
  getToolByName(
    actor: ActorContext,
    name: string
  ): Promise<Result<Tool>>;

  /**
   * List available tools
   * Returns only active tools user has permission to invoke
   */
  listAvailableTools(
    actor: ActorContext
  ): Promise<Result<Tool[]>>;

  /**
   * Update a tool
   * Requires: 'tool:manage' permission
   * Emits: audit event
   */
  updateTool(
    actor: ActorContext,
    toolId: string,
    updates: ToolUpdate
  ): Promise<Result<Tool>>;

  /**
   * Disable a tool
   * Requires: 'tool:manage' permission
   * Emits: audit event
   */
  disableTool(
    actor: ActorContext,
    toolId: string,
    reason: string
  ): Promise<Result<void>>;

  // ─────────────────────────────────────────────────────────────
  // INVOCATION LOGGING
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if user can invoke a tool
   * Checks: tool permission + subscription entitlements + rate limits
   *
   * TOCTOU POLICY (Time-of-check to time-of-use):
   *   - This is an optimistic pre-check, NOT a guarantee
   *   - Parallel calls may both pass this check
   *   - Final quota enforcement occurs at logInvocationComplete()
   *   - logInvocationComplete() may retroactively mark invocation as over-limit
   *   - This avoids expensive locking while maintaining correctness
   */
  canInvokeTool(
    actor: ActorContext,
    toolName: string
  ): Promise<Result<{ allowed: boolean; reason?: string }>>;

  /**
   * Log the start of a tool invocation
   * Returns invocation ID for tracking
   */
  logInvocationStart(
    actor: ActorContext,
    params: {
      toolId: string;
      chatId?: string;
      input: Record<string, unknown>;
    }
  ): Promise<Result<{ invocationId: string }>>;

  /**
   * Log the completion of a tool invocation
   * Records output, duration, cost
   */
  logInvocationComplete(
    actor: ActorContext,
    invocationId: string,
    result: {
      status: 'success' | 'failure';
      output?: Record<string, unknown>;
      errorMessage?: string;
      actualCost?: ToolCost;
    }
  ): Promise<Result<void>>;

  /**
   * Get invocation history for a user
   * Used for debugging and cost tracking
   */
  getInvocationHistory(
    actor: ActorContext,
    params: PaginationParams & {
      userId?: string;
      toolId?: string;
      status?: 'success' | 'failure';
    }
  ): Promise<Result<PaginatedResult<ToolInvocation>>>;
}

// Types
interface ToolDefinition {
  name: string;
  description: string;
  type: 'local' | 'mcp' | 'n8n';
  config: Record<string, unknown>;
  inputSchema: Record<string, unknown>;  // JSON Schema
  outputSchema?: Record<string, unknown>;
  requiresPermission?: string;
  estimatedCost?: ToolCost;
}

interface Tool {
  id: string;
  name: string;
  description: string;
  type: 'local' | 'mcp' | 'n8n';
  config: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  status: 'active' | 'disabled' | 'deprecated';
  requiresPermission: string | null;
  estimatedCost: ToolCost | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ToolUpdate {
  description?: string;
  config?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  requiresPermission?: string;
  estimatedCost?: ToolCost;
}

interface ToolCost {
  tokens?: number;
  latencyMs?: number;
  apiCost?: number;       // In cents
  customMetrics?: Record<string, number>;
}

interface ToolInvocation {
  id: string;
  toolId: string;
  toolName: string;
  chatId: string | null;
  userId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: 'pending' | 'success' | 'failure';
  errorMessage: string | null;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  actualCost: ToolCost | null;
}
```

---

### 3.8 SubscriptionService

**Purpose**: Billing, plans, and entitlement enforcement.

**Owns**: `plans`, `subscriptions`, `entitlements`, `usage_records`

**Dependencies**: AuthService, AuditService

**Policy Enforcement**: File storage quotas (Stage 1 Section 9.5)

```typescript
interface SubscriptionService {
  // ─────────────────────────────────────────────────────────────
  // PLAN MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  /**
   * List available plans
   */
  listPlans(
    actor: ActorContext
  ): Promise<Result<Plan[]>>;

  /**
   * Get plan details
   */
  getPlan(
    actor: ActorContext,
    planId: string
  ): Promise<Result<Plan>>;

  // ─────────────────────────────────────────────────────────────
  // SUBSCRIPTION MANAGEMENT
  // ─────────────────────────────────────────────────────────────

  /**
   * Get user's current subscription
   */
  getSubscription(
    actor: ActorContext,
    userId: string
  ): Promise<Result<Subscription | null>>;

  /**
   * Create subscription (after payment)
   * Called by payment webhook handler
   * Requires: system actor
   * Emits: audit event
   */
  createSubscription(
    actor: ActorContext,
    params: {
      userId: string;
      planId: string;
      externalId?: string;
      periodStart: Date;
      periodEnd: Date;
    }
  ): Promise<Result<Subscription>>;

  /**
   * Update subscription status
   * Called by payment webhook handler
   * Requires: system actor
   * Emits: audit event
   */
  updateSubscriptionStatus(
    actor: ActorContext,
    subscriptionId: string,
    status: 'active' | 'canceled' | 'past_due' | 'expired'
  ): Promise<Result<void>>;

  /**
   * Change subscription plan
   * Requires: system actor (via payment system)
   * Emits: audit event
   */
  changePlan(
    actor: ActorContext,
    subscriptionId: string,
    newPlanId: string
  ): Promise<Result<Subscription>>;

  // ─────────────────────────────────────────────────────────────
  // ENTITLEMENT CHECKS
  // ─────────────────────────────────────────────────────────────

  /**
   * Check if user has a specific entitlement
   * Used by other services to enforce limits
   */
  hasEntitlement(
    actor: ActorContext,
    userId: string,
    featureCode: string
  ): Promise<Result<boolean>>;

  /**
   * Get entitlement value
   * Returns the limit/config for a feature
   */
  getEntitlementValue(
    actor: ActorContext,
    userId: string,
    featureCode: string
  ): Promise<Result<EntitlementValue | null>>;

  /**
   * Check if user is within usage limits
   * Combines entitlement check with current usage
   */
  checkUsageLimit(
    actor: ActorContext,
    userId: string,
    featureCode: string
  ): Promise<Result<UsageLimitCheck>>;

  // ─────────────────────────────────────────────────────────────
  // USAGE TRACKING
  // ─────────────────────────────────────────────────────────────

  /**
   * Record usage of a feature
   * Called by other services after actions
   * Batched writes recommended (not on hot paths)
   *
   * IDEMPOTENCY REQUIREMENT:
   *   - Params MUST include requestId or invocationId
   *   - Duplicate records (same id + featureCode) are ignored
   *   - This protects against retries, webhooks, serverless flakiness
   */
  recordUsage(
    actor: ActorContext,
    params: {
      userId: string;
      featureCode: string;
      quantity: number;
      requestId?: string;      // For general usage
      invocationId?: string;   // For tool-specific usage
    }
  ): Promise<Result<void>>;

  /**
   * Get usage summary for a user
   */
  getUsageSummary(
    actor: ActorContext,
    userId: string,
    params: {
      periodStart: Date;
      periodEnd: Date;
    }
  ): Promise<Result<UsageSummary[]>>;
}

// Types
interface Plan {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  entitlements: Entitlement[];
  metadata: Record<string, unknown>;
}

interface Entitlement {
  featureCode: string;
  value: EntitlementValue;
}

interface EntitlementValue {
  enabled?: boolean;
  limit?: number;
  config?: Record<string, unknown>;
}

interface Subscription {
  id: string;
  userId: string;
  plan: Plan;
  status: 'active' | 'canceled' | 'past_due' | 'expired';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  externalId: string | null;
}

interface UsageLimitCheck {
  allowed: boolean;
  currentUsage: number;
  limit: number | null;     // null = unlimited
  remaining: number | null;
  resetsAt: Date;
}

interface UsageSummary {
  featureCode: string;
  quantity: number;
  periodStart: Date;
  periodEnd: Date;
}
```

---

### 3.9 FileService

**Purpose**: File upload and management.

**Owns**: `files`

**Dependencies**: AuthService, AuditService, SubscriptionService

**Policy Enforcement**: File storage quotas via entitlements

```typescript
interface FileService {
  // ─────────────────────────────────────────────────────────────
  // FILE OPERATIONS
  // ─────────────────────────────────────────────────────────────

  /**
   * Initiate file upload
   * Checks entitlements (max_file_size_mb, total_storage_mb)
   * Returns signed upload URL
   */
  initiateUpload(
    actor: ActorContext,
    params: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
    }
  ): Promise<Result<{
    fileId: string;
    uploadUrl: string;
    expiresAt: Date;
  }>>;

  /**
   * Confirm upload completed
   * Changes status: uploading -> active
   */
  confirmUpload(
    actor: ActorContext,
    fileId: string
  ): Promise<Result<File>>;

  /**
   * Get file metadata
   * Users can only access their own files
   */
  getFile(
    actor: ActorContext,
    fileId: string
  ): Promise<Result<File>>;

  /**
   * Get signed download URL
   * Users can only download their own files
   */
  getDownloadUrl(
    actor: ActorContext,
    fileId: string
  ): Promise<Result<{ url: string; expiresAt: Date }>>;

  /**
   * List user's files
   */
  listFiles(
    actor: ActorContext,
    userId: string,
    params: PaginationParams
  ): Promise<Result<PaginatedResult<File>>>;

  /**
   * Delete a file (soft delete)
   * Users can only delete their own files
   * Emits: audit event
   */
  deleteFile(
    actor: ActorContext,
    fileId: string
  ): Promise<Result<void>>;

  /**
   * Get user's storage usage
   */
  getStorageUsage(
    actor: ActorContext,
    userId: string
  ): Promise<Result<{
    usedBytes: number;
    limitBytes: number | null;
    fileCount: number;
  }>>;
}

// Types
interface File {
  id: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'uploading' | 'active' | 'deleted';
  createdAt: Date;
  deletedAt: Date | null;
}
```

---

### 3.10 AuditService

**Purpose**: Immutable audit logging.

**Owns**: `audit_logs`

**Dependencies**: None (lowest level service)

**Policy Enforcement**: Audit log retention policy (Stage 1 Section 9.6)

```typescript
interface AuditService {
  // ─────────────────────────────────────────────────────────────
  // LOGGING (Write-only for most services)
  // ─────────────────────────────────────────────────────────────

  /**
   * Log an audit event
   * This is the ONLY way to write to audit_logs
   * No permission check - all services can log
   */
  log(
    actor: ActorContext,
    event: AuditEvent
  ): Promise<Result<void>>;

  /**
   * Log multiple events atomically
   * Used for batch operations
   */
  logBatch(
    actor: ActorContext,
    events: AuditEvent[]
  ): Promise<Result<void>>;

  // ─────────────────────────────────────────────────────────────
  // QUERYING (Auditors only)
  // ─────────────────────────────────────────────────────────────

  /**
   * Query audit logs
   * Requires: 'audit:read' permission
   */
  queryLogs(
    actor: ActorContext,
    params: AuditQueryParams
  ): Promise<Result<PaginatedResult<AuditLog>>>;

  /**
   * Get audit logs for a specific resource
   * Requires: 'audit:read' permission
   */
  getResourceHistory(
    actor: ActorContext,
    resourceType: string,
    resourceId: string
  ): Promise<Result<AuditLog[]>>;

  /**
   * Get audit logs for a specific actor
   * Requires: 'audit:read' permission
   */
  getActorHistory(
    actor: ActorContext,
    targetActorId: string,
    params: PaginationParams
  ): Promise<Result<PaginatedResult<AuditLog>>>;
}

// Types
interface AuditEvent {
  action: string;           // e.g., 'knowledge:publish'
  resourceType: string;     // e.g., 'knowledge_item'
  resourceId?: string;
  details?: Record<string, unknown>;
}

interface AuditLog {
  id: string;
  timestamp: Date;
  actorId: string | null;
  actorType: 'user' | 'admin' | 'system' | 'ai';
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
}

interface AuditQueryParams extends PaginationParams {
  actorId?: string;
  actorType?: 'user' | 'admin' | 'system' | 'ai';
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
}
```

---

### 3.11 ApprovalService

**Purpose**: Governance approval workflow management.

**Owns**: `approval_requests`

**Dependencies**: AuthService, AuditService

```typescript
interface ApprovalService {
  // ─────────────────────────────────────────────────────────────
  // APPROVAL REQUESTS
  // ─────────────────────────────────────────────────────────────

  /**
   * Create an approval request
   * Called by KnowledgeService, PromptService
   */
  createRequest(
    actor: ActorContext,
    params: {
      resourceType: 'knowledge_item' | 'system_prompt';
      resourceId: string;
      action: 'publish' | 'activate' | 'deprecate';
      notes?: string;
    }
  ): Promise<Result<ApprovalRequest>>;

  /**
   * Get an approval request
   */
  getRequest(
    actor: ActorContext,
    requestId: string
  ): Promise<Result<ApprovalRequest>>;

  /**
   * List pending approval requests
   * Requires: 'knowledge:review' or 'prompt:review' permission
   */
  listPendingRequests(
    actor: ActorContext,
    params: PaginationParams & {
      resourceType?: string;
    }
  ): Promise<Result<PaginatedResult<ApprovalRequest>>>;

  /**
   * Approve a request
   * Requires: appropriate review permission
   * Emits: audit event
   */
  approve(
    actor: ActorContext,
    requestId: string,
    notes?: string
  ): Promise<Result<void>>;

  /**
   * Reject a request
   * Requires: appropriate review permission
   * Emits: audit event
   */
  reject(
    actor: ActorContext,
    requestId: string,
    reason: string
  ): Promise<Result<void>>;

  /**
   * Cancel a request (by requester)
   * Requires: requester of the request
   * Emits: audit event
   */
  cancel(
    actor: ActorContext,
    requestId: string
  ): Promise<Result<void>>;
}

// Types
interface ApprovalRequest {
  id: string;
  resourceType: 'knowledge_item' | 'system_prompt';
  resourceId: string;
  action: 'publish' | 'activate' | 'deprecate';
  status: 'pending' | 'approved' | 'rejected' | 'canceled';
  requesterId: string;
  reviewerId: string | null;
  requestNotes: string | null;
  reviewNotes: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}
```

---

### 3.12 ContextService

**Purpose**: Assembles context for AI orchestrator. This is the **bridge** between services and AI.

**Owns**: No tables (reads from other services)

**Dependencies**: UserService, ChatService, MemoryService, KnowledgeService, PromptService, ToolService

```typescript
interface ContextService {
  // ─────────────────────────────────────────────────────────────
  // CONTEXT ASSEMBLY
  // ─────────────────────────────────────────────────────────────

  /**
   * Build complete context for an AI request
   * This is the ONLY service the AI orchestrator calls
   * Assembles: system prompt + preferences + memories + RAG + messages
   */
  buildContext(
    actor: ActorContext,
    params: {
      chatId: string;
      userMessage: string;
    }
  ): Promise<Result<AIContext>>;

  /**
   * Get available tools for the user
   * Filters by permissions and entitlements
   */
  getAvailableTools(
    actor: ActorContext
  ): Promise<Result<ToolDefinition[]>>;

  /**
   * Persist AI response and any side effects
   * Called after AI generates response
   *
   * ACTOR PATTERN (CRITICAL):
   *   - ContextService internally uses SYSTEM_ACTOR for writes
   *   - Message metadata.actorType = 'ai' records AI origin
   *   - This avoids giving AI_ACTOR write permissions
   *   - Audit trail still shows AI was the logical actor
   *
   * IMMEDIATE (synchronous):
   *   - ChatService.addMessage() for AI response (via SYSTEM_ACTOR)
   *
   * DEFERRED (async, enqueued for background processing):
   *   - MemoryService.createMemory() for extracted memories
   *   - SubscriptionService.recordUsage() for token usage
   *   - AuditService.log() enrichment
   *
   * This split prevents:
   *   - Serverless timeouts
   *   - Mobile latency issues
   *   - Streaming response delays
   */
  persistResponse(
    actor: ActorContext,
    params: {
      chatId: string;
      response: AIResponse;
    }
  ): Promise<Result<void>>;
}

// Types
interface AIContext {
  // Version for future compatibility (memory format changes, tool schema changes)
  version: 'v1';

  // Layer 1: Immutable core (hardcoded safety rules)
  coreInstructions: string;

  // Layer 2: System prompt (governed, from PromptService)
  systemPrompt: string;

  // Layer 3: User preferences (from UserService)
  userPreferences: {
    responseLength: string;
    formality: string;
    customInstructions: string | null;
  };

  // Layer 4: Retrieved context
  memories: MemoryContext[];
  knowledge: KnowledgeContext[];

  // Layer 5: Conversation history
  messages: MessageContext[];

  // Available tools
  tools: ToolDefinition[];

  // Metadata
  userId: string;
  chatId: string;
}

interface MemoryContext {
  content: string;
  category: string | null;
  importance: number;
  similarity: number;
}

interface KnowledgeContext {
  title: string;
  chunk: string;
  similarity: number;
}

interface MessageContext {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: Date;
}

interface AIResponse {
  content: string;
  model: string;
  tokenCount: number;
  toolCalls?: ToolCallResult[];
  memoriesToCreate?: string[];  // AI-suggested memories
}

interface ToolCallResult {
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: 'success' | 'failure';
}
```

---

## 4. SERVICE DEPENDENCY GRAPH

```
                                    ┌─────────────┐
                                    │ AuditService│ (no dependencies)
                                    └─────────────┘
                                           ▲
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              │                            │                            │
       ┌──────┴──────┐              ┌──────┴──────┐              ┌──────┴──────┐
       │ AuthService │              │ApprovalSvc  │              │ FileSvc     │
       └─────────────┘              └─────────────┘              └─────────────┘
              ▲                            ▲                            ▲
              │                            │                            │
    ┌─────────┼─────────┬─────────────────┼────────────────────────────┤
    │         │         │                  │                            │
    │         │         │                  │                            │
┌───┴───┐ ┌───┴───┐ ┌───┴───┐      ┌──────┴──────┐              ┌──────┴──────┐
│UserSvc│ │ChatSvc│ │ToolSvc│      │KnowledgeSvc │              │ MemorySvc   │
└───────┘ └───────┘ └───────┘      └─────────────┘              └─────────────┘
    │         │         │                  │                            │
    │         │         │                  │                            │
    │    ┌────┴────┐    │          ┌──────┴──────┐                      │
    │    │PromptSvc│    │          │ SubSvc      │                      │
    │    └─────────┘    │          └─────────────┘                      │
    │         │         │                  │                            │
    └─────────┼─────────┴──────────────────┼────────────────────────────┘
              │                            │
              │                            │
              ▼                            ▼
       ┌─────────────────────────────────────────┐
       │            ContextService               │
       │   (Orchestrates all for AI runtime)     │
       └─────────────────────────────────────────┘
                          │
                          │
                          ▼
       ┌─────────────────────────────────────────┐
       │          AI ORCHESTRATOR (Stage 4)      │
       │              (NOT THIS STAGE)           │
       └─────────────────────────────────────────┘
```

---

## 5. SERVICE INTERACTION FLOWS

### 5.1 User Sends a Message

```
User Message
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ API Layer (Stage 6) - receives HTTP request                     │
└─────────────────────────────────────────────────────────────────┘
     │
     │ Creates ActorContext from auth token
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ ChatService.addMessage()                                        │
│   - Validates chat ownership                                    │
│   - Persists user message                                       │
│   - Returns message ID                                          │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ ContextService.buildContext()                                   │
│   - Gets system prompt (PromptService)                         │
│   - Gets user preferences (UserService)                        │
│   - Searches memories (MemoryService)                          │
│   - Searches knowledge (KnowledgeService)                      │
│   - Gets chat history (ChatService)                            │
│   - Gets available tools (ToolService)                         │
│   - Returns AIContext                                          │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ AI Orchestrator (Stage 4) - NOT THIS STAGE                      │
│   - Receives AIContext                                          │
│   - Generates response                                          │
│   - May call tools                                              │
└─────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ ContextService.persistResponse()                                │
│                                                                 │
│   IMMEDIATE (sync):                                            │
│     - ChatService.addMessage() for AI response                 │
│                                                                 │
│   DEFERRED (async, enqueued):                                  │
│     - MemoryService.createMemory() for extracted memories      │
│     - SubscriptionService.recordUsage() for token usage        │
│     - AuditService.log() enrichment                            │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Knowledge Publication Flow

```
Editor creates knowledge
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ KnowledgeService.createKnowledgeItem()                          │
│   - AuthService.hasPermission('knowledge:write')               │
│   - Creates item (status: draft)                               │
│   - AuditService.log('knowledge:create')                       │
└─────────────────────────────────────────────────────────────────┘
     │
     │ Editor submits for review
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ KnowledgeService.submitForReview()                              │
│   - Validates editor is author                                 │
│   - Updates status: draft -> pending_review                    │
│   - ApprovalService.createRequest()                            │
│   - AuditService.log('knowledge:submit_review')                │
└─────────────────────────────────────────────────────────────────┘
     │
     │ Reviewer approves
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ KnowledgeService.approveItem()                                  │
│   - AuthService.hasPermission('knowledge:review')              │
│   - ApprovalService.approve()                                  │
│   - Updates status: pending_review -> approved                 │
│   - AuditService.log('knowledge:approve')                      │
└─────────────────────────────────────────────────────────────────┘
     │
     │ Admin publishes
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ KnowledgeService.publishItem()                                  │
│   - AuthService.hasPermission('knowledge:publish')             │
│   - Updates status: approved -> published                      │
│   - Schedules embedding generation (async)                     │
│   - AuditService.log('knowledge:publish')                      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Tool Invocation Flow

```
AI decides to call tool
     │
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ ToolService.canInvokeTool()                                     │
│   - AuthService.hasPermission(tool.requiresPermission)         │
│   - SubscriptionService.checkUsageLimit()                      │
│   - Returns: allowed or denied with reason                     │
└─────────────────────────────────────────────────────────────────┘
     │
     │ If allowed
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ ToolService.logInvocationStart()                                │
│   - Creates invocation record (status: pending)                │
│   - Returns invocationId                                       │
└─────────────────────────────────────────────────────────────────┘
     │
     │ Tool executes (Stage 5)
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ ToolService.logInvocationComplete()                             │
│   - Updates invocation (status, output, duration, cost)        │
│   - SubscriptionService.recordUsage() if applicable            │
│   - AuditService.log('tool:invoke' or 'tool:failure')          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. ERROR HANDLING STRATEGY

### 6.1 Error Propagation

```
┌─────────────────────────────────────────────────────────────────┐
│ Service Method                                                  │
│                                                                 │
│   try {                                                        │
│     // Business logic                                          │
│     return { success: true, data: result };                    │
│   } catch (error) {                                            │
│     // Log error internally                                    │
│     logger.error('MethodName failed', { error, context });     │
│                                                                │
│     // Return typed error                                      │
│     return {                                                   │
│       success: false,                                          │
│       error: {                                                 │
│         code: mapToErrorCode(error),                          │
│         message: 'User-safe message',                         │
│         details: sanitizedDetails                             │
│       }                                                        │
│     };                                                         │
│   }                                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Error Codes by Service

| Service | Common Error Codes |
|---------|-------------------|
| AuthService | `UNAUTHORIZED`, `PERMISSION_DENIED` |
| UserService | `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT` |
| ChatService | `NOT_FOUND`, `PERMISSION_DENIED` |
| MemoryService | `NOT_FOUND`, `RATE_LIMITED` |
| KnowledgeService | `NOT_FOUND`, `INVALID_STATE`, `PERMISSION_DENIED` |
| ToolService | `NOT_FOUND`, `RATE_LIMITED`, `TOOL_DISABLED` |
| SubscriptionService | `NOT_FOUND`, `QUOTA_EXCEEDED` |
| FileService | `QUOTA_EXCEEDED`, `FILE_TOO_LARGE`, `INVALID_TYPE` |

---

## 7. TESTING STRATEGY

### 7.1 What MUST Be Tested

From `methodology.md`:

- Service layer rules
- Permission checks
- Governance workflows
- Tool invocation logic

### 7.2 Test Categories

```
┌─────────────────────────────────────────────────────────────────┐
│ Unit Tests (per service)                                        │
│   - Input validation                                           │
│   - Business rule enforcement                                  │
│   - Error handling                                             │
│   - Mocked dependencies                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Integration Tests (service + DB)                                │
│   - Permission checks actually work                            │
│   - Data persists correctly                                    │
│   - Audit events are logged                                    │
│   - Transactions behave correctly                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Workflow Tests (multi-service)                                  │
│   - Knowledge publication flow                                 │
│   - User signup flow                                           │
│   - Tool invocation flow                                       │
│   - Context assembly flow                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 Test Fixtures

```typescript
// Standard test actors
const TEST_USER_ACTOR: ActorContext = {
  type: 'user',
  userId: 'test-user-id',
  requestId: 'test-request-id',
  permissions: ['chat:read', 'chat:write', 'memory:read', 'memory:write'],
};

const TEST_ADMIN_ACTOR: ActorContext = {
  type: 'admin',
  userId: 'test-admin-id',
  requestId: 'test-request-id',
  permissions: ['*'],
};

const TEST_EDITOR_ACTOR: ActorContext = {
  type: 'admin',
  userId: 'test-editor-id',
  requestId: 'test-request-id',
  permissions: ['knowledge:write', 'prompt:write'],
};
```

---

## 8. WHAT THIS STAGE DOES NOT INCLUDE

Per scope boundaries:

- **No implementation code** - contracts only
- **No HTTP/REST endpoints** - Stage 6
- **No AI/LLM logic** - Stage 4
- **No tool execution** - Stage 5
- **No schema changes** - Stage 1 is immutable

---

## 9. ASSUMPTIONS & NOTES

### 9.1 Assumptions

1. TypeScript as implementation language
2. Supabase JS client for database access
3. Service layer runs on Vercel serverless
4. All services are stateless

### 9.2 Notes for Stage 4 (AI Orchestrator)

From your approval notes:

> In Stage 4, define one orchestrator identity to avoid ambiguity

The `AI_ACTOR` constant is prepared for this. Stage 4 will define how the orchestrator identifies itself in audit logs.

### 9.3 Notes for Implementation

> Usage aggregation: Batch writes in service layer (not on hot paths)

`SubscriptionService.recordUsage()` should be called asynchronously or batched, not inline with user requests.

---

## 10. NEXT STEPS

**Stage 2 is now APPROVED.**

### Corrected Build Order

```
Stage 3a: Minimal API Shell
    ↓
Stage 4: AI Orchestrator
    ↓
Stage 3b: Expand API (streaming, tools, admin)
    ↓
Stage 5: Tool Execution Layer
```

### Stage 3a: Minimal API Shell (NEXT)

Build just enough API to validate services:
- ActorContext construction from auth token
- Auth boundary (token validation)
- One chat endpoint (POST /chats/{id}/messages)
- Streaming stub (SSE scaffold)

**Why minimal API first:**
- Forces reality check on service ergonomics
- Validates ActorContext construction works
- Enables early mobile/web testing
- Prevents AI layer from shaping APIs incorrectly

### After Stage 3a

Proceed to Stage 4 (AI Orchestrator) with a working API to test against.

---

**STAGE 2 COMPLETE - PROCEEDING TO STAGE 3a (MINIMAL API)**
