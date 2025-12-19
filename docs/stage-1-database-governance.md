# STAGE 1: DATABASE & GOVERNANCE LAYER

**Layer**: 1 of 6
**Status**: APPROVED
**References**: `master_architecture_prompt_for_claude_code.md` (Stage 1), `development_methodology_ci_cd_platform_stack.md` (Section 8)

---

## 0. FOUNDATIONAL RULES

### 0.1 UUID Strategy

**All UUIDs SHALL be UUIDv7 unless otherwise specified.**

Rationale:
- Time-sortable (better index locality)
- Better pagination performance
- Natural audit ordering
- Supabase supports this natively

Implementation:
```sql
-- Use uuid_generate_v7() instead of gen_random_uuid()
-- Supabase: SELECT extensions.uuid_generate_v7();
```

### 0.2 Tenant Readiness Rule

**All user-owned tables MUST be tenant-safe (no global joins).**

This means:
- No queries that join across all users without explicit scoping
- Service layer always includes user_id/tenant_id in queries
- Prepares for future multi-tenancy without schema changes

---

## 1. CONCEPTUAL DATA MODEL

### 1.1 Domain Overview

The system manages these core domains:

```
+------------------+     +------------------+     +------------------+
|     IDENTITY     |     |   GOVERNANCE     |     |   AI RUNTIME     |
+------------------+     +------------------+     +------------------+
| - Users          |     | - Roles          |     | - Chats          |
| - Profiles       |     | - Permissions    |     | - Messages       |
| - Auth Sessions  |     | - Approval Flows |     | - Memory         |
|                  |     | - Audit Logs     |     | - AI Preferences |
+------------------+     +------------------+     +------------------+
         |                       |                       |
         +-----------+-----------+-----------+-----------+
                     |                       |
              +------+------+         +------+------+
              |   CONTENT   |         |   TOOLING   |
              +-------------+         +-------------+
              | - Knowledge |         | - Tool Reg  |
              | - Files     |         | - Tool Logs |
              | - Sys Prompts|        | - MCP/n8n   |
              +-------------+         +-------------+
                     |
              +------+------+
              |  BILLING    |
              +-------------+
              | - Subscript.|
              | - Entitle.  |
              | - Usage     |
              +-------------+
```

### 1.2 Entity Relationships (Conceptual)

```
USER (1) ----< (M) USER_ROLE >---- (1) ROLE
  |                                    |
  |                                    |
  +--< PROFILE (1:1)                   +--< ROLE_PERMISSION >-- PERMISSION
  |
  +--< CHAT (1:M) ----< MESSAGE (1:M)
  |
  +--< AI_PREFERENCE (1:1)
  |
  +--< MEMORY (1:M) ----< MEMORY_VECTOR (1:M)
  |
  +--< FILE (1:M)
  |
  +--< SUBSCRIPTION (1:M) ----< ENTITLEMENT (1:M)

ADMIN (is a USER with elevated ROLE)
  |
  +--< KNOWLEDGE_ITEM (authored_by)
  |
  +--< SYSTEM_PROMPT (authored_by)
  |
  +--< APPROVAL_REQUEST (reviewer)

TOOL_REGISTRY (system-wide)
  |
  +--< TOOL_INVOCATION_LOG (per execution)

AUDIT_LOG (immutable, system-wide)
```

### 1.3 Core Entities Explained

