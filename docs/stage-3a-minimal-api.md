# STAGE 3a: MINIMAL API SHELL

**Layer**: 3a of 6 (partial)
**Status**: APPROVED (with evolution notes)
**References**:
- `docs/stage-1-database-governance.md` (IMMUTABLE)
- `docs/stage-2-service-layer.md` (IMMUTABLE)
- `docs/architecture.md` (Stage 6: API Layer)
- `docs/methodology.md` (Section 8: Platform Stack - Vercel)

---

## 0. PURPOSE OF THIS STAGE

This is a **minimal API shell** — just enough to:

1. Validate service layer ergonomics
2. Test ActorContext construction
3. Enable early mobile/web integration testing
4. Provide a foundation for Stage 4 (AI Orchestrator)

**This is NOT the full API layer.** Stage 3b will expand after AI Orchestrator is built.

### What This Stage Includes

- ActorContext construction from Supabase JWT
- Auth middleware
- Chat creation endpoint
- Send message endpoint
- SSE streaming scaffold (stub)
- Error response format

### What This Stage Does NOT Include

- Full CRUD for all resources
- Admin endpoints
- Knowledge/Prompt management endpoints
- Tool management endpoints
- WebSocket support
- Rate limiting (deferred to Stage 3b)

---

## 1. API LAYER PRINCIPLES

### 1.1 Non-Negotiable Rules

From `architecture.md`:

1. **APIs are thin** — transport only, no business logic
2. **No business logic** — delegate everything to services
3. **No AI logic** — API knows nothing about LLMs
4. **REST + streaming (SSE)** — standard protocols

### 1.2 What API Layer MUST Do

- Parse and validate HTTP requests
- Extract and verify auth tokens
- Construct ActorContext
- Call appropriate service methods
- Transform service results to HTTP responses
- Handle streaming responses

### 1.3 What API Layer MUST NEVER Do

- Implement business rules
- Access database directly
- Construct prompts
- Make authorization decisions (that's AuthService)
- Cache business data
- Transform data beyond serialization

### 1.4 API Layer Position

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT                                  │
│              (Flutter Web/Mobile, etc.)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API LAYER (THIS STAGE)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Auth        │  │ Request     │  │ Response    │             │
│  │ Middleware  │  │ Handlers    │  │ Formatters  │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ ActorContext + params
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SERVICE LAYER (Stage 2)                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. TECHNOLOGY CHOICES

### 2.1 Runtime

**Vercel Serverless Functions** (from methodology.md)

- Edge-compatible where possible
- Serverless for request handlers
- Built-in streaming support

### 2.2 Framework

**Hono** (recommended for Vercel Edge)

Why Hono:
- Lightweight (~14kb)
- Edge-first design
- TypeScript native
- Middleware support
- Streaming support
- Vercel adapter available

Alternative: Next.js API routes (heavier, but works)

### 2.3 Auth

**Supabase Auth** (from methodology.md)

- JWT verification
- Already integrated with database
- Row-level security alignment

---

## 3. ACTORCONTEXT CONSTRUCTION

This is the **critical bridge** between HTTP and service layer.

### 3.1 Flow

```
HTTP Request
     │
     │ Authorization: Bearer <jwt>
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Auth Middleware                                                 │
│   1. Extract JWT from Authorization header                      │
│   2. Verify JWT with Supabase                                  │
│   3. Extract user ID from JWT claims                           │
│   4. Call AuthService.resolvePermissions(userId)               │
│   5. Construct ActorContext                                    │
│   6. Attach to request context                                 │
└─────────────────────────────────────────────────────────────────┘
     │
     │ ActorContext attached
     ▼
┌─────────────────────────────────────────────────────────────────┐
│ Request Handler                                                 │
│   - Receives ActorContext from middleware                      │
│   - Calls service methods with ActorContext                    │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Implementation

```typescript
import { createClient } from '@supabase/supabase-js';
import { Context, Next } from 'hono';
import { AuthService } from '@/services/auth';

// Types from Stage 2 (extended for API layer)
interface ActorContext {
  type: 'user' | 'admin' | 'system' | 'ai' | 'anonymous';
  userId?: string;
  sessionId?: string;
  requestId: string;
  permissions: string[];
  ip?: string;
  userAgent?: string;
}

// NOTE: 'anonymous' type added for public endpoints
// Prevents accidental privilege assumptions in analytics/logging

// Extend Hono context
declare module 'hono' {
  interface ContextVariableMap {
    actor: ActorContext;
  }
}

// UUID v7 generator
// IMPLEMENTATION NOTE: Use a proper UUIDv7 library (uuidv7, uuid7)
// crypto.randomUUID() is UUIDv4 - NOT time-sortable
// UUIDv7 required for: cursor ordering, pagination, audit correlation
import { uuidv7 } from 'uuidv7'; // Add to dependencies

function generateRequestId(): string {
  return uuidv7();
}

/**
 * Auth middleware - constructs ActorContext from JWT
 *
 * EVOLUTION NOTE (Stage 3b+):
 * Current implementation calls Supabase API per request (network overhead).
 * For production scale, evolve to:
 *   1. Verify JWT locally using Supabase JWKS (jose library)
 *   2. Cache JWKS with TTL
 *   3. Only call Supabase for token refresh/revocation checks
 * This reduces latency and cost on Edge.
 */
export async function authMiddleware(c: Context, next: Next) {
  const requestId = generateRequestId();

  // Extract token
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid authorization header',
        requestId,
      }
    }, 401);
  }

  const token = authHeader.slice(7);

  try {
    // Verify JWT with Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return c.json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
          requestId,
        }
      }, 401);
    }

    // Resolve permissions via AuthService
    const authService = new AuthService(); // DI in real implementation
    const permissionsResult = await authService.resolvePermissions(user.id);

    if (!permissionsResult.success) {
      return c.json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to resolve permissions',
          requestId,
        }
      }, 500);
    }

    // Determine actor type based on permissions
    const permissions = permissionsResult.data;
    const isAdmin = permissions.includes('user:manage') ||
                    permissions.includes('knowledge:publish') ||
                    permissions.includes('*');

    // Construct ActorContext
    const actor: ActorContext = {
      type: isAdmin ? 'admin' : 'user',
      userId: user.id,
      sessionId: token.slice(-8), // Last 8 chars for correlation
      requestId,
      permissions,
      ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
      userAgent: c.req.header('user-agent'),
    };

    // Attach to context
    c.set('actor', actor);

    await next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return c.json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication failed',
        requestId,
      }
    }, 500);
  }
}

