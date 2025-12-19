# BACKEND HARDENING PHASE — PLAN

**Status**: PROPOSAL (Awaiting Approval)
**Purpose**: Define CI/CD, TDD strategy, and hardening workflow before implementation
**Prerequisite**: All design stages (1-5) are APPROVED & LOCKED

---

## 0. PHASE OBJECTIVES

Before writing production code, we must establish:

1. **CI/CD Pipeline** — Automated quality gates
2. **TDD Strategy** — Test-first development workflow
3. **Hardening Workflow** — Iterative stabilization process
4. **Test Gates** — Required coverage before stage completion

### What This Phase Produces

| Deliverable | Description |
|-------------|-------------|
| CI/CD Pipeline | GitHub Actions workflows for all stages |
| Test Infrastructure | Jest/Vitest setup, fixtures, mocks |
| Quality Gates | Lint, type-check, test, coverage thresholds |
| Hardening Checklist | Per-component verification criteria |

### What This Phase Does NOT Do

- ❌ Implement production features
- ❌ Deploy to production
- ❌ Define frontend contracts
- ❌ Write n8n workflows

---

## 1. CI/CD PIPELINE

### 1.1 Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        GITHUB ACTIONS                           │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
   ┌─────────┐          ┌─────────┐          ┌─────────┐
   │  PULL   │          │  MAIN   │          │ RELEASE │
   │ REQUEST │          │  PUSH   │          │   TAG   │
   └────┬────┘          └────┬────┘          └────┬────┘
        │                    │                    │
        ▼                    ▼                    ▼
   ┌─────────┐          ┌─────────┐          ┌─────────┐
   │  GATE   │          │  GATE   │          │  GATE   │
   │   CI    │          │   CD    │          │ RELEASE │
   └─────────┘          └─────────┘          └─────────┘
        │                    │                    │
        ▼                    ▼                    ▼
   Lint + Test          Deploy to           Deploy to
   Type Check           Preview             Production
   Coverage
```

### 1.2 Pipeline Stages

#### Stage 1: PR Gate (Continuous Integration)

**Trigger**: Pull request to `main` or `develop`

**NOTE**: Using Supabase Cloud instead of Docker containers (bandwidth optimization).

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main, develop]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm format:check

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  test-unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:unit --coverage
      - name: Check coverage threshold
        run: pnpm test:coverage:check

  test-integration:
    runs-on: ubuntu-latest
    # Uses Supabase Cloud (test project) instead of Docker containers
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:integration
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL_TEST }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY_TEST }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY_TEST }}
          UPSTASH_REDIS_URL: ${{ secrets.UPSTASH_REDIS_URL }}
          UPSTASH_REDIS_TOKEN: ${{ secrets.UPSTASH_REDIS_TOKEN }}

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run security audit
        run: pnpm audit --audit-level=high
```

**Required Checks** (all must pass):

| Check | Threshold | Blocking |
|-------|-----------|----------|
| Lint (ESLint) | 0 errors | ✅ Yes |
| Format (Prettier) | 0 violations | ✅ Yes |
| TypeScript | 0 errors | ✅ Yes |
| Unit Tests | 100% pass | ✅ Yes |
| Unit Coverage | 80% statements | ✅ Yes |
| Integration Tests | 100% pass | ✅ Yes |
| Security Scan | 0 high/critical | ✅ Yes |

#### Stage 2: Preview Deploy (Continuous Deployment)

**Trigger**: Push to `main` branch

```yaml
# .github/workflows/cd-preview.yml
name: CD Preview

on:
  push:
    branches: [main]

jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    environment: preview
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: Deploy to Vercel Preview
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          scope: ${{ secrets.VERCEL_ORG_ID }}

      - name: Run smoke tests
        run: pnpm test:smoke --url ${{ steps.deploy.outputs.preview-url }}

      - name: Run E2E tests
        run: pnpm test:e2e --url ${{ steps.deploy.outputs.preview-url }}
```

#### Stage 3: Production Release