| Entity | Purpose | Why It Exists |
|--------|---------|---------------|
| `users` | Identity anchor | Single source of truth for all user-related data |
| `profiles` | Display data only | Separates mutable presentation from identity |
| `roles` | Named permission sets | Enables RBAC without hardcoding |
| `permissions` | Atomic capabilities | Fine-grained access control |
| `audit_logs` | Immutable event store | Compliance, debugging, trust |
| `chats` | Conversation containers | Groups messages, owns context |
| `messages` | Individual turns | AI and user utterances |
| `ai_preferences` | User's AI settings | Explicit personalization (no silent inference) |
| `memories` | Long-term knowledge | User-specific facts AI can recall |
| `memory_vectors` | Embedding references | Enables semantic search |
| `files` | User uploads | Decoupled from messages |
| `subscriptions` | Billing relationship | Ties user to plan |
| `entitlements` | Feature access | What subscription unlocks |
| `knowledge_items` | RAG content | Admin-governed knowledge base |
| `system_prompts` | AI behavior config | Governed, versioned prompts |
| `tool_registry` | Available tools | Declarative tool definitions |
| `tool_invocation_logs` | Execution audit | Every tool call recorded |
| `approval_requests` | Governance workflow | Changes require review |

---

## 2. LOGICAL SCHEMA

### 2.1 Identity Domain

```sql
-- Core identity (Supabase auth.users is the source)
-- This table extends Supabase auth with application data

CREATE TABLE users (
    id              UUID PRIMARY KEY REFERENCES auth.users(id),
    email           TEXT NOT NULL UNIQUE,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ -- soft delete
);

-- Presentation layer only - never used for auth decisions
CREATE TABLE profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name    TEXT,
    avatar_url      TEXT,
    timezone        TEXT DEFAULT 'UTC',
    locale          TEXT DEFAULT 'en',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Why separate `users` from `profiles`?**
- `users` is for identity/auth decisions (immutable email, status)
- `profiles` is for UI presentation (mutable, user-controlled)
- Prevents UI changes from affecting auth logic

### 2.2 Authorization Domain

```sql
-- Permissions are atomic capabilities
CREATE TABLE permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            TEXT NOT NULL UNIQUE,  -- e.g., 'knowledge:publish'
    description     TEXT NOT NULL,
    category        TEXT NOT NULL,         -- e.g., 'knowledge', 'admin', 'chat'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Roles are named collections of permissions
CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,  -- e.g., 'editor', 'reviewer', 'auditor'
    description     TEXT NOT NULL,
    is_system       BOOLEAN NOT NULL DEFAULT false, -- system roles can't be deleted
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: roles have permissions
CREATE TABLE role_permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(role_id, permission_id)
);

-- Many-to-many: users have roles
CREATE TABLE user_roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    granted_by      UUID REFERENCES users(id),  -- who assigned this role
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,  -- optional expiration
    UNIQUE(user_id, role_id)
);
```

**Why this RBAC model?**
- Admins are USERS with elevated ROLES (not special entities)
- Permissions are atomic (can be combined flexibly)
- Role assignment is auditable (granted_by)
- Supports temporary elevations (expires_at)

### 2.3 Audit Domain

```sql
-- Immutable audit log - NEVER updated or deleted
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id        UUID REFERENCES users(id),  -- NULL for system actions
    actor_type      TEXT NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'ai')),
    action          TEXT NOT NULL,              -- e.g., 'knowledge:publish', 'role:assign'
    resource_type   TEXT NOT NULL,              -- e.g., 'knowledge_item', 'user'
    resource_id     UUID,                       -- ID of affected resource
    details         JSONB NOT NULL DEFAULT '{}',-- action-specific data
    ip_address      INET,
    user_agent      TEXT,
    request_id      UUID                        -- correlation ID for tracing
);