/**
 * Optional: Public route middleware (no auth required)
 */
export async function publicMiddleware(c: Context, next: Next) {
  const requestId = generateRequestId();

  // Create anonymous actor
  const actor: ActorContext = {
    type: 'anonymous',  // NOT 'user' - prevents privilege assumptions
    requestId,
    permissions: [], // No permissions for anonymous
    ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip'),
    userAgent: c.req.header('user-agent'),
  };

  c.set('actor', actor);
  await next();
}
```

### 3.3 ActorContext Invariants

| Rule | Enforcement |
|------|-------------|
| `requestId` is always UUIDv7 | Generated in middleware |
| `userId` is always from verified JWT | Never from request body |
| `permissions` are always from AuthService | Never hardcoded |
| `type` is derived from permissions | Never from client |
| AI_ACTOR is never constructed from HTTP | Only internal use |

---

## 4. ERROR RESPONSE FORMAT

### 4.1 Standard Error Response

```typescript
interface ErrorResponse {
  error: {
    code: string;        // Machine-readable code
    message: string;     // Human-readable message
    requestId: string;   // For tracing/support
    details?: unknown;   // Optional additional info
  };
}
```

### 4.2 Error Code Mapping

| Service Error Code | HTTP Status | Notes |
|-------------------|-------------|-------|
| `UNAUTHORIZED` | 401 | Missing/invalid token |
| `PERMISSION_DENIED` | 403 | Valid token, insufficient permissions |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `VALIDATION_ERROR` | 400 | Invalid request body |
| `CONFLICT` | 409 | State conflict |
| `RATE_LIMITED` | 429 | Quota exceeded |
| `QUOTA_EXCEEDED` | 402 | Billing limit reached |
| `INTERNAL_ERROR` | 500 | Unexpected failure |

### 4.3 Error Response Helper

```typescript
import { Context } from 'hono';
import { ServiceError } from '@/services/types';

const STATUS_MAP: Record<string, number> = {
  'UNAUTHORIZED': 401,
  'PERMISSION_DENIED': 403,
  'NOT_FOUND': 404,
  'VALIDATION_ERROR': 400,
  'CONFLICT': 409,
  'RATE_LIMITED': 429,
  'QUOTA_EXCEEDED': 402,
  'INTERNAL_ERROR': 500,
};

