# STAGE 3b: EXPAND API

**Layer**: 3b of 6
**Status**: ✅ APPROVED & LOCKED
**References**:
- `docs/stage-1-database-governance.md` (IMMUTABLE)
- `docs/stage-2-service-layer.md` (IMMUTABLE)
- `docs/stage-3a-minimal-api.md` (IMMUTABLE)
- `docs/stage-4-ai-orchestrator.md` (IMMUTABLE)
- `docs/architecture.md`

---

## 0. PURPOSE OF THIS STAGE

Expand the minimal API shell (Stage 3a) to expose the **full control surface** required by:
- AI Orchestrator (Stage 4)
- Frontend (Flutter web/mobile)
- Admin dashboards
- CLI tools
- External integrations

### 0.1 What This Stage IS Allowed To Do

| Allowed | Description |
|---------|-------------|
| ✅ Expose service capabilities | HTTP interface to Stage 2 services |
| ✅ Admin & governance visibility | Endpoints for audit, approvals, system state |
| ✅ UI/mobile/CLI integration | Consistent JSON contracts |
| ✅ Support orchestrator I/O | Context building, response persistence |
| ✅ Pagination, filtering, versioning | Standard query patterns |

### 0.2 What This Stage is NOT Allowed To Do

| Prohibited | Reason |
|------------|--------|
| ❌ Add business logic | Business logic lives in Service Layer (Stage 2) |
| ❌ Add orchestration logic | Orchestration lives in AI Orchestrator (Stage 4) |
| ❌ Make authorization decisions | Services enforce permissions |
| ❌ Touch prompt logic | Prompt assembly is Stage 4 |
| ❌ Call tools directly | Tools are called via ToolService |
| ❌ Introduce async workers | Background workers are Stage 5 |

### 0.3 API Layer Invariant