-- Index for common queries
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id, timestamp DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action, timestamp DESC);
```

**Why immutable audit logs?**
- Compliance requirement
- Trust foundation
- Debugging complex issues
- Prevents evidence tampering

**actor_type and actor_id Relationship:**
| actor_type | actor_id | Meaning |
|------------|----------|---------|
| `user` | UUID | Regular user performed action |
| `admin` | UUID | Admin user performed action |
| `system` | NULL | Automated system action (cron, trigger) |
| `ai` | NULL | AI orchestrator initiated action |

This redundancy is intentional: `actor_type` enables fast filtering without joins, while `actor_id` provides traceability when applicable.

### 2.4 Chat & Messages Domain

```sql
-- Chat is a conversation container
CREATE TABLE chats (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived', 'deleted')),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- Messages are individual turns in a chat
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content         TEXT NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}',  -- token counts, model used, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_chat ON messages(chat_id, created_at);
```

**Why separate chats from messages?**
- Chat owns context and lifecycle
- Messages are immutable turns
- Enables chat-level operations (archive, delete)

**Message Mutability Policy (CRITICAL):**

Messages are **append-only**. This is non-negotiable for:
- Trust (users see what AI saw)
- Audit (reproducible conversations)
- AI replay (consistent context reconstruction)

| Operation | Allowed? | Implementation |
|-----------|----------|----------------|
| Create | Yes | Normal INSERT |
| Read | Yes | Normal SELECT |
| Edit content | No | Create new message with `metadata.replaces_id` |
| Soft delete | Yes | Set `metadata.redacted = true`, keep record |
| Hard delete | No | Never (use redaction instead) |

If a user "edits" a message, the service layer creates a NEW message and marks the old one as superseded in metadata.

### 2.5 AI Preferences Domain

```sql
-- Explicit user preferences for AI behavior
CREATE TABLE ai_preferences (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

    -- Communication style
    response_length TEXT DEFAULT 'balanced'
                    CHECK (response_length IN ('concise', 'balanced', 'detailed')),
    formality       TEXT DEFAULT 'neutral'
                    CHECK (formality IN ('casual', 'neutral', 'formal')),

    -- Capabilities
    allow_memory    BOOLEAN NOT NULL DEFAULT true,
    allow_web_search BOOLEAN NOT NULL DEFAULT false,

    -- Custom instructions (user-authored)
    custom_instructions TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Why explicit preferences?**
- No silent inference (architectural principle #8)
- User controls their AI experience
- Auditable and transparent

### 2.6 Memory Domain

```sql
-- Long-term user memories (facts the AI remembers)
CREATE TABLE memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,              -- the actual memory
    category        TEXT,                       -- optional categorization
    source          TEXT NOT NULL DEFAULT 'conversation'
                    CHECK (source IN ('conversation', 'user_input', 'system')),
    importance      INTEGER DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'archived', 'deleted')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed   TIMESTAMPTZ
);

-- Vector embeddings for semantic search
CREATE TABLE memory_vectors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    memory_id       UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    embedding       vector(1536),               -- OpenAI ada-002 dimension
    model           TEXT NOT NULL,              -- which model created this
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_vectors_embedding ON memory_vectors
    USING ivfflat (embedding vector_cosine_ops);
```

**Why separate memories from vectors?**
- Memory is the logical fact
- Vector is a technical artifact (model-dependent)
- Supports re-embedding when models change
- Design for replacement (principle #10)

### 2.7 File Management Domain

```sql
CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    storage_path    TEXT NOT NULL,              -- path in object storage
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('uploading', 'active', 'deleted')),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- Link files to messages (many-to-many)
CREATE TABLE message_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    file_id         UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    UNIQUE(message_id, file_id)
);
```

### 2.8 Subscription & Entitlements Domain

```sql
-- Subscription plans (system-defined)
CREATE TABLE plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,       -- 'free', 'pro', 'enterprise'
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User subscriptions
CREATE TABLE subscriptions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id         UUID NOT NULL REFERENCES plans(id),
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'canceled', 'past_due', 'expired')),
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end   TIMESTAMPTZ NOT NULL,
    external_id     TEXT,                       -- Stripe subscription ID, etc.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What each plan unlocks
CREATE TABLE entitlements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id         UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    feature_code    TEXT NOT NULL,              -- 'max_messages_per_day', 'web_search'
    value           JSONB NOT NULL,             -- {"limit": 100} or {"enabled": true}
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(plan_id, feature_code)
);

-- Usage tracking
CREATE TABLE usage_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_code    TEXT NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 1,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_user_period ON usage_records(user_id, period_start, period_end);
```

### 2.9 Knowledge (RAG) Governance Domain

```sql
-- Knowledge items (admin-managed RAG content)
CREATE TABLE knowledge_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    category        TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_review', 'published', 'archived')),

    -- Governance
    author_id       UUID NOT NULL REFERENCES users(id),
    reviewer_id     UUID REFERENCES users(id),
    published_at    TIMESTAMPTZ,

    -- Versioning
    version         INTEGER NOT NULL DEFAULT 1,

    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Knowledge vectors for RAG
CREATE TABLE knowledge_vectors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_id    UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    chunk_content   TEXT NOT NULL,
    embedding       vector(1536),
    model           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_knowledge_vectors_embedding ON knowledge_vectors
    USING ivfflat (embedding vector_cosine_ops);
```

### 2.10 System Prompt Governance Domain

```sql
-- System prompts (admin-managed, versioned, governed)
CREATE TABLE system_prompts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,              -- identifier
    description     TEXT,
    content         TEXT NOT NULL,              -- the actual prompt

    -- Governance
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'pending_review', 'active', 'deprecated')),
    author_id       UUID NOT NULL REFERENCES users(id),
    reviewer_id     UUID REFERENCES users(id),

    -- Versioning
    version         INTEGER NOT NULL DEFAULT 1,
    parent_id       UUID REFERENCES system_prompts(id), -- previous version

    -- Activation
    is_default      BOOLEAN NOT NULL DEFAULT false,
    activated_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one default prompt allowed
CREATE UNIQUE INDEX idx_system_prompts_default
    ON system_prompts(is_default) WHERE is_default = true;
```

### 2.11 Tool Registry Domain

```sql
-- Tool definitions (declarative)
CREATE TABLE tool_registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,
    description     TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('local', 'mcp', 'n8n')),

    -- Configuration
    config          JSONB NOT NULL,             -- type-specific config
    input_schema    JSONB NOT NULL,             -- JSON Schema for inputs
    output_schema   JSONB,                      -- JSON Schema for outputs

    -- Governance
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled', 'deprecated')),
    requires_permission TEXT,                   -- permission code required

    -- Cost tracking
    estimated_cost  JSONB,                      -- {"tokens": 1000, "latency_ms": 500}

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tool invocation logs (audit trail)
CREATE TABLE tool_invocation_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_id         UUID NOT NULL REFERENCES tool_registry(id),
    chat_id         UUID REFERENCES chats(id),
    user_id         UUID NOT NULL REFERENCES users(id),

    -- Execution details
    input           JSONB NOT NULL,
    output          JSONB,
    status          TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failure')),
    error_message   TEXT,

    -- Metrics
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    duration_ms     INTEGER,

    -- Cost tracking
    actual_cost     JSONB,                      -- actual tokens, API costs, etc.

    request_id      UUID                        -- correlation ID
);

CREATE INDEX idx_tool_logs_user ON tool_invocation_logs(user_id, started_at DESC);
CREATE INDEX idx_tool_logs_tool ON tool_invocation_logs(tool_id, started_at DESC);
```

### 2.12 Approval Workflows Domain

```sql
-- Approval requests for governed changes
CREATE TABLE approval_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What needs approval
    resource_type   TEXT NOT NULL,              -- 'knowledge_item', 'system_prompt'
    resource_id     UUID NOT NULL,
    action          TEXT NOT NULL,              -- 'publish', 'activate', 'deprecate'

    -- Workflow
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
    requester_id    UUID NOT NULL REFERENCES users(id),
    reviewer_id     UUID REFERENCES users(id),

    -- Details
    request_notes   TEXT,
    review_notes    TEXT,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at     TIMESTAMPTZ
);

CREATE INDEX idx_approval_status ON approval_requests(status, created_at DESC);
```

---

## 3. GOVERNANCE MODEL

### 3.1 RBAC Structure

```
+------------------+
|   PERMISSIONS    |  (atomic capabilities)
+------------------+
| chat:read        |
| chat:write       |
| memory:read      |
| memory:write     |
| memory:delete    |
| knowledge:read   |
| knowledge:write  |
| knowledge:publish|
| knowledge:review |
| prompt:read      |
| prompt:write     |
| prompt:activate  |
| prompt:review    |
| tool:invoke      |
| tool:manage      |
| user:read        |
| user:manage      |
| role:assign      |
| audit:read       |
| billing:manage   |
+------------------+
        |
        v
+------------------+
|     ROLES        |  (permission bundles)
+------------------+
| user             | -> chat:*, memory:*, tool:invoke
| editor           | -> user + knowledge:write, prompt:write
| reviewer         | -> editor + knowledge:review, prompt:review
| admin            | -> reviewer + knowledge:publish, prompt:activate, user:manage
| auditor          | -> audit:read (read-only, cannot modify)
| super_admin      | -> ALL (system role, cannot be deleted)
+------------------+
        |
        v
+------------------+
|     USERS        |  (assigned roles)
+------------------+
```

### 3.2 Approval Flow

```
+--------+     +---------+     +----------+     +-----------+
| DRAFT  | --> | PENDING | --> | APPROVED | --> | PUBLISHED |
+--------+     | REVIEW  |     +----------+     +-----------+
    ^          +---------+          |
    |               |               |
    |               v               |
    |          +----------+         |
    +--------- | REJECTED | <-------+
               +----------+      (can reject published)
```

**Knowledge Publication Flow:**
1. Editor creates knowledge item (status: `draft`)
2. Editor submits for review (status: `pending_review`)
3. Approval request created
4. Reviewer approves/rejects
5. If approved: status -> `published`, vectors generated
6. Audit log records all transitions

**System Prompt Activation Flow:**
1. Editor creates prompt (status: `draft`)
2. Editor submits for review (status: `pending_review`)
3. Reviewer approves
4. Admin activates (status: `active`, `is_default` = true)
5. Previous default deactivated atomically

### 3.3 Audit Log Events

| Action | Actor | Logged Data |
|--------|-------|-------------|
| `user:login` | user | ip, user_agent |
| `user:logout` | user | session_duration |
| `role:assign` | admin | target_user, role, granted_by |
| `role:revoke` | admin | target_user, role, revoked_by |
| `knowledge:create` | editor | item_id, title |
| `knowledge:submit_review` | editor | item_id, requester |
| `knowledge:approve` | reviewer | item_id, reviewer |
| `knowledge:reject` | reviewer | item_id, reviewer, reason |
| `knowledge:publish` | admin | item_id, publisher |
| `prompt:create` | editor | prompt_id, name |
| `prompt:activate` | admin | prompt_id, previous_default |
| `tool:invoke` | system | tool_id, user_id, input_hash |
| `tool:failure` | system | tool_id, error |
| `memory:create` | system | memory_id, source |
| `memory:delete` | user | memory_id |
| `subscription:change` | system | old_plan, new_plan |

---

## 4. ROW-LEVEL SECURITY (RLS) STRATEGY

### 4.1 Principles

1. **RLS mirrors service-layer permissions** (methodology rule)
2. **Defense in depth** - even if service layer fails, DB protects data
3. **User data isolation** - users can only access their own data
4. **Admin access via roles** - no hardcoded admin bypass

### 4.2 RLS Policy Overview

| Table | Read Policy | Write Policy |
|-------|-------------|--------------|
| `users` | Own record only | Own record only |
| `profiles` | Own record only | Own record only |
| `chats` | Own chats only | Own chats only |
| `messages` | Via chat ownership | Via chat ownership |
| `ai_preferences` | Own only | Own only |
| `memories` | Own only | Own only |
| `files` | Own only | Own only |
| `subscriptions` | Own only | None (service only) |
| `knowledge_items` | Published OR author | Author only |
| `system_prompts` | Active prompts | Editors only |
| `tool_registry` | Active tools | Admins only |
| `audit_logs` | Auditors only | None (system only) |
| `approval_requests` | Involved parties | Reviewers only |

### 4.3 RLS Implementation Approach

```
Service Layer (TypeScript)
    |
    | uses service role (bypasses RLS for trusted operations)
    v
+-------------------+
|    Supabase       |
|   (Postgres)      |
|                   |
|  RLS Policies     | <-- enforced for direct client access (anon/authenticated)
|                   |
+-------------------+
```

**Key insight**: Service layer uses `service_role` key (bypasses RLS) because:
- Service layer already enforces business rules
- Service layer needs cross-user access for admin operations
- RLS remains active for any direct client access (belt and suspenders)

---

## 5. MIGRATION STRATEGY

### 5.1 Principles

1. **Migrations are versioned** (methodology rule)
2. **Forward-only** - no destructive rollbacks
3. **Idempotent** - can be re-run safely
4. **Atomic** - each migration is a transaction

### 5.2 Migration Order

```
001_enable_extensions.sql
    - Enable uuid-ossp, pgvector, pg_trgm

002_identity_domain.sql
    - users, profiles

003_authorization_domain.sql
    - permissions, roles, role_permissions, user_roles

004_audit_domain.sql
    - audit_logs (with immutability constraints)

005_chat_domain.sql
    - chats, messages

006_ai_preferences_domain.sql
    - ai_preferences

007_memory_domain.sql
    - memories, memory_vectors

008_file_domain.sql
    - files, message_files

009_subscription_domain.sql
    - plans, subscriptions, entitlements, usage_records

010_knowledge_domain.sql
    - knowledge_items, knowledge_vectors

011_system_prompt_domain.sql
    - system_prompts

012_tool_domain.sql
    - tool_registry, tool_invocation_logs

013_approval_domain.sql
    - approval_requests

014_seed_permissions.sql
    - Insert default permissions

015_seed_roles.sql
    - Insert default roles (user, editor, reviewer, admin, auditor, super_admin)

016_seed_role_permissions.sql
    - Link permissions to roles

017_enable_rls.sql
    - Enable RLS on all tables
    - Create policies
```

### 5.3 Migration Tooling

Using Supabase CLI:
```bash
supabase migration new <migration_name>
supabase db push        # apply to local
supabase db push --linked # apply to remote
```

---

## 6. ARCHITECTURE DIAGRAMS

### 6.1 Data Flow (Stage 1 Context)

```
                    +------------------+
                    |   FUTURE STAGES  |
                    |  (not built yet) |
                    +------------------+
                            |
                            | will use service layer
                            v
+------------------------------------------------------------------+
|                     SERVICE LAYER (Stage 3)                       |
|  AuthService | UserService | ChatService | MemoryService | etc.  |
+------------------------------------------------------------------+
                            |
                            | service_role (bypasses RLS)
                            v
+------------------------------------------------------------------+
|                         SUPABASE                                  |
|  +------------------------------------------------------------+  |
|  |                    PostgreSQL                              |  |
|  |  +----------+  +----------+  +----------+  +----------+    |  |
|  |  | Identity |  | Auth     |  | Chat     |  | Memory   |    |  |
|  |  | Domain   |  | Domain   |  | Domain   |  | Domain   |    |  |
|  |  +----------+  +----------+  +----------+  +----------+    |  |
|  |  +----------+  +----------+  +----------+  +----------+    |  |
|  |  | Files    |  | Billing  |  | Knowledge|  | Tools    |    |  |
|  |  | Domain   |  | Domain   |  | Domain   |  | Domain   |    |  |
|  |  +----------+  +----------+  +----------+  +----------+    |  |
|  |  +----------+  +----------+                                |  |
|  |  | Audit    |  | Approval |   RLS Policies Active          |  |
|  |  | Domain   |  | Domain   |                                |  |
|  |  +----------+  +----------+                                |  |
|  +------------------------------------------------------------+  |
|  |                    pgvector                                |  |
|  |  memory_vectors | knowledge_vectors                        |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+
```

### 6.2 RBAC Resolution Flow

```
Request: "Can user X do action Y on resource Z?"

+--------+     +-----------+     +------------------+
| User X | --> | user_roles| --> | role_permissions |
+--------+     +-----------+     +------------------+
                    |                    |
                    v                    v
              +----------+        +--------------+
              | Role IDs | -----> | Permission   |
              +----------+        | Codes        |
                                  +--------------+
                                        |
                                        v
                               +------------------+
                               | Has permission Y?|
                               +------------------+
                                   |         |
                                  YES        NO
                                   |         |
                                   v         v
                               +------+  +--------+
                               |ALLOW |  | DENY   |
                               +------+  +--------+
```

### 6.3 Approval Workflow State Machine

```
                    +-------+
                    | DRAFT |
                    +-------+
                        |
                        | submit_for_review()
                        v
                  +-----------+
                  |  PENDING  |
                  |  REVIEW   |
                  +-----------+
                   /         \
        approve() /           \ reject()
                 /             \
                v               v
          +----------+    +----------+
          | APPROVED |    | REJECTED |
          +----------+    +----------+
                |               |
                | publish()     | edit()
                v               v
          +-----------+    +-------+
          | PUBLISHED |    | DRAFT |
          +-----------+    +-------+
```

### 6.4 Entity Relationship Diagram (Simplified)

```
+----------+       +------------+       +-------------+
|  users   |------>| user_roles |<------| roles       |
+----------+       +------------+       +-------------+
     |                                        |
     |                                        v
     |                               +------------------+
     |                               | role_permissions |
     |                               +------------------+
     |                                        |
     |                                        v
     |                               +-------------+
     |                               | permissions |
     |                               +-------------+
     |
     +-------> profiles (1:1)
     |
     +-------> ai_preferences (1:1)
     |
     +-------> chats (1:M) -------> messages (1:M)
     |                                    |
     |                                    v
     |                              message_files
     |                                    |
     +-------> files (1:M) <--------------+
     |
     +-------> memories (1:M) -------> memory_vectors (1:M)
     |
     +-------> subscriptions (1:M)
     |              |
     |              v
     |         +--------+
     |         | plans  |-------> entitlements (1:M)
     |         +--------+
     |
     +-------> knowledge_items (as author)
     |              |
     |              v
     |         knowledge_vectors (1:M)
     |
     +-------> system_prompts (as author)
     |
     +-------> approval_requests (as requester/reviewer)
     |
     +-------> tool_invocation_logs (1:M)
                    |
                    v
              tool_registry
```

---

## 7. DESIGN RATIONALE & TRADE-OFFS

### 7.1 Key Decisions

| Decision | Rationale | Alternative Considered |
|----------|-----------|----------------------|
| Separate `users` from `profiles` | Auth vs presentation concerns | Single table (rejected: mixed concerns) |
| RBAC over ABAC | Simpler, sufficient for current needs | ABAC (rejected: over-engineering) |
| Soft deletes | Audit trail, recovery | Hard deletes (rejected: data loss) |
| Separate memory from vectors | Model agnosticism | Combined table (rejected: coupling) |
| Approval workflows in DB | Governance is data | Workflow engine (rejected: complexity) |
| Immutable audit logs | Compliance, trust | Mutable logs (rejected: tampering risk) |

### 7.2 Future-Proofing

| Future Scenario | How Schema Handles It |
|-----------------|----------------------|
| Model change | Re-embed vectors, schema unchanged |
| New permission | Add row to `permissions` |
| New role | Add row to `roles`, link permissions |
| Multi-tenancy | Add `tenant_id` to relevant tables |
| New tool type | `type` enum extension |
| Audit compliance | `audit_logs` already immutable |

---

## 8. ASSUMPTIONS

1. Supabase auth handles authentication (we extend, not replace)
2. Single-tenant initially (multi-tenant deferred)
3. Vector dimension 1536 (OpenAI ada-002, configurable)
4. USD-based billing (internationalization deferred)

---

## 9. PLATFORM DATA POLICIES (v1)

These policies are **locked** and guide all service layer implementations.

### 9.1 Summary

> - User memories are retained indefinitely unless explicitly deleted by the user.
> - Knowledge items retain full version history; only one version is active.
> - Tool costs are tracked per invocation and aggregated for billing.
> - File storage limits are enforced via entitlements, not schema constraints.
> - Audit logs are immutable and retained indefinitely with tiered storage.

### 9.2 Memory Retention Policy

**Principle**: Memory is a feature, not a cache.

| Rule | Value |
|------|-------|
| Default retention | Indefinite |
| Auto-archive | After 180 days of no access |
| Auto-delete | Never |
| User override | Always allowed (view, edit, archive, delete) |
| Importance decay | Optional (future enhancement) |

**Rationale:**
- Personalization improves over time
- Users hate "AI forgot me"
- Storage is cheap, trust is expensive

### 9.3 Knowledge Versioning Policy

**Principle**: Knowledge should age like law, not logs.

| Rule | Value |
|------|-------|
| Version retention | Infinite (full history) |
| Active version | 1 per knowledge item |
| Rollback | Manual by admin |
| Deletion | Admin-only + audit required |

**Rationale:**
- Knowledge is institutional memory
- Regulatory and trust requirements
- Storage cost is trivial vs human effort

### 9.4 Tool Cost Tracking Policy

**Principle**: Dual-layer tracking (raw + aggregated).

| Layer | Storage | Retention |
|-------|---------|-----------|
| Per-invocation | `tool_invocation_logs.actual_cost` | 90 days |
| Aggregated | `usage_records` | Indefinite |

**Rationale:**
- Debugging needs raw data (short-term)
- Billing needs summaries (long-term)
- Keeps tables performant

### 9.5 File Storage Quotas Policy

**Principle**: Limits are business logic, not schema logic.

File limits come from **entitlements**, not hardcoded constraints.

| Example Feature Code | Example Value |
|---------------------|---------------|
| `max_file_size_mb` | 20 |
| `total_storage_mb` | 500 |
| `max_files_per_user` | 100 |

**Enforcement:**
- Service layer checks entitlements before upload
- DB stores facts, service enforces limits
- Soft-fail with clear UX errors

**Rationale:**
- Plans change
- Promotions exist
- Enterprise customers negotiate

### 9.6 Audit Log Retention Policy

**Principle**: Audit logs are evidence, not telemetry.

| Tier | Retention | Storage |
|------|-----------|---------|
| Hot (recent) | 90 days | Primary DB |
| Warm | 1 year | Partitioned / cheaper storage |
| Cold | 7+ years | Archive storage |
| Deletion | Never | N/A |

**Rationale:**
- Compliance-ready (GDPR, SOC2, etc.)
- Forensics-safe
- Doesn't kill DB performance (tiered approach)

---

## 10. WHAT THIS STAGE DOES NOT INCLUDE (Scope Boundaries)

Per architectural requirements, this stage explicitly excludes:

- No services (Stage 3)
- No APIs (Stage 6)
- No frontend (Stage 7)
- No agents (AI is Stage 4)
- No tool orchestration (Stage 5)

The database and governance layer is **foundational**. Everything else builds on it.

---

## 11. NEXT STEPS

**Stage 1 is now APPROVED.**

Implementation sequence:

1. Create migration files (using UUIDv7)
2. Set up Supabase project
3. Apply migrations
4. Seed initial data (permissions, roles)
5. Verify RLS policies
6. Proceed to **Stage 2: Service Layer**

---

**STAGE 1 COMPLETE - READY FOR IMPLEMENTATION**