**Trigger**: Git tag `v*`

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  validate-tag:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Validate semver tag
        run: |
          TAG=${GITHUB_REF#refs/tags/}
          if [[ ! $TAG =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "Invalid tag format: $TAG"
            exit 1
          fi

  deploy-production:
    needs: [validate-tag]
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: Run full test suite
        run: pnpm test:all

      - name: Deploy to Vercel Production
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
          scope: ${{ secrets.VERCEL_ORG_ID }}

      - name: Run production smoke tests
        run: pnpm test:smoke:prod

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          generate_release_notes: true
```

### 1.3 Environment Configuration

| Environment | Branch/Trigger | Supabase | Vercel | Purpose |
|-------------|----------------|----------|--------|---------|
| `test` | CI jobs | Local container | N/A | Automated tests |
| `preview` | `main` push | Staging project | Preview URL | Integration testing |
| `production` | `v*` tag | Production project | Production URL | Live users |

### 1.4 Secret Management

```yaml
# Required GitHub Secrets
secrets:
  # Vercel
  VERCEL_TOKEN: "..."
  VERCEL_ORG_ID: "..."
  VERCEL_PROJECT_ID: "..."

  # Supabase (Preview)
  SUPABASE_URL_PREVIEW: "..."
  SUPABASE_ANON_KEY_PREVIEW: "..."
  SUPABASE_SERVICE_KEY_PREVIEW: "..."

  # Supabase (Production)
  SUPABASE_URL_PROD: "..."
  SUPABASE_ANON_KEY_PROD: "..."
  SUPABASE_SERVICE_KEY_PROD: "..."

  # Upstash
  UPSTASH_REDIS_URL: "..."
  UPSTASH_REDIS_TOKEN: "..."
  QSTASH_TOKEN: "..."

  # External APIs
  ANTHROPIC_API_KEY: "..."
  BRAVE_API_KEY: "..."

  # Security
  SNYK_TOKEN: "..."
```

---

## 2. TEST-DRIVEN DEVELOPMENT (TDD) STRATEGY

### 2.1 TDD Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                      TDD CYCLE (RED-GREEN-REFACTOR)             │
└─────────────────────────────────────────────────────────────────┘

    ┌─────────┐         ┌─────────┐         ┌─────────┐
    │   RED   │ ──────▶ │  GREEN  │ ──────▶ │REFACTOR │
    │         │         │         │         │         │
    │ Write   │         │ Write   │         │ Clean   │
    │ failing │         │ minimal │         │ up code │
    │ test    │         │ code    │         │         │
    └────┬────┘         └────┬────┘         └────┬────┘
         │                   │                   │
         └───────────────────┴───────────────────┘
                             │
                             ▼
                      ┌─────────────┐
                      │   COMMIT    │
                      │ (tests pass)│
                      └─────────────┘
```

### 2.2 Test Categories

#### Category 1: Unit Tests

**Scope**: Individual functions, classes, modules in isolation

**Characteristics**:
- No I/O (database, network, filesystem)
- Fast execution (<100ms per test)
- Mocked dependencies
- High coverage target (80%+)

**Example Targets**:
```
src/services/auth.ts       → src/services/__tests__/auth.unit.test.ts
src/tools/local/calc.ts    → src/tools/local/__tests__/calc.unit.test.ts
src/utils/validation.ts    → src/utils/__tests__/validation.unit.test.ts
```

**Pattern**:
```typescript
// src/services/__tests__/auth.unit.test.ts
import { describe, it, expect, vi } from 'vitest';
import { AuthService } from '../auth';

describe('AuthService', () => {
  describe('resolvePermissions', () => {
    it('should return empty permissions for anonymous actor', async () => {
      const mockDb = { query: vi.fn().mockResolvedValue([]) };
      const service = new AuthService(mockDb);

      const result = await service.resolvePermissions({
        type: 'anonymous',
        requestId: 'test-123',
        permissions: [],
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should resolve user permissions from roles', async () => {
      // ... test implementation
    });
  });
});
```

#### Category 2: Integration Tests

**Scope**: Service interactions with real dependencies

**Characteristics**:
- Real database (test container)
- Real Redis (test container)
- Mocked external APIs (MSW)
- Medium execution time (<5s per test)

**Example Targets**:
```
ChatService + Database      → tests/integration/chat.integration.test.ts
ToolService + Redis         → tests/integration/tools.integration.test.ts
MemoryService + pgvector    → tests/integration/memory.integration.test.ts
```

**Pattern**:
```typescript
// tests/integration/chat.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDatabase, cleanupTestDatabase } from '../helpers/db';
import { ChatService } from '../../src/services/chat';

describe('ChatService Integration', () => {
  let db: TestDatabase;
  let chatService: ChatService;

  beforeAll(async () => {
    db = await createTestDatabase();
    chatService = new ChatService(db);
  });

  afterAll(async () => {
    await cleanupTestDatabase(db);
  });

  beforeEach(async () => {
    await db.truncate(['chats', 'messages']);
  });

  describe('createChat', () => {
    it('should persist chat to database', async () => {
      const actor = createTestActor('user');

      const result = await chatService.createChat(actor, {
        title: 'Test Chat',
      });

      expect(result.success).toBe(true);

      // Verify in database
      const dbChat = await db.query('SELECT * FROM chats WHERE id = $1', [result.data.id]);
      expect(dbChat.rows[0].title).toBe('Test Chat');
    });
  });
});
```

#### Category 3: Contract Tests

**Scope**: API request/response contracts

**Characteristics**:
- Test HTTP layer only
- Mock service layer
- Verify request parsing, response formatting
- Fast execution

**Example Targets**:
```
POST /api/v1/chats         → tests/contracts/chats.contract.test.ts
GET /api/v1/memories       → tests/contracts/memories.contract.test.ts
Admin endpoints            → tests/contracts/admin.contract.test.ts
```

**Pattern**:
```typescript
// tests/contracts/chats.contract.test.ts
import { describe, it, expect, vi } from 'vitest';
import { app } from '../../src/api';
import { chatService } from '../../src/services';

vi.mock('../../src/services');

describe('POST /api/v1/chats', () => {
  it('should return 201 with created chat', async () => {
    vi.mocked(chatService.createChat).mockResolvedValue({
      success: true,
      data: { id: 'chat-123', title: 'Test', createdAt: new Date() },
    });

    const response = await app.request('/api/v1/chats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token',
      },
      body: JSON.stringify({ title: 'Test' }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.id).toBe('chat-123');
    expect(body.meta.requestId).toBeDefined();
  });

  it('should return 400 for invalid body', async () => {
    const response = await app.request('/api/v1/chats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token',
      },
      body: JSON.stringify({}),  // Missing required field
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
```

#### Category 4: E2E Tests

**Scope**: Full user flows against deployed environment

**Characteristics**:
- Real deployed environment (preview)
- Real database, real APIs
- Slow execution (acceptable)
- Critical path coverage

**Example Targets**:
```
User signup → chat → AI response  → tests/e2e/chat-flow.e2e.test.ts
Admin login → manage prompts      → tests/e2e/admin-flow.e2e.test.ts
Tool execution flow               → tests/e2e/tool-flow.e2e.test.ts
```

**Pattern**:
```typescript
// tests/e2e/chat-flow.e2e.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createTestUser, cleanupTestUser } from '../helpers/e2e';

describe('Chat Flow E2E', () => {
  let testUser: TestUser;
  let apiClient: APIClient;

  beforeAll(async () => {
    testUser = await createTestUser();
    apiClient = new APIClient(process.env.E2E_BASE_URL, testUser.token);
  });

  afterAll(async () => {
    await cleanupTestUser(testUser);
  });

  it('should complete full chat conversation', async () => {
    // Create chat
    const chat = await apiClient.post('/api/v1/chats', { title: 'E2E Test' });
    expect(chat.data.id).toBeDefined();

    // Send message and get AI response
    const message = await apiClient.post(`/api/v1/chats/${chat.data.id}/messages`, {
      content: 'What is 2 + 2?',
      stream: false,
    });

    expect(message.data.userMessage).toBeDefined();
    expect(message.data.assistantMessage).toBeDefined();
    expect(message.data.assistantMessage.content).toContain('4');
  });
});
```

#### Category 5: Load Tests

**Scope**: Performance and scalability verification

**Characteristics**:
- Run against preview environment
- Measure response times, throughput
- Identify bottlenecks
- Gate for production release

**Targets**:
```
API endpoint latency      → tests/load/api-latency.load.test.ts
SSE streaming throughput  → tests/load/sse-throughput.load.test.ts
Concurrent tool execution → tests/load/tools-concurrent.load.test.ts
```

### 2.3 Test File Structure

```
tests/
├── unit/                           # Unit tests (mirror src/ structure)
│   ├── services/
│   │   ├── auth.unit.test.ts
│   │   ├── chat.unit.test.ts
│   │   ├── memory.unit.test.ts
│   │   └── ...
│   ├── tools/
│   │   ├── local/
│   │   │   ├── calculator.unit.test.ts
│   │   │   └── datetime.unit.test.ts
│   │   └── executor.unit.test.ts
│   └── utils/
│       ├── validation.unit.test.ts
│       └── pagination.unit.test.ts
├── integration/                    # Integration tests
│   ├── services/
│   │   ├── chat.integration.test.ts
│   │   ├── memory.integration.test.ts
│   │   └── tool.integration.test.ts
│   └── workers/
│       ├── embedding.integration.test.ts
│       └── workflow.integration.test.ts
├── contracts/                      # API contract tests
│   ├── chats.contract.test.ts
│   ├── users.contract.test.ts
│   ├── memories.contract.test.ts
│   └── admin.contract.test.ts
├── e2e/                           # End-to-end tests
│   ├── chat-flow.e2e.test.ts
│   ├── admin-flow.e2e.test.ts
│   └── tool-flow.e2e.test.ts
├── load/                          # Load tests
│   ├── api-latency.load.test.ts
│   └── sse-throughput.load.test.ts
├── fixtures/                      # Test data
│   ├── users.fixture.ts
│   ├── chats.fixture.ts
│   └── tools.fixture.ts
├── mocks/                         # Mock implementations
│   ├── services.mock.ts
│   ├── external-apis.mock.ts
│   └── mcp-servers.mock.ts
└── helpers/                       # Test utilities
    ├── db.ts                      # Database helpers
    ├── auth.ts                    # Auth helpers
    ├── api-client.ts              # E2E API client
    └── assertions.ts              # Custom assertions
```

### 2.4 Coverage Requirements

| Test Category | Coverage Target | Blocking |
|---------------|-----------------|----------|
| Unit Tests | 80% statements, 70% branches | ✅ Yes |
| Integration Tests | Critical paths 100% | ✅ Yes |
| Contract Tests | All endpoints | ✅ Yes |
| E2E Tests | Happy paths | ✅ Yes |
| Load Tests | P95 < 500ms | ⚠️ Warning |

### 2.5 ESLint Profile Exception (APPROVED)

**Status**: ✅ APPROVED (2024-12-16)
**Scope**: Test files only (`tests/**/*.ts`)
**Production code**: Remains at FULL strictness

#### Rationale

Vitest/Jest mocking patterns require type flexibility that conflicts with strict TypeScript-ESLint rules. This is an industry-standard practice adopted by major TypeScript projects.

#### Rules Relaxed for Test Files Only

| Rule | Production | Tests | Justification |
|------|------------|-------|---------------|
| `@typescript-eslint/no-unsafe-call` | error | off | Vitest mocks (`vi.fn()`) return `any`; calling them triggers this rule |
| `@typescript-eslint/no-unsafe-assignment` | error | off | Assigning mock return values involves `any` |
| `@typescript-eslint/no-unsafe-member-access` | error | off | Accessing properties on mock objects |
| `@typescript-eslint/no-unsafe-argument` | error | off | Passing mock values to functions |
| `@typescript-eslint/no-unsafe-return` | error | off | Mock implementations returning fixtures |
| `@typescript-eslint/require-await` | error | off | Test helpers may be async for consistency |
| `@typescript-eslint/no-unused-vars` | error | warn | Test variables used in assertions |
| `@typescript-eslint/no-explicit-any` | error | off | Test fixtures need `any` for flexibility |
| `@typescript-eslint/no-non-null-assertion` | error | off | Test assertions use `!` for brevity |
| `no-console` | warn | off | Debug logging in tests is acceptable |

#### Implementation

```javascript
// .eslintrc.cjs - overrides section
overrides: [
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
],
```

#### Guarantee

**`src/**` MUST remain at ZERO lint errors.** This exception applies ONLY to `tests/**/*.ts`.

---

## 3. BACKEND HARDENING WORKFLOW

### 3.1 Hardening Phases

```
┌─────────────────────────────────────────────────────────────────┐
│                    HARDENING WORKFLOW                           │
└─────────────────────────────────────────────────────────────────┘

Phase 1: Foundation          Phase 2: Services          Phase 3: Tools
────────────────────         ──────────────────         ─────────────

┌──────────────┐             ┌──────────────┐           ┌──────────────┐
│ CI/CD Setup  │             │ AuthService  │           │ Local Tools  │
│ Test Infra   │ ──────────▶ │ ChatService  │ ────────▶ │ MCP Client   │
│ DB Migrations│             │ MemoryService│           │ Workflow     │
└──────────────┘             │ ToolService  │           │ Client       │
                             └──────────────┘           └──────────────┘
       │                            │                          │
       ▼                            ▼                          ▼
  Gate: CI passes             Gate: 80% coverage         Gate: E2E passes
  Gate: Migrations work       Gate: Integration          Gate: Load tests
                              tests pass

Phase 4: API                 Phase 5: Orchestrator      Phase 6: Hardening
────────────────             ────────────────────       ─────────────────

┌──────────────┐             ┌──────────────┐           ┌──────────────┐
│ Core API     │             │ Prompt       │           │ Error        │
│ Admin API    │ ──────────▶ │ Assembly     │ ────────▶ │ Recovery     │
│ Rate Limits  │             │ Tool Loop    │           │ Observability│
└──────────────┘             │ SSE Stream   │           │ Cost Alerts  │
                             └──────────────┘           └──────────────┘
       │                            │                          │
       ▼                            ▼                          ▼
  Gate: Contract tests        Gate: E2E chat           Gate: Production
  Gate: Auth verified         works end-to-end         ready checklist
```

### 3.2 Phase Details

#### Phase 1: Foundation (Week 1)

**Objective**: Establish CI/CD and test infrastructure

**NOTE**: Using Supabase Cloud instead of Docker (bandwidth optimization).

| Task | Deliverable | Gate |
|------|-------------|------|
| Set up pnpm project | `package.json` | Builds successfully |
| Configure TypeScript | `tsconfig.json` | No type errors |
| Configure ESLint + Prettier | `eslint.config.js`, `.prettierrc` | Lint passes |
| Set up Vitest | `vitest.config.ts` | Test runner works |
| Create GitHub Actions | `.github/workflows/ci.yml` | CI runs on PR |
| Configure Supabase Cloud | `.env.test`, connection verified | DB accessible |
| Create initial migrations | `supabase/migrations/` | Migrations apply |
| Create test structure | `tests/` directories | Empty tests pass |

**Exit Criteria**:
- [ ] `pnpm install` succeeds
- [ ] `pnpm lint` passes with 0 errors
- [ ] `pnpm typecheck` passes with 0 errors
- [ ] `pnpm test` runs (empty suite passes)
- [ ] CI pipeline runs on GitHub PR
- [ ] Supabase Cloud test project accessible
- [ ] Migrations apply to Supabase
- [ ] Empty test files exist for all services

#### Phase 2: Service Layer (Week 2-3)

**Objective**: Implement and test all services from Stage 2

| Service | Unit Tests | Integration Tests |
|---------|------------|-------------------|
| AuthService | Permission resolution, token validation | DB queries |
| UserService | Profile CRUD, preferences | DB queries |
| ChatService | Create, list, messages | DB queries, RLS |
| MemoryService | CRUD, search | pgvector search |
| KnowledgeService | CRUD, versioning, publish | Embedding queue |
| ToolService | Registry, permission checks | DB + Redis |
| SubscriptionService | Plans, usage, entitlements | DB queries |
| AuditService | Logging, querying | DB writes |
| PromptService | CRUD, activation | DB + versioning |
| ContextService | Build context, persist | Multiple services |

**Exit Criteria**:
- [ ] All services have 80%+ unit test coverage
- [ ] All services have integration tests
- [ ] Service-to-service calls work correctly
- [ ] Error handling is consistent (Result pattern)

#### Phase 3: Tool Execution (Week 4)

**Objective**: Implement tool executor and handlers

| Component | Unit Tests | Integration Tests |
|-----------|------------|-------------------|
| ToolExecutorFactory | Routing logic | Full execution |
| LocalToolExecutor | Each handler | With timeouts |
| MCPClientManager | Connection management | With test server |
| WorkflowClient | Invocation, retry | With mock n8n |
| BackgroundWorker | Job processing | With QStash mock |
| Cost estimation | Calculation logic | With real tools |

**Exit Criteria**:
- [ ] Calculator tool works end-to-end
- [ ] DateTime tool works end-to-end
- [ ] MCP client connects to test server
- [ ] Workflow client handles timeout/retry
- [ ] Cost tracking records correctly

#### Phase 4: API Layer (Week 5)

**Objective**: Implement all API endpoints from Stage 3a/3b

| Endpoint Group | Contract Tests | Auth Tests |
|----------------|----------------|------------|
| Health | Response format | Public access |
| Chat | CRUD + messages | Owner only |
| User | Profile, preferences | Self only |
| Memory | CRUD + search | Owner only |
| Knowledge | CRUD + publish | Owner + admin |
| Tools | List, details | Based on permissions |
| Subscription | Read usage | Self only |
| Admin | All admin endpoints | Admin role |

**Exit Criteria**:
- [ ] All endpoints have contract tests
- [ ] Auth middleware tested for all routes
- [ ] Rate limiting works
- [ ] Error responses are consistent
- [ ] Pagination works correctly

#### Phase 5: Orchestrator (Week 6)

**Objective**: Integrate AI orchestrator with all components

| Component | Tests |
|-----------|-------|
| Prompt assembly | Layer ordering, token limits |
| LLM client | Mock responses, streaming |
| Tool loop | Call, result, continue |
| Memory extraction | Structured + fallback |
| SSE streaming | Event format, error handling |
| Cost tracking | Full request cost |

**Exit Criteria**:
- [ ] Chat with AI works end-to-end
- [ ] Tool calls execute and return
- [ ] SSE stream delivers events correctly
- [ ] Memory suggestions are extracted
- [ ] Usage is recorded correctly

#### Phase 6: Hardening (Week 7-8)

**Objective**: Production readiness

| Area | Checklist |
|------|-----------|
| Error Recovery | Graceful degradation, retry logic |
| Observability | Logging, metrics, tracing |
| Cost Controls | Alerts, budget enforcement |
| Security | Input validation, output sanitization |
| Performance | Load tests pass, P95 < 500ms |

**Exit Criteria**:
- [ ] Production readiness checklist complete
- [ ] Load tests pass
- [ ] Error scenarios handled gracefully
- [ ] Monitoring dashboards ready
- [ ] Runbook documented

---

## 4. TEST GATES PER STAGE

### 4.1 Gate Matrix

| Design Stage | Required Test Types | Coverage | Blocking |
|--------------|---------------------|----------|----------|
| Stage 1: Database | Migration tests, RLS tests | 100% migrations | ✅ |
| Stage 2: Services | Unit + Integration | 80% unit, critical paths | ✅ |
| Stage 3a: Minimal API | Contract tests | All endpoints | ✅ |
| Stage 3b: Expand API | Contract + Auth tests | All endpoints | ✅ |
| Stage 4: Orchestrator | Integration + E2E | Chat flow works | ✅ |
| Stage 5: Tools | Unit + Integration + E2E | All tools work | ✅ |

### 4.2 Stage 1 Gates (Database)

```yaml
gate_stage_1:
  migrations:
    - All migrations apply cleanly
    - Migrations are idempotent (can re-run)
    - Rollback works

  rls:
    - RLS policies exist for all tables
    - User can only read own data
    - Admin can read all data
    - Anonymous has no access

  schema:
    - All constraints enforced
    - Foreign keys work
    - Indexes exist for query patterns
```

### 4.3 Stage 2 Gates (Services)

```yaml
gate_stage_2:
  unit_tests:
    coverage: 80%
    all_pass: true

  integration_tests:
    all_pass: true
    includes:
      - CRUD operations
      - Permission checks
      - Error handling
      - Transaction rollback

  result_pattern:
    - All services return Result<T, E>
    - No thrown exceptions in happy path
    - Error codes are consistent
```

### 4.4 Stage 3a/3b Gates (API)

```yaml
gate_stage_3:
  contract_tests:
    all_endpoints_covered: true
    all_pass: true

  auth_tests:
    - Unauthenticated returns 401
    - Wrong user returns 403
    - Admin routes require admin

  validation_tests:
    - Invalid input returns 400
    - Missing required fields caught
    - Type coercion handled

  response_format:
    - Success has data + meta
    - Error has error object
    - Pagination works correctly
```

### 4.5 Stage 4 Gates (Orchestrator)

```yaml
gate_stage_4:
  prompt_assembly:
    - 5 layers in correct order
    - Token limits respected
    - Tool instructions included

  tool_loop:
    - Tools execute correctly
    - Results return to LLM
    - Max iterations enforced

  streaming:
    - SSE events in correct format
    - Error events sent
    - Done event sent

  e2e:
    - Full chat works
    - Tool use works
    - Memory extraction works
```

### 4.6 Stage 5 Gates (Tools)

```yaml
gate_stage_5:
  local_tools:
    - Calculator correct results
    - DateTime handles timezones
    - Deep reasoning calls model

  mcp_tools:
    - Connection established
    - Tools listed correctly
    - Execution works with timeout

  workflow_tools:
    - Webhook invocation works
    - Retry logic works
    - Idempotency enforced

  cost_tracking:
    - Estimation before execution
    - Recording after execution
    - Budget blocking works
```

---

## 5. IMPLEMENTATION ORDER

### 5.1 Proposed Order

```
Week 1: Foundation
├── Day 1-2: Project setup, CI/CD
├── Day 3-4: Test infrastructure
└── Day 5: Database migrations

Week 2-3: Service Layer
├── Days 1-3: Auth, User, Chat services
├── Days 4-6: Memory, Knowledge services
├── Days 7-8: Tool, Subscription services
└── Days 9-10: Audit, Prompt, Context services

Week 4: Tool Execution
├── Days 1-2: Local tool handlers
├── Days 3-4: MCP client
└── Days 5: Workflow client

Week 5: API Layer
├── Days 1-2: Core endpoints
├── Days 3-4: Admin endpoints
└── Day 5: Rate limiting, middleware

Week 6: Orchestrator
├── Days 1-2: Prompt assembly
├── Days 3-4: Tool loop
└── Day 5: SSE streaming

Week 7-8: Hardening
├── Days 1-3: Error handling, recovery
├── Days 4-6: Observability, monitoring
└── Days 7-10: Load testing, optimization
```

### 5.2 Milestone Checkpoints

| Milestone | Week | Deliverable |
|-----------|------|-------------|
| M1: CI/CD Ready | 1 | Pipeline runs, tests execute |
| M2: Services Ready | 3 | All services tested |
| M3: Tools Ready | 4 | All tools execute |
| M4: API Ready | 5 | All endpoints work |
| M5: AI Ready | 6 | Chat with AI works |
| M6: Production Ready | 8 | Hardening complete |

---

## 6. ASSUMPTIONS & DEPENDENCIES

### 6.1 Assumptions

1. GitHub Actions as CI/CD platform
2. Vercel for deployments
3. Supabase provides local dev container
4. Upstash provides test Redis
5. pnpm as package manager
6. Vitest as test runner

### 6.2 External Dependencies

| Dependency | Purpose | Mocked in Tests |
|------------|---------|-----------------|
| Supabase | Database, Auth | Container |
| Upstash Redis | Rate limiting, cache | Container |
| Upstash QStash | Background jobs | MSW mock |
| Anthropic API | LLM calls | MSW mock |
| Brave Search | Web search | MSW mock |
| n8n | Workflows | MSW mock |

---

## 7. OPEN QUESTIONS

1. **Supabase Local Dev**: Use Docker or Supabase CLI?
2. **Test Parallelization**: Run integration tests in parallel?
3. **Load Test Environment**: Separate from preview?
4. **Secrets Rotation**: How often for API keys?

---

**AWAITING APPROVAL BEFORE IMPLEMENTATION**