export function errorResponse(
  c: Context,
  error: ServiceError,
  requestId: string
) {
  const status = STATUS_MAP[error.code] || 500;

  return c.json({
    error: {
      code: error.code,
      message: error.message,
      requestId,
      details: error.details,
    }
  }, status);
}
```

---

## 5. MINIMAL ENDPOINTS

### 5.1 Endpoint Summary

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `POST` | `/api/chats` | Create new chat | Required |
| `GET` | `/api/chats` | List user's chats | Required |
| `GET` | `/api/chats/:id` | Get chat details | Required |
| `POST` | `/api/chats/:id/messages` | Send message | Required |
| `GET` | `/api/chats/:id/messages` | Get messages | Required |
| `GET` | `/api/chats/:id/stream` | SSE stream (stub) | Required |
| `GET` | `/api/health` | Health check | None |

### 5.2 Request/Response Contracts

#### POST /api/chats

Create a new chat.

```typescript
// Request
interface CreateChatRequest {
  title?: string;
  metadata?: Record<string, unknown>;
}

// Response (201 Created)
interface CreateChatResponse {
  data: {
    id: string;
    title: string | null;
    status: 'active';
    createdAt: string;  // ISO 8601
  };
}

// Handler
app.post('/api/chats', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const body = await c.req.json<CreateChatRequest>();

  const result = await chatService.createChat(actor, {
    title: body.title,
    metadata: body.metadata,
  });

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: {
      id: result.data.id,
      title: result.data.title,
      status: result.data.status,
      createdAt: result.data.createdAt.toISOString(),
    }
  }, 201);
});
```

#### GET /api/chats

List user's chats.

```typescript
// Query params
interface ListChatsQuery {
  cursor?: string;
  limit?: number;  // default: 20, max: 100
  status?: 'active' | 'archived';
}

// Response (200 OK)
interface ListChatsResponse {
  data: {
    items: ChatSummary[];
    nextCursor: string | null;
    hasMore: boolean;
  };
}

interface ChatSummary {
  id: string;
  title: string | null;
  status: 'active' | 'archived';
  lastMessageAt: string | null;
  messageCount: number;
  createdAt: string;
}

// Handler
app.get('/api/chats', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const cursor = c.req.query('cursor');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const status = c.req.query('status') as 'active' | 'archived' | undefined;

  const result = await chatService.listChats(actor, {
    cursor,
    limit,
    status,
  });

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: {
      items: result.data.items.map(chat => ({
        id: chat.id,
        title: chat.title,
        status: chat.status,
        lastMessageAt: chat.lastMessageAt?.toISOString() || null,
        messageCount: chat.messageCount,
        createdAt: chat.createdAt.toISOString(),
      })),
      nextCursor: result.data.nextCursor || null,
      hasMore: result.data.hasMore,
    }
  });
});
```

#### GET /api/chats/:id

Get chat details.

```typescript
// Response (200 OK)
interface GetChatResponse {
  data: {
    id: string;
    title: string | null;
    status: 'active' | 'archived' | 'deleted';
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
}

// Handler
app.get('/api/chats/:id', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const chatId = c.req.param('id');

  const result = await chatService.getChat(actor, chatId);

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: {
      id: result.data.id,
      title: result.data.title,
      status: result.data.status,
      metadata: result.data.metadata,
      createdAt: result.data.createdAt.toISOString(),
      updatedAt: result.data.updatedAt.toISOString(),
    }
  });
});
```

#### POST /api/chats/:id/messages

Send a message to a chat. **This is the primary endpoint.**

```typescript
// Request
interface SendMessageRequest {
  content: string;
  // Note: role is always 'user' for API calls
  // 'assistant', 'system', 'tool' are internal only
}

// Response (201 Created)
interface SendMessageResponse {
  data: {
    id: string;
    chatId: string;
    role: 'user';
    content: string;
    createdAt: string;
  };
}