```
┌─────────────────────────────────────────────────────────────────┐
│                         API LAYER RULE                          │
│                                                                 │
│   API endpoints are THIN WRAPPERS around Service Layer.         │
│                                                                 │
│   Every endpoint MUST:                                          │
│   1. Parse request → call exactly ONE service method            │
│   2. Transform Result<T,E> → HTTP response                      │
│   3. NO business logic in between                               │
│                                                                 │
│   If you need logic, it belongs in Service Layer.               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. API DESIGN STANDARDS

### 1.1 URL Structure

```
/api/v1/{resource}                    # Collection
/api/v1/{resource}/{id}               # Single resource
/api/v1/{resource}/{id}/{subresource} # Nested resource
```

**Versioning**: All endpoints are prefixed with `/api/v1`. Breaking changes require `/api/v2`.

### 1.2 HTTP Methods

| Method | Usage |
|--------|-------|
| `GET` | Read resource(s), idempotent |
| `POST` | Create resource OR trigger action |
| `PATCH` | Partial update |
| `PUT` | Full replace (rarely used) |
| `DELETE` | Remove resource |

### 1.3 Standard Response Format

**Success Response**:

```typescript
interface SuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: PaginationMeta;
    requestId: string;
  };
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}
```

**Error Response** (from Stage 3a):

```typescript
interface ErrorResponse {
  error: {
    code: string;           // Machine-readable code
    message: string;        // Human-readable message
    details?: unknown;      // Additional context
    requestId: string;      // For support/debugging
  };
}
```

### 1.4 Pagination Standard

All list endpoints support pagination:

```
GET /api/v1/chats?page=1&pageSize=20
```

**Parameters**:

| Param | Type | Default | Max |
|-------|------|---------|-----|
| `page` | number | 1 | - |
| `pageSize` | number | 20 | 100 |

**Response**:

```json
{
  "data": [...],
  "meta": {
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "totalItems": 150,
      "totalPages": 8,
      "hasNext": true,
      "hasPrev": false
    },
    "requestId": "01234567-89ab-cdef..."
  }
}
```

### 1.5 Filtering Standard

Filters use query parameters:

```
GET /api/v1/memories?category=preference&importance_gte=7
```

**Filter Operators**:

| Suffix | Meaning | Example |
|--------|---------|---------|
| (none) | Exact match | `status=active` |
| `_gte` | Greater than or equal | `importance_gte=5` |
| `_lte` | Less than or equal | `created_at_lte=2024-01-01` |
| `_contains` | String contains | `title_contains=react` |
| `_in` | Value in list | `status_in=active,pending` |

### 1.6 Sorting Standard

```
GET /api/v1/chats?sort=-updated_at,title
```

- Prefix `-` for descending
- Comma-separated for multiple fields
- Default: `-created_at` (newest first)

### 1.7 Authentication

All endpoints (except `/api/v1/health`) require authentication.

**Header**: `Authorization: Bearer <jwt>`

The JWT is obtained from Supabase Auth and validated by `authMiddleware` (Stage 3a).

---

## 2. ENDPOINT CATALOG

### 2.0 Endpoint Summary Table

| Group | Endpoint | Method | Description |
|-------|----------|--------|-------------|
| **Health** | `/api/v1/health` | GET | Health check |
| **Chat** | `/api/v1/chats` | GET, POST | List/create chats |
| **Chat** | `/api/v1/chats/:id` | GET, PATCH, DELETE | Get/update/delete chat |
| **Chat** | `/api/v1/chats/:id/messages` | GET, POST | List/add messages |
| **Chat** | `/api/v1/chats/:id/stream` | GET | SSE stream (orchestrator) |
| **User** | `/api/v1/users/me` | GET, PATCH | Current user profile |
| **User** | `/api/v1/users/me/preferences` | GET, PUT | AI preferences |
| **Memory** | `/api/v1/memories` | GET, POST | List/create memories |
| **Memory** | `/api/v1/memories/:id` | GET, PATCH, DELETE | Get/update/delete memory |
| **Knowledge** | `/api/v1/knowledge` | GET, POST | List/create items |
| **Knowledge** | `/api/v1/knowledge/:id` | GET, PATCH, DELETE | Get/update/delete item |
| **Knowledge** | `/api/v1/knowledge/:id/publish` | POST | Publish item |
| **Tools** | `/api/v1/tools` | GET | List available tools |
| **Tools** | `/api/v1/tools/:id` | GET | Get tool details |
| **Subscription** | `/api/v1/subscription` | GET | Current subscription |
| **Subscription** | `/api/v1/subscription/usage` | GET | Usage summary |
| **Subscription** | `/api/v1/subscription/entitlements` | GET | Active entitlements |
| **Admin** | `/api/v1/admin/users` | GET | List users (admin) |
| **Admin** | `/api/v1/admin/users/:id` | GET, PATCH | Get/update user (admin) |
| **Admin** | `/api/v1/admin/users/:id/roles` | GET, POST, DELETE | Manage user roles |
| **Admin** | `/api/v1/admin/audit` | GET | Query audit logs |
| **Admin** | `/api/v1/admin/prompts` | GET, POST | List/create system prompts |
| **Admin** | `/api/v1/admin/prompts/:id` | GET, PATCH | Get/update prompt |
| **Admin** | `/api/v1/admin/prompts/:id/activate` | POST | Activate prompt |
| **Admin** | `/api/v1/admin/approvals` | GET | List pending approvals |
| **Admin** | `/api/v1/admin/approvals/:id` | GET, POST | Get/action approval |
| **Admin** | `/api/v1/admin/tools` | GET, POST | Manage tool registry |
| **Admin** | `/api/v1/admin/tools/:id` | GET, PATCH, DELETE | Tool CRUD |

---

## 3. CHAT ENDPOINTS (Expanded from Stage 3a)

### 3.1 List Chats

```
GET /api/v1/chats
```

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `pageSize` | number | Items per page (default: 20, max: 100) |
| `sort` | string | Sort field (default: `-updated_at`) |
| `archived` | boolean | Filter by archived status |

**Response** (200 OK):

```json
{
  "data": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "title": "Help with React",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T14:22:00Z",
      "messageCount": 12,
      "archived": false
    }
  ],
  "meta": {
    "pagination": { "page": 1, "pageSize": 20, "totalItems": 45, "totalPages": 3, "hasNext": true, "hasPrev": false },
    "requestId": "..."
  }
}
```

**Implementation**:

```typescript
app.get('/api/v1/chats', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const { page, pageSize, sort, archived } = parseQueryParams(c.req.query());

  const result = await chatService.listChats(actor, {
    pagination: { page, pageSize },
    sort: parseSort(sort),
    filters: archived !== undefined ? { archived } : undefined,
  });

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: result.data.items,
    meta: {
      pagination: result.data.pagination,
      requestId: actor.requestId,
    },
  });
});
```

### 3.2 Create Chat (from Stage 3a)

```
POST /api/v1/chats
```

**Request Body**:

```json
{
  "title": "New conversation",
  "metadata": {}
}
```

**Response** (201 Created):

```json
{
  "data": {
    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "title": "New conversation",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z",
    "messageCount": 0,
    "archived": false
  },
  "meta": { "requestId": "..." }
}
```

### 3.3 Get Chat

```
GET /api/v1/chats/:id
```

**Response** (200 OK):

```json
{
  "data": {
    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "title": "Help with React",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T14:22:00Z",
    "messageCount": 12,
    "archived": false,
    "metadata": {}
  },
  "meta": { "requestId": "..." }
}
```

### 3.4 Update Chat

```
PATCH /api/v1/chats/:id
```

**Request Body**:

```json
{
  "title": "Updated title",
  "archived": true
}
```

**Response** (200 OK): Updated chat object

### 3.5 Delete Chat

```
DELETE /api/v1/chats/:id
```

**Response** (204 No Content)

### 3.6 List Messages

```
GET /api/v1/chats/:id/messages
```

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Items per page |
| `before` | string | Messages before this ID (cursor) |
| `after` | string | Messages after this ID (cursor) |

**Response** (200 OK):

```json
{
  "data": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "role": "user",
      "content": "How do I use React hooks?",
      "createdAt": "2024-01-15T10:31:00Z",
      "metadata": {}
    },
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      "role": "assistant",
      "content": "React hooks are functions that...",
      "createdAt": "2024-01-15T10:31:05Z",
      "metadata": {
        "model": "claude-sonnet-4-20250514",
        "tokenCount": 150
      }
    }
  ],
  "meta": {
    "pagination": { ... },
    "requestId": "..."
  }
}
```

### 3.7 Add Message (Non-streaming)

```
POST /api/v1/chats/:id/messages
```

**Request Body**:

```json
{
  "content": "Hello, can you help me?",
  "stream": false
}
```

**Response** (201 Created):

```json
{
  "data": {
    "userMessage": {
      "id": "...",
      "role": "user",
      "content": "Hello, can you help me?",
      "createdAt": "..."
    },
    "assistantMessage": {
      "id": "...",
      "role": "assistant",
      "content": "Of course! How can I assist you today?",
      "createdAt": "...",
      "metadata": {
        "model": "claude-sonnet-4-20250514",
        "tokenCount": 25
      }
    }
  },
  "meta": { "requestId": "..." }
}
```

### 3.8 Stream Response (SSE)

```
GET /api/v1/chats/:id/stream?message=<encoded_message>
```

See Stage 4, Section 6 for full SSE implementation.

---

## 4. USER ENDPOINTS

### 4.1 Get Current User

```
GET /api/v1/users/me
```

**Response** (200 OK):

```json
{
  "data": {
    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "email": "user@example.com",
    "displayName": "John Doe",
    "avatarUrl": "https://...",
    "createdAt": "2024-01-01T00:00:00Z",
    "roles": ["user"],
    "subscription": {
      "planCode": "pro",
      "status": "active"
    }
  },
  "meta": { "requestId": "..." }
}
```

**Implementation**:

```typescript
app.get('/api/v1/users/me', authMiddleware, async (c) => {
  const actor = c.get('actor');

  const result = await userService.getProfile(actor, actor.userId!);

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: result.data,
    meta: { requestId: actor.requestId },
  });
});
```

### 4.2 Update Current User

```
PATCH /api/v1/users/me
```

**Request Body**:

```json
{
  "displayName": "Jane Doe",
  "avatarUrl": "https://..."
}
```

**Response** (200 OK): Updated user object

### 4.3 Get AI Preferences

```
GET /api/v1/users/me/preferences
```

**Response** (200 OK):

```json
{
  "data": {
    "responseLength": "balanced",
    "formality": "neutral",
    "customInstructions": "Always provide code examples in TypeScript",
    "updatedAt": "2024-01-15T10:00:00Z"
  },
  "meta": { "requestId": "..." }
}
```

### 4.4 Update AI Preferences

```
PUT /api/v1/users/me/preferences
```

**Request Body**:

```json
{
  "responseLength": "detailed",
  "formality": "formal",
  "customInstructions": "Focus on best practices and security"
}
```

**Validation**:

| Field | Allowed Values |
|-------|----------------|
| `responseLength` | `concise`, `balanced`, `detailed` |
| `formality` | `casual`, `neutral`, `formal` |
| `customInstructions` | string (max 2000 chars) |

**Response** (200 OK): Updated preferences

---

## 5. MEMORY ENDPOINTS

### 5.1 List Memories

```
GET /api/v1/memories
```

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Items per page |
| `category` | string | Filter by category |
| `importance_gte` | number | Min importance (1-10) |
| `search` | string | Semantic search query |
| `sort` | string | Sort field |

**Response** (200 OK):

```json
{
  "data": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "content": "User prefers TypeScript over JavaScript",
      "category": "preference",
      "importance": 8,
      "source": "conversation",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  ],
  "meta": {
    "pagination": { ... },
    "requestId": "..."
  }
}
```

**Implementation**:

```typescript
app.get('/api/v1/memories', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const { page, pageSize, category, importance_gte, search, sort } = parseQueryParams(c.req.query());

  // If search query provided, use semantic search
  if (search) {
    const result = await memoryService.searchMemories(actor, {
      userId: actor.userId!,
      query: search,
      limit: pageSize,
      filters: { category, minImportance: importance_gte },
    });

    if (!result.success) {
      return errorResponse(c, result.error, actor.requestId);
    }

    return c.json({
      data: result.data,
      meta: { requestId: actor.requestId },
    });
  }

  // Otherwise, standard list
  const result = await memoryService.listMemories(actor, {
    userId: actor.userId!,
    pagination: { page, pageSize },
    filters: { category, minImportance: importance_gte },
    sort: parseSort(sort),
  });

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: result.data.items,
    meta: {
      pagination: result.data.pagination,
      requestId: actor.requestId,
    },
  });
});
```

### 5.2 Create Memory

```
POST /api/v1/memories
```

**Request Body**:

```json
{
  "content": "User is learning Rust programming",
  "category": "interest",
  "importance": 6
}
```

**Response** (201 Created):

```json
{
  "data": {
    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "content": "User is learning Rust programming",
    "category": "interest",
    "importance": 6,
    "source": "user_created",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  },
  "meta": { "requestId": "..." }
}
```

### 5.3 Get Memory

```
GET /api/v1/memories/:id
```

**Response** (200 OK): Single memory object

### 5.4 Update Memory

```
PATCH /api/v1/memories/:id
```

**Request Body**:

```json
{
  "content": "User is proficient in Rust programming",
  "importance": 8
}
```

**Response** (200 OK): Updated memory

### 5.5 Delete Memory

```
DELETE /api/v1/memories/:id
```

**Response** (204 No Content)

---

## 6. KNOWLEDGE ENDPOINTS

### 6.1 List Knowledge Items

```
GET /api/v1/knowledge
```

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Items per page |
| `status` | string | Filter: `draft`, `published`, `archived` |
| `search` | string | Semantic search query |
| `sort` | string | Sort field |

**Response** (200 OK):

```json
{
  "data": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "title": "Company Policies",
      "contentType": "markdown",
      "status": "published",
      "version": 3,
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-15T10:30:00Z",
      "publishedAt": "2024-01-10T00:00:00Z"
    }
  ],
  "meta": {
    "pagination": { ... },
    "requestId": "..."
  }
}
```

### 6.2 Create Knowledge Item

```
POST /api/v1/knowledge
```

**Request Body**:

```json
{
  "title": "Product FAQ",
  "content": "# Frequently Asked Questions\n\n## How do I...",
  "contentType": "markdown",
  "metadata": {
    "source": "internal_docs"
  }
}
```

**Response** (201 Created): Created item (status: `draft`)

### 6.3 Get Knowledge Item

```
GET /api/v1/knowledge/:id
```

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `version` | number | Get specific version (optional) |

**Response** (200 OK):

```json
{
  "data": {
    "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    "title": "Product FAQ",
    "content": "# Frequently Asked Questions...",
    "contentType": "markdown",
    "status": "published",
    "version": 2,
    "versions": [
      { "version": 1, "createdAt": "2024-01-01T00:00:00Z" },
      { "version": 2, "createdAt": "2024-01-10T00:00:00Z" }
    ],
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-10T00:00:00Z"
  },
  "meta": { "requestId": "..." }
}
```

### 6.4 Update Knowledge Item

```
PATCH /api/v1/knowledge/:id
```

**Request Body**:

```json
{
  "title": "Updated FAQ",
  "content": "# Updated content..."
}
```

**Note**: Updates create a new version. Previous versions are retained.

**Response** (200 OK): Updated item with incremented version

### 6.5 Delete Knowledge Item

```
DELETE /api/v1/knowledge/:id
```

**Response** (204 No Content)

### 6.6 Publish Knowledge Item

```
POST /api/v1/knowledge/:id/publish
```

**Request Body** (optional):

```json
{
  "version": 2
}
```

**Note**: Schedules embedding generation (async). Publishing makes the item searchable.

**Response** (200 OK):

```json
{
  "data": {
    "id": "...",
    "status": "published",
    "publishedAt": "2024-01-15T10:30:00Z",
    "embeddingStatus": "pending"
  },
  "meta": { "requestId": "..." }
}
```

---

## 7. TOOL ENDPOINTS

### 7.1 List Available Tools

```
GET /api/v1/tools
```

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `type` | string | Filter: `local`, `mcp`, `n8n` |
| `enabled` | boolean | Filter by enabled status |

**Response** (200 OK):

```json
{
  "data": [
    {
      "id": "tool-web-search",
      "name": "web_search",
      "description": "Search the web for current information",
      "type": "mcp",
      "enabled": true,
      "requiresPermission": "tool:web_search",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string" },
          "count": { "type": "number", "default": 5 }
        },
        "required": ["query"]
      }
    }
  ],
  "meta": { "requestId": "..." }
}
```

**Implementation**:

```typescript
app.get('/api/v1/tools', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const { type, enabled } = parseQueryParams(c.req.query());

  // List tools available to this user (based on permissions)
  const result = await toolService.listAvailableTools(actor, {
    userId: actor.userId!,
    filters: { type, enabled },
  });

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: result.data,
    meta: { requestId: actor.requestId },
  });
});
```

### 7.2 Get Tool Details

```
GET /api/v1/tools/:id
```

**Response** (200 OK):

```json
{
  "data": {
    "id": "tool-web-search",
    "name": "web_search",
    "description": "Search the web for current information",
    "type": "mcp",
    "enabled": true,
    "requiresPermission": "tool:web_search",
    "userHasPermission": true,
    "inputSchema": { ... },
    "estimatedCost": {
      "fixedCost": 0.01,
      "costPerUnit": { "unit": "record", "cost": 0.001 }
    },
    "rateLimit": {
      "maxPerHour": 100,
      "currentUsage": 12
    }
  },
  "meta": { "requestId": "..." }
}
```

---

## 8. SUBSCRIPTION & USAGE ENDPOINTS

### 8.1 Get Current Subscription

```
GET /api/v1/subscription
```

**Response** (200 OK):

```json
{
  "data": {
    "planCode": "pro",
    "planName": "Professional",
    "status": "active",
    "currentPeriodStart": "2024-01-01T00:00:00Z",
    "currentPeriodEnd": "2024-02-01T00:00:00Z",
    "cancelAtPeriodEnd": false
  },
  "meta": { "requestId": "..." }
}
```

### 8.2 Get Usage Summary

```
GET /api/v1/subscription/usage
```

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `period` | string | `current`, `previous`, or date range |

**Response** (200 OK):

```json
{
  "data": {
    "period": {
      "start": "2024-01-01T00:00:00Z",
      "end": "2024-02-01T00:00:00Z"
    },
    "usage": [
      {
        "featureCode": "ai_tokens",
        "featureName": "AI Tokens",
        "used": 125000,
        "limit": 500000,
        "percentage": 25
      },
      {
        "featureCode": "tool_invocations",
        "featureName": "Tool Calls",
        "used": 45,
        "limit": 1000,
        "percentage": 4.5
      },
      {
        "featureCode": "knowledge_items",
        "featureName": "Knowledge Items",
        "used": 12,
        "limit": 100,
        "percentage": 12
      }
    ]
  },
  "meta": { "requestId": "..." }
}
```

### 8.3 Get Entitlements

```
GET /api/v1/subscription/entitlements
```

**Response** (200 OK):

```json
{
  "data": [
    {
      "featureCode": "ai_tokens",
      "type": "metered",
      "limit": 500000,
      "resetPeriod": "monthly"
    },
    {
      "featureCode": "priority_support",
      "type": "boolean",
      "enabled": true
    },
    {
      "featureCode": "custom_prompts",
      "type": "boolean",
      "enabled": true
    }
  ],
  "meta": { "requestId": "..." }
}
```

---

## 9. ADMIN ENDPOINTS

All admin endpoints require `admin:*` or specific admin permissions.

### 9.1 List Users (Admin)

```
GET /api/v1/admin/users
```

**Required Permission**: `admin:users:read`

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Items per page |
| `email_contains` | string | Search by email |
| `role` | string | Filter by role |
| `status` | string | `active`, `suspended`, `deleted` |
| `sort` | string | Sort field |

**Response** (200 OK):

```json
{
  "data": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "email": "user@example.com",
      "displayName": "John Doe",
      "status": "active",
      "roles": ["user", "beta_tester"],
      "createdAt": "2024-01-01T00:00:00Z",
      "lastLoginAt": "2024-01-15T10:30:00Z"
    }
  ],
  "meta": {
    "pagination": { ... },
    "requestId": "..."
  }
}
```

### 9.2 Get User (Admin)

```
GET /api/v1/admin/users/:id
```

**Required Permission**: `admin:users:read`

**Response** (200 OK): Full user details including subscription, usage, etc.

### 9.3 Update User (Admin)

```
PATCH /api/v1/admin/users/:id
```

**Required Permission**: `admin:users:write`

**Request Body**:

```json
{
  "status": "suspended",
  "suspensionReason": "Terms of service violation"
}
```

**Response** (200 OK): Updated user

### 9.4 Manage User Roles

```
GET /api/v1/admin/users/:id/roles
POST /api/v1/admin/users/:id/roles
DELETE /api/v1/admin/users/:id/roles/:roleId
```

**Required Permission**: `admin:roles:manage`

**POST Request Body**:

```json
{
  "roleId": "role-beta-tester"
}
```

### 9.5 Query Audit Logs (Admin)

```
GET /api/v1/admin/audit
```

**Required Permission**: `admin:audit:read`

**Query Parameters**:

| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number |
| `pageSize` | number | Items per page |
| `actor_id` | string | Filter by actor |
| `action` | string | Filter by action |
| `resource_type` | string | Filter by resource type |
| `from` | string | Start date (ISO 8601) |
| `to` | string | End date (ISO 8601) |

**Response** (200 OK):

```json
{
  "data": [
    {
      "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      "timestamp": "2024-01-15T10:30:00Z",
      "actorType": "user",
      "actorId": "user-123",
      "action": "chat.message.created",
      "resourceType": "message",
      "resourceId": "msg-456",
      "metadata": {
        "chatId": "chat-789",
        "tokenCount": 150
      },
      "requestId": "req-abc"
    }
  ],
  "meta": {
    "pagination": { ... },
    "requestId": "..."
  }
}
```

### 9.6 System Prompts (Admin)

```
GET /api/v1/admin/prompts
POST /api/v1/admin/prompts
GET /api/v1/admin/prompts/:id
PATCH /api/v1/admin/prompts/:id
POST /api/v1/admin/prompts/:id/activate
```

**Required Permission**: `admin:prompts:manage`

**POST /api/v1/admin/prompts** Request Body:

```json
{
  "name": "Default Assistant v2",
  "content": "You are Bakame, an intelligent assistant...",
  "metadata": {
    "author": "admin@example.com",
    "changelog": "Updated personality section"
  }
}
```

**POST /api/v1/admin/prompts/:id/activate** Response:

```json
{
  "data": {
    "id": "prompt-123",
    "name": "Default Assistant v2",
    "status": "active",
    "activatedAt": "2024-01-15T10:30:00Z",
    "activatedBy": "admin-user-id"
  },
  "meta": { "requestId": "..." }
}
```

### 9.7 Approvals (Admin)

```
GET /api/v1/admin/approvals
GET /api/v1/admin/approvals/:id
POST /api/v1/admin/approvals/:id
```

**Required Permission**: `admin:approvals:manage`

**GET /api/v1/admin/approvals** Query Parameters:

| Param | Type | Description |
|-------|------|-------------|
| `status` | string | `pending`, `approved`, `rejected` |
| `type` | string | `prompt_activation`, `role_grant`, etc. |

**POST /api/v1/admin/approvals/:id** Request Body:

```json
{
  "action": "approve",
  "comment": "Reviewed and approved"
}
```

Or:

```json
{
  "action": "reject",
  "comment": "Needs revision - see feedback"
}
```

### 9.8 Tool Registry (Admin)

```
GET /api/v1/admin/tools
POST /api/v1/admin/tools
GET /api/v1/admin/tools/:id
PATCH /api/v1/admin/tools/:id
DELETE /api/v1/admin/tools/:id
```

**Required Permission**: `admin:tools:manage`

**POST /api/v1/admin/tools** Request Body:

```json
{
  "name": "calendar_create",
  "description": "Create a calendar event",
  "type": "n8n",
  "config": {
    "workflowId": "wf-calendar-create",
    "timeout": 30000
  },
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "startTime": { "type": "string", "format": "date-time" },
      "endTime": { "type": "string", "format": "date-time" }
    },
    "required": ["title", "startTime", "endTime"]
  },
  "requiresPermission": "tool:calendar",
  "enabled": false
}
```

---

## 10. ERROR CODES

### 10.1 Standard Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Valid auth but insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request body or params |
| `CONFLICT` | 409 | Resource conflict (e.g., duplicate) |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### 10.2 Domain-Specific Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `CHAT_NOT_FOUND` | 404 | Chat does not exist or not owned by user |
| `MESSAGE_NOT_FOUND` | 404 | Message does not exist |
| `MEMORY_NOT_FOUND` | 404 | Memory does not exist |
| `KNOWLEDGE_NOT_FOUND` | 404 | Knowledge item does not exist |
| `TOOL_NOT_FOUND` | 404 | Tool does not exist |
| `TOOL_DISABLED` | 400 | Tool is disabled |
| `TOOL_PERMISSION_DENIED` | 403 | User lacks tool permission |
| `QUOTA_EXCEEDED` | 402 | Usage quota exceeded |
| `SUBSCRIPTION_REQUIRED` | 402 | Feature requires paid plan |
| `PROMPT_NOT_FOUND` | 404 | System prompt does not exist |
| `APPROVAL_NOT_FOUND` | 404 | Approval request does not exist |
| `APPROVAL_ALREADY_ACTIONED` | 400 | Approval already processed |

---

## 11. MIDDLEWARE STACK

### 11.1 Middleware Order

```typescript
// Global middleware (all routes)
app.use('*', corsMiddleware);
app.use('*', requestIdMiddleware);
app.use('*', rateLimitMiddleware);

