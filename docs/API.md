# Bakame AI Backend API Documentation

Production-grade AI platform API built with Hono framework on Node.js.

---

## Table of Contents

- [Introduction](#introduction)
  - [Base URL](#base-url)
  - [API Versioning](#api-versioning)
- [Authentication](#authentication)
  - [Bearer Token Authentication](#bearer-token-authentication)
  - [Token Acquisition](#token-acquisition)
- [Request/Response Format](#requestresponse-format)
  - [Success Response](#success-response)
  - [Error Response](#error-response)
- [Error Handling](#error-handling)
  - [Error Codes](#error-codes)
- [Rate Limiting](#rate-limiting)
- [Pagination](#pagination)
- [API Endpoints](#api-endpoints)
  - [Health](#health)
  - [Chats](#chats)
  - [Users](#users)
  - [Memories](#memories)
  - [Knowledge](#knowledge)
  - [Tools](#tools)
  - [Subscription](#subscription)
  - [Admin](#admin)

---

## Introduction

The Bakame API provides programmatic access to the Bakame AI platform, enabling chat management, user preferences, memory persistence, knowledge base management, tool discovery, and subscription tracking.

### Base URL

```
https://api.bakame.ai/api/v1
```

For local development:
```
http://localhost:3000/api/v1
```

### API Versioning

The API uses URL path versioning. The current version is `v1`. All endpoints are prefixed with `/api/v1`.

---

## Authentication

### Bearer Token Authentication

All API endpoints (except `/health`) require authentication via Supabase JWT tokens. Include the token in the `Authorization` header:

```
Authorization: Bearer <your-jwt-token>
```

### Token Acquisition

Tokens are obtained through Supabase Auth. The authentication flow:

1. User authenticates via Supabase Auth (email/password, OAuth, magic link)
2. Supabase returns a JWT access token
3. Include this token in all API requests

```typescript
// Example with Supabase client
const { data: { session } } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password123'
});

const token = session.access_token;
```

### Actor Context

Upon successful authentication, the API constructs an `ActorContext` containing:

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

---

## Request/Response Format

### Success Response

All successful responses follow this format:

```typescript
interface SuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: PaginationMeta;
    requestId: string;
  };
}
```

**Example:**
```json
{
  "data": {
    "id": "chat_abc123",
    "title": "My Chat",
    "status": "active",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

### Error Response

All error responses follow this format:

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}
```

**Example:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "content is required and must be a string",
    "requestId": "req_xyz789"
  }
}
```

---

## Error Handling

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `PERMISSION_DENIED` | 403 | Insufficient permissions for the operation |
| `FORBIDDEN` | 403 | Admin access required |
| `NOT_FOUND` | 404 | Requested resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `ALREADY_EXISTS` | 409 | Resource already exists |
| `CONFLICT` | 409 | Conflicting operation |
| `INVALID_STATE` | 400 | Invalid state transition |
| `RATE_LIMITED` | 429 | Too many requests |
| `QUOTA_EXCEEDED` | 402 | Usage quota exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `SERVICE_UNAVAILABLE` | 503 | Service temporarily unavailable |

---

## Rate Limiting

The API implements rate limiting using Upstash Redis with a sliding window algorithm.

**Default Limits:**
- 100 requests per minute per user
- Anonymous requests limited by IP address

**Rate Limit Headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 45
```

**Rate Limited Response (429):**
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": {
      "retryAfter": 45,
      "limit": 100
    },
    "requestId": "req_xyz789"
  }
}
```

---

## Pagination

List endpoints support cursor-based pagination.

**Query Parameters:**
| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | 20 | 100 | Number of items per page |
| `cursor` | string | - | - | Cursor for next page |

**Paginated Response:**
```json
{
  "data": {
    "items": [...],
    "nextCursor": "cursor_abc123",
    "hasMore": true
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

---

## API Endpoints

---

## Health

Public endpoint for health checks. No authentication required.

### GET /api/v1/health

Returns service health status.

**Authentication:** None required

**Request Headers:**
```
(none required)
```

**Response (200):**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "v1"
}
```

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/health
```

---

## Chats

Endpoints for chat and message management.

### POST /api/v1/chats

Create a new chat.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```typescript
interface CreateChatRequest {
  title?: string;
  metadata?: Record<string, unknown>;
}
```

**Example Request Body:**
```json
{
  "title": "My New Chat",
  "metadata": {
    "source": "web"
  }
}
```

**Response (201):**
```typescript
interface ChatResponse {
  data: {
    id: string;
    title: string | null;
    status: 'active' | 'archived';
    createdAt: string;  // ISO 8601
    updatedAt: string;  // ISO 8601
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "id": "chat_abc123",
    "title": "My New Chat",
    "status": "active",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/chats \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "My New Chat"}'
```

**Error Responses:**
- `401 UNAUTHORIZED` - Missing or invalid token

---

### GET /api/v1/chats

List user's chats with pagination.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Max items per page (max 100) |
| `cursor` | string | - | Pagination cursor |
| `status` | string | - | Filter by status: `active`, `archived` |

**Response (200):**
```typescript
interface ListChatsResponse {
  data: {
    items: Array<{
      id: string;
      title: string | null;
      status: 'active' | 'archived';
      messageCount?: number;
      createdAt: string;
      updatedAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "items": [
      {
        "id": "chat_abc123",
        "title": "My Chat",
        "status": "active",
        "messageCount": 5,
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T11:00:00.000Z"
      }
    ],
    "nextCursor": "cursor_def456",
    "hasMore": true
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET "https://api.bakame.ai/api/v1/chats?limit=10&status=active" \
  -H "Authorization: Bearer <token>"
```

---

### GET /api/v1/chats/:id

Get chat details by ID.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Chat ID |

**Response (200):**
```typescript
interface GetChatResponse {
  data: {
    id: string;
    title: string | null;
    status: 'active' | 'archived';
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "id": "chat_abc123",
    "title": "My Chat",
    "status": "active",
    "metadata": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/chats/chat_abc123 \
  -H "Authorization: Bearer <token>"
```

**Error Responses:**
- `404 NOT_FOUND` - Chat not found

---

### PATCH /api/v1/chats/:id

Update chat properties.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Chat ID |

**Request Body:**
```typescript
interface UpdateChatRequest {
  title?: string;
}
```

**Example Request Body:**
```json
{
  "title": "Updated Chat Title"
}
```

**Response (200):**
```json
{
  "data": {
    "id": "chat_abc123",
    "title": "Updated Chat Title",
    "status": "active",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T11:00:00.000Z"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X PATCH https://api.bakame.ai/api/v1/chats/chat_abc123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated Chat Title"}'
```

**Error Responses:**
- `404 NOT_FOUND` - Chat not found

---

### DELETE /api/v1/chats/:id

Archive a chat (soft delete).

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Chat ID |

**Response (204):** No content

**Example Request:**
```bash
curl -X DELETE https://api.bakame.ai/api/v1/chats/chat_abc123 \
  -H "Authorization: Bearer <token>"
```

**Error Responses:**
- `404 NOT_FOUND` - Chat not found

---

### POST /api/v1/chats/:id/messages

Add a message to a chat.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Chat ID |

**Request Body:**
```typescript
interface AddMessageRequest {
  content: string;  // Required, max 32000 characters
}
```

**Example Request Body:**
```json
{
  "content": "Hello, how can you help me today?"
}
```

**Response (201):**
```typescript
interface AddMessageResponse {
  data: {
    id: string;
    chatId: string;
    role: 'user';  // Always 'user' for API-created messages
    content: string;
    createdAt: string;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "id": "msg_abc123",
    "chatId": "chat_xyz789",
    "role": "user",
    "content": "Hello, how can you help me today?",
    "createdAt": "2024-01-15T10:30:00.000Z"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/chats/chat_abc123/messages \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, how can you help me today?"}'
```

**Error Responses:**
- `400 VALIDATION_ERROR` - Content is required / Content exceeds maximum length
- `404 NOT_FOUND` - Chat not found

---

### GET /api/v1/chats/:id/messages

Get messages in a chat with pagination.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Chat ID |

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 20 | Max items per page (max 100) |
| `cursor` | string | - | Pagination cursor |

**Response (200):**
```typescript
interface GetMessagesResponse {
  data: {
    items: Array<{
      id: string;
      chatId: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "items": [
      {
        "id": "msg_abc123",
        "chatId": "chat_xyz789",
        "role": "user",
        "content": "Hello!",
        "metadata": {},
        "createdAt": "2024-01-15T10:30:00.000Z"
      },
      {
        "id": "msg_def456",
        "chatId": "chat_xyz789",
        "role": "assistant",
        "content": "Hi! How can I help you today?",
        "metadata": {
          "model": "anthropic/claude-3.5-sonnet"
        },
        "createdAt": "2024-01-15T10:30:05.000Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET "https://api.bakame.ai/api/v1/chats/chat_abc123/messages?limit=50" \
  -H "Authorization: Bearer <token>"
```

---

### POST /api/v1/chats/:id/stream

Stream an AI response for a chat message via Server-Sent Events (SSE).

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Chat ID |

**Request Body:**
```typescript
interface StreamMessageRequest {
  content: string;   // Required, max 32000 characters
  model?: string;    // Optional model override
}
```

**Example Request Body:**
```json
{
  "content": "Explain quantum computing in simple terms",
  "model": "anthropic/claude-3.5-sonnet"
}
```

**Response:** Server-Sent Events stream

**SSE Event Types:**
```typescript
// Message started
interface MessageStartEvent {
  type: 'message.start';
  messageId: string;
  timestamp: number;
}

// Content chunk (text)
interface MessageDeltaEvent {
  type: 'message.delta';
  content: string;
  timestamp: number;
}

// Message completed
interface MessageCompleteEvent {
  type: 'message.complete';
  messageId: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  timestamp: number;
}

// Tool execution started
interface ToolStartEvent {
  type: 'tool.start';
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  timestamp: number;
}

// Tool execution completed
interface ToolCompleteEvent {
  type: 'tool.complete';
  toolCallId: string;
  toolName: string;
  output: Record<string, unknown>;
  status: 'success' | 'failure';
  durationMs: number;
  timestamp: number;
}

// Error occurred
interface ErrorEvent {
  type: 'error';
  code: string;
  message: string;
  timestamp: number;
}

// Stream complete
interface DoneEvent {
  type: 'done';
  timestamp: number;
}
```

**Example SSE Stream:**
```
event: message.start
data: {"type":"message.start","messageId":"msg_abc123","timestamp":1705312200000}

event: message.delta
data: {"type":"message.delta","content":"Quantum computing ","timestamp":1705312200100}

event: message.delta
data: {"type":"message.delta","content":"is a revolutionary ","timestamp":1705312200200}

event: message.complete
data: {"type":"message.complete","messageId":"msg_abc123","model":"anthropic/claude-3.5-sonnet","usage":{"inputTokens":50,"outputTokens":150},"timestamp":1705312205000}

event: done
data: {"type":"done","timestamp":1705312205000}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/chats/chat_abc123/stream \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"content": "Explain quantum computing"}'
```

**Error Responses:**
- `400 VALIDATION_ERROR` - Content is required / Content exceeds maximum length
- `404 NOT_FOUND` - Chat not found
- `503 SERVICE_UNAVAILABLE` - AI orchestrator not configured

---

## Users

Endpoints for user profile and AI preferences management.

### GET /api/v1/users/me

Get the current user's profile.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```typescript
interface ProfileResponse {
  data: {
    id: string;
    userId: string;
    displayName: string | null;
    avatarUrl: string | null;
    timezone: string;
    locale: string;
    createdAt: string;
    updatedAt: string;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "id": "profile_abc123",
    "userId": "user_xyz789",
    "displayName": "John Doe",
    "avatarUrl": "https://example.com/avatar.jpg",
    "timezone": "America/New_York",
    "locale": "en-US",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/users/me \
  -H "Authorization: Bearer <token>"
```

---

### PATCH /api/v1/users/me

Update the current user's profile.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```typescript
interface UpdateProfileRequest {
  displayName?: string | null;
  avatarUrl?: string | null;
  timezone?: string;
  locale?: string;
}
```

**Example Request Body:**
```json
{
  "displayName": "Jane Doe",
  "timezone": "Europe/London"
}
```

**Response (200):** Same as GET /api/v1/users/me

**Example Request:**
```bash
curl -X PATCH https://api.bakame.ai/api/v1/users/me \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"displayName": "Jane Doe", "timezone": "Europe/London"}'
```

---

### GET /api/v1/users/me/preferences

Get the current user's AI preferences.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```typescript
interface PreferencesResponse {
  data: {
    id: string;
    userId: string;
    responseLength: 'concise' | 'balanced' | 'detailed';
    formality: 'casual' | 'neutral' | 'formal';
    allowMemory: boolean;
    allowWebSearch: boolean;
    customInstructions: string | null;
    createdAt: string;
    updatedAt: string;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "id": "pref_abc123",
    "userId": "user_xyz789",
    "responseLength": "balanced",
    "formality": "neutral",
    "allowMemory": true,
    "allowWebSearch": true,
    "customInstructions": "Always explain concepts with examples",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/users/me/preferences \
  -H "Authorization: Bearer <token>"
```

---

### PUT /api/v1/users/me/preferences

Update the current user's AI preferences.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```typescript
interface UpdatePreferencesRequest {
  responseLength?: 'concise' | 'balanced' | 'detailed';
  formality?: 'casual' | 'neutral' | 'formal';
  allowMemory?: boolean;
  allowWebSearch?: boolean;
  customInstructions?: string | null;
}
```

**Example Request Body:**
```json
{
  "responseLength": "detailed",
  "formality": "formal",
  "allowMemory": true,
  "customInstructions": "Always provide code examples in TypeScript"
}
```

**Response (200):** Same as GET /api/v1/users/me/preferences

**Example Request:**
```bash
curl -X PUT https://api.bakame.ai/api/v1/users/me/preferences \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"responseLength": "detailed", "formality": "formal"}'
```

**Error Responses:**
- `400 VALIDATION_ERROR` - Invalid responseLength or formality value

---

## Memories

Endpoints for user memory management. Memories are long-term facts and preferences about the user that the AI can recall.

### GET /api/v1/memories

List memories or search semantically.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | string | - | Search query (triggers semantic search) |
| `category` | string | - | Filter by category |
| `status` | string | - | Filter by status: `active`, `archived` |
| `limit` | integer | 20 | Max items per page (max 100) |
| `cursor` | string | - | Pagination cursor |

**Response (200) - Standard List:**
```typescript
interface ListMemoriesResponse {
  data: {
    items: Array<{
      id: string;
      userId: string;
      content: string;
      category: string | null;
      source: 'conversation' | 'user_input' | 'system';
      importance: number;  // 1-10
      status: 'active' | 'archived';
      createdAt: string;
      updatedAt: string;
      lastAccessed: string | null;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Response (200) - Semantic Search:**
```typescript
interface SearchMemoriesResponse {
  data: {
    items: Array<{
      id: string;
      userId: string;
      content: string;
      category: string | null;
      source: 'conversation' | 'user_input' | 'system';
      importance: number;
      status: 'active' | 'archived';
      similarity: number;  // 0-1, semantic similarity score
      createdAt: string;
      updatedAt: string;
      lastAccessed: string | null;
    }>;
    nextCursor: null;
    hasMore: false;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "items": [
      {
        "id": "mem_abc123",
        "userId": "user_xyz789",
        "content": "User prefers TypeScript over JavaScript",
        "category": "programming",
        "source": "conversation",
        "importance": 7,
        "status": "active",
        "createdAt": "2024-01-10T10:00:00.000Z",
        "updatedAt": "2024-01-10T10:00:00.000Z",
        "lastAccessed": "2024-01-15T08:00:00.000Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Requests:**
```bash
# List all memories
curl -X GET https://api.bakame.ai/api/v1/memories \
  -H "Authorization: Bearer <token>"

# Semantic search
curl -X GET "https://api.bakame.ai/api/v1/memories?search=programming%20preferences" \
  -H "Authorization: Bearer <token>"

# Filter by category
curl -X GET "https://api.bakame.ai/api/v1/memories?category=work" \
  -H "Authorization: Bearer <token>"
```

---

### POST /api/v1/memories

Create a new memory.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```typescript
interface CreateMemoryRequest {
  content: string;           // Required
  category?: string;
  importance?: number;       // 1-10, default 5
}
```

**Example Request Body:**
```json
{
  "content": "User works in software development and prefers Go for backend services",
  "category": "work",
  "importance": 8
}
```

**Response (201):**
```json
{
  "data": {
    "id": "mem_abc123",
    "userId": "user_xyz789",
    "content": "User works in software development and prefers Go for backend services",
    "category": "work",
    "source": "user_input",
    "importance": 8,
    "status": "active",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "lastAccessed": null
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/memories \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"content": "User prefers dark mode", "category": "preferences", "importance": 5}'
```

**Error Responses:**
- `400 VALIDATION_ERROR` - Content is required / Importance must be 1-10

---

### GET /api/v1/memories/:id

Get a memory by ID.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Memory ID |

**Response (200):** Memory object (same format as list items)

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/memories/mem_abc123 \
  -H "Authorization: Bearer <token>"
```

**Error Responses:**
- `404 NOT_FOUND` - Memory not found

---

### PATCH /api/v1/memories/:id

Update a memory.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Memory ID |

**Request Body:**
```typescript
interface UpdateMemoryRequest {
  content?: string;
  category?: string;
  importance?: number;  // 1-10
}
```

**Response (200):** Updated memory object

**Example Request:**
```bash
curl -X PATCH https://api.bakame.ai/api/v1/memories/mem_abc123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"importance": 9}'
```

**Error Responses:**
- `400 VALIDATION_ERROR` - Importance must be 1-10
- `404 NOT_FOUND` - Memory not found

---

### DELETE /api/v1/memories/:id

Archive a memory (soft delete).

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Memory ID |

**Response (204):** No content

**Example Request:**
```bash
curl -X DELETE https://api.bakame.ai/api/v1/memories/mem_abc123 \
  -H "Authorization: Bearer <token>"
```

**Error Responses:**
- `404 NOT_FOUND` - Memory not found

---

## Knowledge

Endpoints for RAG knowledge base management.

### GET /api/v1/knowledge

List knowledge items or search semantically.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | string | - | Search query (triggers semantic search) |
| `status` | string | - | Filter by status: `draft`, `pending_review`, `approved`, `published`, `archived` |
| `category` | string | - | Filter by category |
| `limit` | integer | 20 | Max items per page (max 100) |
| `cursor` | string | - | Pagination cursor |

**Response (200) - Standard List:**
```typescript
interface ListKnowledgeResponse {
  data: {
    items: Array<{
      id: string;
      title: string;
      content: string;
      category: string | null;
      status: 'draft' | 'pending_review' | 'approved' | 'published' | 'archived';
      authorId: string;
      reviewerId: string | null;
      publishedAt: string | null;
      version: number;
      metadata: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Response (200) - Semantic Search:**
Items include additional fields:
```typescript
{
  chunk: string;        // Matched text chunk
  chunkIndex: number;   // Index of the chunk
  similarity: number;   // 0-1, semantic similarity score
}
```

**Example Response:**
```json
{
  "data": {
    "items": [
      {
        "id": "kb_abc123",
        "title": "API Best Practices",
        "content": "REST API design guidelines...",
        "category": "engineering",
        "status": "published",
        "authorId": "user_xyz789",
        "reviewerId": "user_admin123",
        "publishedAt": "2024-01-10T12:00:00.000Z",
        "version": 3,
        "metadata": {},
        "createdAt": "2024-01-05T10:00:00.000Z",
        "updatedAt": "2024-01-10T12:00:00.000Z"
      }
    ],
    "nextCursor": null,
    "hasMore": false
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Requests:**
```bash
# List all knowledge items
curl -X GET https://api.bakame.ai/api/v1/knowledge \
  -H "Authorization: Bearer <token>"

# Semantic search
curl -X GET "https://api.bakame.ai/api/v1/knowledge?search=API%20design" \
  -H "Authorization: Bearer <token>"

# Filter by status
curl -X GET "https://api.bakame.ai/api/v1/knowledge?status=published" \
  -H "Authorization: Bearer <token>"
```

---

### POST /api/v1/knowledge

Create a new knowledge item (starts as draft).

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```typescript
interface CreateKnowledgeRequest {
  title: string;                        // Required
  content: string;                      // Required
  category?: string;
  metadata?: Record<string, unknown>;
}
```

**Example Request Body:**
```json
{
  "title": "TypeScript Best Practices",
  "content": "# TypeScript Best Practices\n\n## Type Safety\n\nAlways use strict mode...",
  "category": "engineering"
}
```

**Response (201):**
```json
{
  "data": {
    "id": "kb_abc123",
    "title": "TypeScript Best Practices",
    "content": "# TypeScript Best Practices...",
    "category": "engineering",
    "status": "draft",
    "authorId": "user_xyz789",
    "reviewerId": null,
    "publishedAt": null,
    "version": 1,
    "metadata": {},
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/knowledge \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "My Article", "content": "Article content here..."}'
```

**Error Responses:**
- `400 VALIDATION_ERROR` - Title and content are required

---

### GET /api/v1/knowledge/:id

Get a knowledge item by ID.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Knowledge item ID |

**Response (200):** Knowledge item object

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/knowledge/kb_abc123 \
  -H "Authorization: Bearer <token>"
```

**Error Responses:**
- `404 NOT_FOUND` - Knowledge item not found

---

### PATCH /api/v1/knowledge/:id

Update a knowledge item.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Knowledge item ID |

**Request Body:**
```typescript
interface UpdateKnowledgeRequest {
  title?: string;
  content?: string;
  category?: string;
  metadata?: Record<string, unknown>;
}
```

**Response (200):** Updated knowledge item object

**Example Request:**
```bash
curl -X PATCH https://api.bakame.ai/api/v1/knowledge/kb_abc123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Updated Title"}'
```

**Error Responses:**
- `404 NOT_FOUND` - Knowledge item not found

---

### POST /api/v1/knowledge/:id/publish

Submit a knowledge item for review and publishing.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Knowledge item ID |

**Response (200):**
```json
{
  "data": {
    "id": "kb_abc123",
    "status": "pending_review"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/knowledge/kb_abc123/publish \
  -H "Authorization: Bearer <token>"
```

**Error Responses:**
- `404 NOT_FOUND` - Knowledge item not found
- `400 INVALID_STATE` - Item cannot be submitted for review in current state

---

## Tools

Endpoints for discovering available AI tools.

### GET /api/v1/tools

List available tools.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `type` | string | Filter by tool type: `local`, `mcp`, `n8n` |
| `enabled` | boolean | Filter by enabled status |

**Response (200):**
```typescript
interface ListToolsResponse {
  data: Array<{
    id: string;
    name: string;
    description: string;
    type: 'local' | 'mcp' | 'n8n';
    enabled: boolean;
    requiresPermission: string | null;
    inputSchema: Record<string, unknown>;
    rateLimit?: {
      maxPerHour: number;
    };
  }>;
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": [
    {
      "id": "tool_calc",
      "name": "calculator",
      "description": "Perform mathematical calculations",
      "type": "local",
      "enabled": true,
      "requiresPermission": null,
      "inputSchema": {
        "type": "object",
        "properties": {
          "expression": {
            "type": "string",
            "description": "Mathematical expression to evaluate"
          }
        },
        "required": ["expression"]
      }
    }
  ],
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET "https://api.bakame.ai/api/v1/tools?enabled=true" \
  -H "Authorization: Bearer <token>"
```

---

### GET /api/v1/tools/:id

Get tool details by ID.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Tool ID |

**Response (200):** Tool object (same format as list items)

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/tools/tool_calc \
  -H "Authorization: Bearer <token>"
```

**Error Responses:**
- `404 NOT_FOUND` - Tool not found

---

## Subscription

Endpoints for subscription and usage tracking.

### GET /api/v1/subscription

Get the current user's subscription details.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```typescript
interface SubscriptionResponse {
  data: {
    id: string;
    userId: string;
    planCode: string;
    planName: string;
    status: 'active' | 'canceled' | 'past_due' | 'expired';
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "id": "sub_abc123",
    "userId": "user_xyz789",
    "planCode": "pro",
    "planName": "Pro Plan",
    "status": "active",
    "currentPeriodStart": "2024-01-01T00:00:00.000Z",
    "currentPeriodEnd": "2024-02-01T00:00:00.000Z",
    "cancelAtPeriodEnd": false
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/subscription \
  -H "Authorization: Bearer <token>"
```

---

### GET /api/v1/subscription/usage

Get usage summary for the current billing period.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `period` | string | Billing period (optional) |

**Response (200):**
```typescript
interface UsageResponse {
  data: {
    period: {
      start?: string;
      end?: string;
    };
    usage: Array<{
      featureCode: string;
      featureName: string;
      used: number;
      limit: number;
      percentage: number;
    }>;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": {
    "period": {
      "start": "2024-01-01T00:00:00.000Z",
      "end": "2024-02-01T00:00:00.000Z"
    },
    "usage": [
      {
        "featureCode": "ai_messages",
        "featureName": "AI Messages",
        "used": 150,
        "limit": 1000,
        "percentage": 15
      },
      {
        "featureCode": "storage_mb",
        "featureName": "Storage (MB)",
        "used": 50,
        "limit": 500,
        "percentage": 10
      }
    ]
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/subscription/usage \
  -H "Authorization: Bearer <token>"
```

---

### GET /api/v1/subscription/entitlements

Get active feature entitlements.

**Authentication:** Required

**Request Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```typescript
interface EntitlementsResponse {
  data: Array<{
    featureCode: string;
    type: 'metered' | 'boolean';
    limit?: number;
    enabled?: boolean;
    resetPeriod?: string;
  }>;
  meta: {
    requestId: string;
  };
}
```

**Example Response:**
```json
{
  "data": [
    {
      "featureCode": "ai_messages",
      "type": "metered",
      "limit": 1000,
      "resetPeriod": "monthly"
    },
    {
      "featureCode": "web_search",
      "type": "boolean",
      "enabled": true
    },
    {
      "featureCode": "advanced_tools",
      "type": "boolean",
      "enabled": false
    }
  ],
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/subscription/entitlements \
  -H "Authorization: Bearer <token>"
```

---

## Admin

Administrative endpoints. Require `admin:*` permission.

### GET /api/v1/admin/users

List all users (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Max items per page (default 20, max 100) |
| `cursor` | string | Pagination cursor |
| `status` | string | Filter by status: `active`, `suspended`, `deleted` |
| `email_contains` | string | Filter by email (partial match) |

**Response (200):**
```typescript
interface AdminUsersResponse {
  data: {
    items: Array<{
      id: string;
      email: string;
      status: 'active' | 'suspended' | 'deleted';
      createdAt: string;
      updatedAt: string;
      deletedAt: string | null;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Request:**
```bash
curl -X GET "https://api.bakame.ai/api/v1/admin/users?status=active&limit=10" \
  -H "Authorization: Bearer <admin-token>"
```

**Error Responses:**
- `403 FORBIDDEN` - Admin access required

---

### GET /api/v1/admin/users/:id

Get user details by ID (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | User ID |

**Response (200):** User object (same format as list items)

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/admin/users/user_abc123 \
  -H "Authorization: Bearer <admin-token>"
```

**Error Responses:**
- `403 FORBIDDEN` - Admin access required
- `404 NOT_FOUND` - User not found

---

### POST /api/v1/admin/users/:id/suspend

Suspend a user (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | User ID |

**Request Body:**
```typescript
interface SuspendUserRequest {
  reason?: string;  // Optional reason for suspension
}
```

**Response (200):**
```json
{
  "data": {
    "success": true
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/admin/users/user_abc123/suspend \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Terms of service violation"}'
```

**Error Responses:**
- `403 FORBIDDEN` - Admin access required
- `404 NOT_FOUND` - User not found

---

### POST /api/v1/admin/users/:id/reactivate

Reactivate a suspended user (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | User ID |

**Response (200):**
```json
{
  "data": {
    "success": true
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/admin/users/user_abc123/reactivate \
  -H "Authorization: Bearer <admin-token>"
```

**Error Responses:**
- `403 FORBIDDEN` - Admin access required
- `404 NOT_FOUND` - User not found

---

### GET /api/v1/admin/audit

Query audit logs (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Max items per page (default 20, max 100) |
| `cursor` | string | Pagination cursor |
| `actor_id` | string | Filter by actor ID |
| `action` | string | Filter by action type |
| `resource_type` | string | Filter by resource type |
| `from` | string | Start date (ISO 8601) |
| `to` | string | End date (ISO 8601) |

**Response (200):**
```typescript
interface AuditLogsResponse {
  data: {
    items: Array<{
      id: string;
      timestamp: string;
      actorType: 'user' | 'admin' | 'system' | 'ai';
      actorId: string;
      action: string;
      resourceType: string;
      resourceId: string;
      metadata: Record<string, unknown>;
      requestId: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Request:**
```bash
curl -X GET "https://api.bakame.ai/api/v1/admin/audit?action=user.suspend&from=2024-01-01T00:00:00Z" \
  -H "Authorization: Bearer <admin-token>"
```

**Error Responses:**
- `403 FORBIDDEN` - Admin access required

---

### GET /api/v1/admin/prompts

List system prompts (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Max items per page |
| `cursor` | string | Pagination cursor |
| `status` | string | Filter by status |

**Response (200):**
```typescript
interface PromptsResponse {
  data: {
    items: Array<{
      id: string;
      name: string;
      content: string;
      status: 'draft' | 'active' | 'archived';
      version: number;
      createdAt: string;
      updatedAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/admin/prompts \
  -H "Authorization: Bearer <admin-token>"
```

---

### POST /api/v1/admin/prompts

Create a system prompt (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```typescript
interface CreatePromptRequest {
  name: string;                         // Required
  content: string;                      // Required
  metadata?: Record<string, unknown>;
}
```

**Example Request Body:**
```json
{
  "name": "default-assistant",
  "content": "You are a helpful AI assistant..."
}
```

**Response (201):** Created prompt object

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/admin/prompts \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "default-assistant", "content": "You are a helpful AI assistant..."}'
```

**Error Responses:**
- `400 VALIDATION_ERROR` - Name and content are required
- `403 FORBIDDEN` - Admin access required

---

### GET /api/v1/admin/prompts/:id

Get a system prompt by ID (admin only).

**Authentication:** Required (admin)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Prompt ID |

**Response (200):** Prompt object

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/admin/prompts/prompt_abc123 \
  -H "Authorization: Bearer <admin-token>"
```

---

### PATCH /api/v1/admin/prompts/:id

Update a system prompt (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Prompt ID |

**Request Body:**
```typescript
interface UpdatePromptRequest {
  name?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}
```

**Response (200):** Updated prompt object

**Example Request:**
```bash
curl -X PATCH https://api.bakame.ai/api/v1/admin/prompts/prompt_abc123 \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Updated prompt content..."}'
```

---

### POST /api/v1/admin/prompts/:id/activate

Activate a system prompt (admin only).

**Authentication:** Required (admin)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Prompt ID |

**Response (200):**
```json
{
  "data": {
    "id": "prompt_abc123",
    "status": "active"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/admin/prompts/prompt_abc123/activate \
  -H "Authorization: Bearer <admin-token>"
```

---

### GET /api/v1/admin/approvals

List pending approval requests (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | integer | Max items per page |
| `cursor` | string | Pagination cursor |
| `status` | string | Filter by status |
| `type` | string | Filter by request type |

**Response (200):**
```typescript
interface ApprovalsResponse {
  data: {
    items: Array<{
      id: string;
      resourceType: string;
      resourceId: string;
      action: string;
      status: 'pending' | 'approved' | 'rejected';
      requesterId: string;
      createdAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}
```

**Example Request:**
```bash
curl -X GET "https://api.bakame.ai/api/v1/admin/approvals?status=pending" \
  -H "Authorization: Bearer <admin-token>"
```

---

### GET /api/v1/admin/approvals/:id

Get an approval request by ID (admin only).

**Authentication:** Required (admin)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Approval request ID |

**Response (200):** Approval request object

**Example Request:**
```bash
curl -X GET https://api.bakame.ai/api/v1/admin/approvals/approval_abc123 \
  -H "Authorization: Bearer <admin-token>"
```

---

### POST /api/v1/admin/approvals/:id

Process an approval request (approve or reject) (admin only).

**Authentication:** Required (admin)

**Request Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Approval request ID |

**Request Body:**
```typescript
interface ProcessApprovalRequest {
  action: 'approve' | 'reject';  // Required
  comment?: string;              // Optional comment/reason
}
```

**Example Request Body (Approve):**
```json
{
  "action": "approve",
  "comment": "Approved for production"
}
```

**Example Request Body (Reject):**
```json
{
  "action": "reject",
  "comment": "Content needs revision before publishing"
}
```

**Response (200):**
```json
{
  "data": {
    "id": "approval_abc123",
    "status": "approved",
    "reviewedAt": "2024-01-15T10:30:00.000Z",
    "reviewerId": "admin_xyz789"
  },
  "meta": {
    "requestId": "req_xyz789"
  }
}
```

**Example Request:**
```bash
curl -X POST https://api.bakame.ai/api/v1/admin/approvals/approval_abc123 \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"action": "approve", "comment": "Looks good!"}'
```

**Error Responses:**
- `400 VALIDATION_ERROR` - Action must be "approve" or "reject"
- `403 FORBIDDEN` - Admin access required
- `404 NOT_FOUND` - Approval request not found

---

## TypeScript SDK Types

For TypeScript clients, here are the core request/response types:

```typescript
// Base response wrapper
interface ApiResponse<T> {
  data: T;
  meta: {
    requestId: string;
  };
}

// Paginated response wrapper
interface PaginatedResponse<T> {
  data: {
    items: T[];
    nextCursor: string | null;
    hasMore: boolean;
  };
  meta: {
    requestId: string;
  };
}

// Error response
interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

// Chat types
interface Chat {
  id: string;
  title: string | null;
  status: 'active' | 'archived';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// User types
interface Profile {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

interface AIPreferences {
  id: string;
  userId: string;
  responseLength: 'concise' | 'balanced' | 'detailed';
  formality: 'casual' | 'neutral' | 'formal';
  allowMemory: boolean;
  allowWebSearch: boolean;
  customInstructions: string | null;
  createdAt: string;
  updatedAt: string;
}

// Memory types
interface Memory {
  id: string;
  userId: string;
  content: string;
  category: string | null;
  source: 'conversation' | 'user_input' | 'system';
  importance: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  lastAccessed: string | null;
}

// Knowledge types
interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  category: string | null;
  status: 'draft' | 'pending_review' | 'approved' | 'published' | 'archived';
  authorId: string;
  reviewerId: string | null;
  publishedAt: string | null;
  version: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Tool types
interface Tool {
  id: string;
  name: string;
  description: string;
  type: 'local' | 'mcp' | 'n8n';
  enabled: boolean;
  requiresPermission: string | null;
  inputSchema: Record<string, unknown>;
  rateLimit?: {
    maxPerHour: number;
  };
}

// Subscription types
interface Subscription {
  id: string;
  userId: string;
  planCode: string;
  planName: string;
  status: 'active' | 'canceled' | 'past_due' | 'expired';
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}
```

---

## Changelog

### v1.0.0 (Initial Release)
- Health check endpoint
- Chat management (CRUD, messages, streaming)
- User profile and AI preferences
- Memory management with semantic search
- Knowledge base with governance workflow
- Tool discovery
- Subscription and usage tracking
- Admin endpoints for user management, audit logs, prompts, and approvals