// Handler
app.post('/api/chats/:id/messages', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const chatId = c.req.param('id');
  const body = await c.req.json<SendMessageRequest>();

  // Validate content
  if (!body.content || typeof body.content !== 'string') {
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'content is required and must be a string',
        requestId: actor.requestId,
      }
    }, 400);
  }

  if (body.content.length > 32000) {
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'content exceeds maximum length of 32000 characters',
        requestId: actor.requestId,
      }
    }, 400);
  }

  // Add user message
  const result = await chatService.addMessage(actor, {
    chatId,
    role: 'user',  // Always 'user' from API
    content: body.content,
  });

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: {
      id: result.data.id,
      chatId: result.data.chatId,
      role: result.data.role,
      content: result.data.content,
      createdAt: result.data.createdAt.toISOString(),
    }
  }, 201);
});
```

#### GET /api/chats/:id/messages

Get messages in a chat.

```typescript
// Query params
interface ListMessagesQuery {
  cursor?: string;
  limit?: number;  // default: 50, max: 100
}

// Response (200 OK)
interface ListMessagesResponse {
  data: {
    items: Message[];
    nextCursor: string | null;
    hasMore: boolean;
  };
}

interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// Handler
app.get('/api/chats/:id/messages', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const chatId = c.req.param('id');
  const cursor = c.req.query('cursor');
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);

  const result = await chatService.getMessages(actor, chatId, {
    cursor,
    limit,
  });

  if (!result.success) {
    return errorResponse(c, result.error, actor.requestId);
  }

  return c.json({
    data: {
      items: result.data.items.map(msg => ({
        id: msg.id,
        chatId: msg.chatId,
        role: msg.role,
        content: msg.content,
        metadata: msg.metadata,
        createdAt: msg.createdAt.toISOString(),
      })),
      nextCursor: result.data.nextCursor || null,
      hasMore: result.data.hasMore,
    }
  });
});
```

#### GET /api/health

Health check (no auth).

```typescript
// Response (200 OK)
interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

// Handler
app.get('/api/health', async (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});
```

---

## 6. SSE STREAMING SCAFFOLD

This is a **stub** for Stage 4. The actual streaming will be implemented with the AI Orchestrator.

### 6.1 Purpose

- Establish SSE infrastructure
- Define streaming event format
- Enable frontend development to proceed

### 6.1.1 Security Evolution (IMPORTANT)

**Current**: Token passed in query string (unavoidable for browser EventSource API)

**Risk**: Token exposure in logs, referrer headers, browser history

**Evolution for Production (Stage 3b+)**:

| Option | Description | Trade-off |
|--------|-------------|-----------|
| Short-lived stream tokens | POST to get stream token, use token in SSE URL | Extra round-trip |
| Cookie-based auth | Set HttpOnly cookie, SSE reads from cookie | Requires same-origin |
| POST-based stream init | POST returns stream ID, GET with stream ID | More complex |

**Recommendation**: Implement short-lived stream tokens before production scale.

```typescript
// Future pattern:
// 1. POST /api/chats/:id/stream/init → { streamToken, expiresIn: 30 }
// 2. GET /api/chats/:id/stream?token=<short_lived_token>
```

### 6.2 Stream Event Format

```typescript
// SSE event types
type StreamEventType =
  | 'message.start'      // AI response started
  | 'message.delta'      // Incremental content
  | 'message.complete'   // AI response finished
  | 'tool.start'         // Tool invocation started
  | 'tool.complete'      // Tool invocation finished
  | 'error'              // Error occurred
  | 'done';              // Stream complete

interface StreamEvent {
  type: StreamEventType;
  data: unknown;
}

// Specific event shapes
interface MessageStartEvent {
  type: 'message.start';
  data: {
    messageId: string;
  };
}

interface MessageDeltaEvent {
  type: 'message.delta';
  data: {
    content: string;  // Incremental text
  };
}

interface MessageCompleteEvent {
  type: 'message.complete';
  data: {
    messageId: string;
    content: string;      // Full content
    tokenCount: number;
  };
}

interface ToolStartEvent {
  type: 'tool.start';
  data: {
    invocationId: string;
    toolName: string;
  };
}

interface ToolCompleteEvent {
  type: 'tool.complete';
  data: {
    invocationId: string;
    toolName: string;
    status: 'success' | 'failure';
  };
}

interface ErrorEvent {
  type: 'error';
  data: {
    code: string;
    message: string;
  };
}

interface DoneEvent {
  type: 'done';
  data: {};
}
```

### 6.3 Stub Endpoint

```typescript
// GET /api/chats/:id/stream?message=<encoded_message>
// Or POST /api/chats/:id/stream with body