// Health check (no auth)
app.get('/api/v1/health', healthHandler);

// Authenticated routes
app.use('/api/v1/*', authMiddleware);

// Admin routes (additional permission check)
app.use('/api/v1/admin/*', adminMiddleware);

// Routes...
```

### 11.2 Admin Middleware

```typescript
export async function adminMiddleware(c: Context, next: Next) {
  const actor = c.get('actor');

  // Check for any admin permission
  const hasAdminPermission = actor.permissions.some(p => p.startsWith('admin:'));

  if (!hasAdminPermission) {
    return c.json({
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required',
        requestId: actor.requestId,
      }
    }, 403);
  }

  await next();
}
```

### 11.3 Rate Limit Middleware

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '1 m'),  // 100 requests per minute
  analytics: true,
});

export async function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const { success, limit, remaining, reset } = await ratelimit.limit(ip);

  c.header('X-RateLimit-Limit', limit.toString());
  c.header('X-RateLimit-Remaining', remaining.toString());
  c.header('X-RateLimit-Reset', reset.toString());

  if (!success) {
    return c.json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        details: { retryAfter: reset },
        requestId: c.get('requestId') || 'unknown',
      }
    }, 429);
  }

  await next();
}
```

---

## 12. IMPLEMENTATION PATTERN

### 12.1 Standard Endpoint Template