app.get('/api/chats/:id/stream', authMiddleware, async (c) => {
  const actor = c.get('actor');
  const chatId = c.req.param('id');
  const userMessage = c.req.query('message');

  if (!userMessage) {
    return c.json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'message query parameter is required',
        requestId: actor.requestId,
      }
    }, 400);
  }

  // Verify chat ownership
  const chatResult = await chatService.getChat(actor, chatId);
  if (!chatResult.success) {
    return errorResponse(c, chatResult.error, actor.requestId);
  }

  // Set up SSE
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return streamSSE(c, async (stream) => {
    try {
      // Add user message
      const messageResult = await chatService.addMessage(actor, {
        chatId,
        role: 'user',
        content: decodeURIComponent(userMessage),
      });

      if (!messageResult.success) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            type: 'error',
            data: {
              code: messageResult.error.code,
              message: messageResult.error.message,
            }
          }),
        });
        return;
      }

      // STUB: In Stage 4, this will call ContextService + AI Orchestrator
      // For now, send placeholder events

      await stream.writeSSE({
        event: 'message.start',
        data: JSON.stringify({
          type: 'message.start',
          data: { messageId: 'stub-message-id' },
        }),
      });

      // Simulate streaming response
      const stubResponse = 'This is a stub response. AI Orchestrator will be implemented in Stage 4.';
      const words = stubResponse.split(' ');

      for (const word of words) {
        await stream.writeSSE({
          event: 'message.delta',
          data: JSON.stringify({
            type: 'message.delta',
            data: { content: word + ' ' },
          }),
        });
        await stream.sleep(50); // Simulate typing
      }

      await stream.writeSSE({
        event: 'message.complete',
        data: JSON.stringify({
          type: 'message.complete',
          data: {
            messageId: 'stub-message-id',
            content: stubResponse,
            tokenCount: 0,
          },
        }),
      });

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({
          type: 'done',
          data: {},
        }),
      });

    } catch (err) {
      console.error('Stream error:', err);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          data: {
            code: 'INTERNAL_ERROR',
            message: 'Stream failed unexpectedly',
          },
        }),
      });
    }
  });
});
```

### 6.4 Client Usage Example

```typescript
// Frontend SSE client example
const eventSource = new EventSource(
  `/api/chats/${chatId}/stream?message=${encodeURIComponent(userMessage)}`,
  { headers: { Authorization: `Bearer ${token}` } }
);

eventSource.addEventListener('message.delta', (event) => {
  const data = JSON.parse(event.data);
  appendToResponse(data.data.content);
});

eventSource.addEventListener('message.complete', (event) => {
  const data = JSON.parse(event.data);
  finalizeResponse(data.data);
});

eventSource.addEventListener('error', (event) => {
  const data = JSON.parse(event.data);
  showError(data.data.message);
});

eventSource.addEventListener('done', () => {
  eventSource.close();
});
```

---

## 7. APPLICATION STRUCTURE

### 7.1 File Organization

```
/api
├── index.ts              # Main Hono app
├── middleware/
│   ├── auth.ts           # Auth middleware (ActorContext)
│   └── error.ts          # Error handling middleware
├── routes/
│   ├── chats.ts          # Chat endpoints
│   ├── health.ts         # Health check
│   └── index.ts          # Route aggregator
├── lib/
│   ├── errors.ts         # Error response helpers
│   └── validation.ts     # Request validation
└── types/
    └── api.ts            # API-specific types
```

### 7.2 Main Application

```typescript
// api/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { chatRoutes } from './routes/chats';
import { healthRoutes } from './routes/health';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));

// Routes
app.route('/api', healthRoutes);
app.route('/api', chatRoutes);

// 404 handler
app.notFound((c) => {
  return c.json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
      requestId: c.get('actor')?.requestId || 'unknown',
    }
  }, 404);
});

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: c.get('actor')?.requestId || 'unknown',
    }
  }, 500);
});

export default app;
```

### 7.3 Vercel Configuration

```json
// vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "api/index.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/index.ts"
    }
  ]
}
```

---

## 8. REQUEST FLOW DIAGRAM

### 8.1 Standard Request Flow

```
Client
  │
  │ POST /api/chats/:id/messages
  │ Authorization: Bearer <jwt>
  │ Content-Type: application/json
  │ {"content": "Hello"}
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Vercel Edge/Serverless                                          │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Hono App                                                        │
│                                                                 │
│   1. Logger middleware (request logging)                       │
│   2. CORS middleware (origin check)                            │
│   3. Auth middleware:                                          │
│      - Extract JWT                                             │
│      - Verify with Supabase                                    │
│      - Resolve permissions (AuthService)                       │
│      - Build ActorContext                                      │
│   4. Route handler:                                            │
│      - Validate request body                                   │
│      - Call ChatService.addMessage(actor, params)              │
│      - Transform result to HTTP response                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
  │
  │ Result<Message>
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Response                                                        │
│                                                                 │
│ 201 Created                                                    │
│ Content-Type: application/json                                 │
│ {                                                              │
│   "data": {                                                    │
│     "id": "...",                                               │
│     "chatId": "...",                                           │
│     "role": "user",                                            │
│     "content": "Hello",                                        │
│     "createdAt": "2024-..."                                    │
│   }                                                            │
│ }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Streaming Request Flow

```
Client
  │
  │ GET /api/chats/:id/stream?message=Hello
  │ Authorization: Bearer <jwt>
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Auth Middleware → ActorContext                                  │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Stream Handler                                                  │
│   1. Verify chat ownership                                     │
│   2. Add user message (ChatService)                            │
│   3. [STAGE 4] Build context (ContextService)                  │
│   4. [STAGE 4] Stream AI response                              │
│   5. Send SSE events                                           │
└─────────────────────────────────────────────────────────────────┘
  │
  │ SSE Events
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ event: message.start                                           │
│ data: {"type":"message.start","data":{"messageId":"..."}}      │
│                                                                 │
│ event: message.delta                                           │
│ data: {"type":"message.delta","data":{"content":"This "}}      │
│                                                                 │
│ event: message.delta                                           │
│ data: {"type":"message.delta","data":{"content":"is "}}        │
│                                                                 │
│ ... more deltas ...                                            │
│                                                                 │
│ event: message.complete                                        │
│ data: {"type":"message.complete","data":{...}}                 │
│                                                                 │
│ event: done                                                    │
│ data: {"type":"done","data":{}}                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. SECURITY CONSIDERATIONS

### 9.1 Auth Security

| Rule | Implementation |
|------|----------------|
| JWT verification | Supabase verifies signature |
| No token in URL | Except for SSE (unavoidable for EventSource) |
| Token expiry | Supabase handles refresh |
| User ID from token only | Never from request body |

### 9.2 Input Validation

| Input | Validation |
|-------|------------|
| `chatId` | UUID format |
| `content` | Max 32,000 chars, non-empty |
| `cursor` | UUID format (when present) |
| `limit` | Integer, 1-100 |

### 9.3 Output Sanitization

- Dates always ISO 8601
- No internal IDs exposed (use public UUIDs)
- Error messages never expose stack traces
- Metadata filtered for sensitive keys

---

## 10. WHAT THIS STAGE VALIDATES

Before proceeding to Stage 4, this API shell validates:

| Validation | How |
|------------|-----|
| ActorContext construction works | Auth middleware + AuthService |
| Service layer is callable | Chat endpoints work |
| Error handling is consistent | All error paths return standard format |
| Streaming infrastructure works | SSE stub connects |
| Vercel deployment works | Health check endpoint |

---

## 11. WHAT THIS STAGE DOES NOT INCLUDE

Deferred to Stage 3b (after AI Orchestrator):

- Full CRUD for all resources
- Admin endpoints
- Knowledge management
- Prompt management
- Tool management
- User/profile endpoints
- File upload endpoints
- Rate limiting
- WebSocket support
- Batch operations

---

## 12. NEXT STEPS

**Stage 3a is now APPROVED.**

### Implementation Sequence

1. **Implement Stage 3a** — Create the minimal API shell
2. **Deploy to Vercel** — Verify infrastructure
3. **Test with Flutter** — Validate client integration
4. **Proceed to Stage 4** — AI Orchestrator

### Stage 4 Integration Points

When Stage 4 is built, it will:
- Replace the SSE stub with real AI orchestration
- Call `ContextService.buildContext()`
- Stream responses via the established SSE infrastructure
- Call `ContextService.persistResponse()` on completion

### Evolution Items (Track for Stage 3b)

| Item | Priority | Notes |
|------|----------|-------|
| Local JWT verification | High | Use jose + Supabase JWKS |
| SSE token security | High | Short-lived stream tokens |
| Rate limiting | Medium | Redis/Upstash based |
| WebSocket support | Low | If SSE insufficient |

---

**STAGE 3a COMPLETE - READY FOR IMPLEMENTATION OR STAGE 4 DESIGN**