Every endpoint follows this pattern:

```typescript
app.get('/api/v1/{resource}', authMiddleware, async (c) => {
  // 1. Get actor context
  const actor = c.get('actor');

  // 2. Parse and validate input
  const params = parseAndValidate(c.req);
  if (!params.valid) {
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: params.error,
        requestId: actor.requestId,
      }
    }, 400);
  }

  // 3. Call service (EXACTLY ONE service method)
  const result = await someService.someMethod(actor, params.data);

  // 4. Transform result to HTTP response
  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: result.data,
    meta: { requestId: actor.requestId },
  });
});
```

### 12.2 Error Response Helper

```typescript
function errorResponse(c: Context, error: ServiceError, requestId: string) {
  const statusMap: Record<string, number> = {
    'NOT_FOUND': 404,
    'FORBIDDEN': 403,
    'UNAUTHORIZED': 401,
    'VALIDATION_ERROR': 400,
    'CONFLICT': 409,
    'QUOTA_EXCEEDED': 402,
    'RATE_LIMITED': 429,
  };

  const status = statusMap[error.code] || 500;

  return c.json({
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      requestId,
    }
  }, status);
}
```

---

## 13. FILE STRUCTURE

```
src/
├── api/
│   ├── index.ts              # Main Hono app, middleware stack
│   ├── middleware/
│   │   ├── auth.ts           # authMiddleware (from Stage 3a)
│   │   ├── admin.ts          # adminMiddleware
│   │   ├── rateLimit.ts      # rateLimitMiddleware
│   │   └── cors.ts           # CORS configuration
│   ├── routes/
│   │   ├── health.ts         # Health check
│   │   ├── chats.ts          # Chat endpoints
│   │   ├── users.ts          # User endpoints
│   │   ├── memories.ts       # Memory endpoints
│   │   ├── knowledge.ts      # Knowledge endpoints
│   │   ├── tools.ts          # Tool endpoints
│   │   ├── subscription.ts   # Subscription endpoints
│   │   └── admin/
│   │       ├── users.ts      # Admin user management
│   │       ├── audit.ts      # Audit log queries
│   │       ├── prompts.ts    # System prompt management
│   │       ├── approvals.ts  # Approval workflows
│   │       └── tools.ts      # Tool registry management
│   └── utils/
│       ├── response.ts       # Response helpers
│       ├── validation.ts     # Input validation
│       └── pagination.ts     # Pagination helpers
└── services/                 # Service layer (Stage 2)
```

---

## 14. ASSUMPTIONS & NOTES

### 14.1 Assumptions

1. Supabase JWT tokens are used for authentication
2. Upstash Redis is available for rate limiting
3. All services from Stage 2 are implemented
4. Frontend will handle token refresh

### 14.2 Notes for Implementation

- Start with user-facing endpoints, then admin
- Add OpenAPI spec generation (swagger) after core endpoints
- Consider GraphQL gateway in future (not this stage)
- Mobile apps may need additional endpoints (push tokens, etc.)

---

## 15. NEXT STEPS

Stage 3b is now approved. Next:

1. **Stage 5: Tool Execution Layer** — MCP servers, tool implementations
2. **Implement core endpoints** — Chat, User, Memory, Knowledge
3. **Implement admin endpoints** — Users, Audit, Prompts, Approvals
4. **Add rate limiting** — Upstash integration
5. **Generate OpenAPI spec** — For frontend integration

---

## APPROVAL RECORD

**Status**: ✅ APPROVED & LOCKED

**This document is now IMMUTABLE. Any changes require a new design review.**
