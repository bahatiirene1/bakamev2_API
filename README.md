<![CDATA[<div align="center">

# 🤖 Bakame AI Backend

**Production-grade, Governed, Future-proof AI Platform**

[![CI](https://github.com/bahati-irene/bakamev2/actions/workflows/ci.yml/badge.svg)](https://github.com/bahati-irene/bakamev2/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js)](https://nodejs.org/)
[![Hono](https://img.shields.io/badge/Hono-4.6-E36002?logo=hono)](https://hono.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase)](https://supabase.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pnpm](https://img.shields.io/badge/pnpm-9.14-F69220?logo=pnpm)](https://pnpm.io/)

*An enterprise-ready AI backend with governance, audit trails, RAG capabilities, and pluggable tool execution*

[Features](#-features) • [Installation](#-installation) • [Architecture](#-architecture-overview) • [API Docs](#-api-documentation) • [Contributing](#-contributing)

</div>

---

## 📖 Overview

**Bakame AI** is a production-grade backend platform designed to power intelligent AI applications at scale. Built with a governance-first approach, it provides a robust foundation for AI orchestration while maintaining strict security boundaries, comprehensive audit trails, and enterprise compliance requirements.

### What Makes Bakame Different?

- **🏛️ Governance First**: Every action is auditable. Admins are users with permissions, never hard-coded actors.
- **🔒 Security by Design**: Row-Level Security (RLS), service-layer boundaries, AI never accesses the database directly.
- **🔄 Future-Proof Architecture**: Models, tools, and workflows are swappable. Designed to survive organizational growth.
- **🧠 Intelligent Orchestration**: Single AI orchestrator that coordinates tools, MCP servers, and n8n workflows.
- **📊 RAG-Ready**: Built-in knowledge base with vector embeddings, semantic search, and governed content approval.

---

## ✨ Features

### 💬 Chat & Conversation Management
- Multi-turn conversation handling with context preservation
- Message history with pagination
- Chat archiving and lifecycle management
- Real-time streaming via Server-Sent Events (SSE)

### 🧠 AI Orchestration
- Layered prompt architecture (immutable core, governed system prompts, user preferences)
- Tool selection and chaining capabilities
- Cost-aware model delegation via OpenRouter
- Support for multiple LLM providers

### 🛠️ Tool Execution Framework
- **Local Tools**: Built-in deterministic functions
- **MCP Integration**: Model Context Protocol server support
- **n8n Workflows**: Complex workflow orchestration for long-running tasks
- Tool invocation logging and cost tracking

### 📚 Knowledge Base & RAG
- Document ingestion with chunking strategies
- Vector embeddings via pgvector
- Semantic search with configurable similarity thresholds
- Content governance with approval workflows

### 🧬 Memory System
- Long-term user memory with vector references
- Explicit memory extraction (no silent inference)
- Memory importance scoring and decay
- Cross-conversation context

### 🔐 Authentication & Authorization
- Supabase Auth integration
- Role-Based Access Control (RBAC)
- Multiple admin roles (editor, reviewer, auditor, support)
- Permission-based feature gating

### 📝 Audit & Compliance
- Immutable audit logs for all privileged actions
- Request tracing across service boundaries
- Admin action tracking
- Compliance-ready logging

### 💳 Subscription & Entitlements
- Tiered subscription management
- Usage tracking and limits
- Feature entitlements per tier
- Quota enforcement

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Runtime** | [Vercel Serverless/Edge](https://vercel.com/) | API hosting & scaling |
| **Framework** | [Hono](https://hono.dev/) | Ultrafast web framework |
| **Language** | [TypeScript 5.7](https://www.typescriptlang.org/) | Type-safe development |
| **Database** | [Supabase (PostgreSQL)](https://supabase.com/) | Primary data store |
| **Auth** | [Supabase Auth](https://supabase.com/auth) | Authentication |
| **Vector Store** | [pgvector](https://github.com/pgvector/pgvector) | Embeddings & semantic search |
| **Cache** | [Upstash Redis](https://upstash.com/) | Rate limiting & state |
| **Queue** | [Upstash QStash](https://upstash.com/qstash) | Background jobs |
| **AI Models** | [OpenRouter](https://openrouter.ai/) | Multi-model access |
| **Workflows** | [n8n Cloud](https://n8n.io/) | Long-running automation |
| **Testing** | [Vitest](https://vitest.dev/) | Unit & integration tests |
| **Package Manager** | [pnpm](https://pnpm.io/) | Fast, disk-efficient |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT APPLICATIONS                             │
│                        (Flutter Web/Mobile, REST APIs)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               API LAYER (Hono)                               │
│                      ┌─────────────────────────────────┐                     │
│                      │    Auth Middleware │ Rate Limit │                     │
│                      └─────────────────────────────────┘                     │
│    /chats    /users    /memories    /knowledge    /tools    /admin          │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AI ORCHESTRATOR LAYER                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  Prompt Builder │  │   Tool Loop     │  │  Context Assembly           │  │
│  │  (Layered)      │  │  (Selection &   │  │  (Memory + RAG + Prefs)     │  │
│  │                 │  │   Execution)    │  │                             │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SERVICE LAYER                                     │
│                    (Domain Logic - Only Gateway to Data)                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │   Auth   │ │   User   │ │   Chat   │ │  Memory  │ │Knowledge │          │
│  │ Service  │ │ Service  │ │ Service  │ │ Service  │ │ Service  │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │   Tool   │ │Subscript.│ │  Audit   │ │ Approval │ │  Prompt  │          │
│  │ Service  │ │ Service  │ │ Service  │ │ Service  │ │ Service  │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                                     │
│  │ Context  │ │   File   │ │ RAGConf. │  ← All return Result<T>            │
│  │ Service  │ │ Service  │ │ Service  │                                     │
│  └──────────┘ └──────────┘ └──────────┘                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TOOL EXECUTION LAYER                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │  Local Tools    │  │  MCP Servers    │  │  n8n Workflows  │              │
│  │  (Deterministic)│  │  (External)     │  │  (Long-running) │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                        │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐           │
│  │     Supabase PostgreSQL     │  │      Upstash Redis          │           │
│  │  • Users & Profiles         │  │  • Rate Limiting            │           │
│  │  • Chats & Messages         │  │  • Session State            │           │
│  │  • Knowledge Base           │  │  • Conversation Locks       │           │
│  │  • Memory & Vectors         │  │                             │           │
│  │  • Audit Logs               │  └─────────────────────────────┘           │
│  │  • RLS Policies             │                                            │
│  └─────────────────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

1. **Backend-first design** - Database schema and governance define everything
2. **Service layer is the only gateway** - No direct database access from API or AI
3. **AI never talks to database directly** - Only through services
4. **Admins are users with permissions** - No hardcoded special actors
5. **All privileged actions are auditable** - No exceptions
6. **AI is orchestrator, not executor** - Tools execute, AI decides
7. **Tools are deterministic and stateless** - No hidden side effects
8. **Design for replacement** - Models, tools, workflows are swappable

---

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | >= 20.0.0 | LTS recommended |
| **pnpm** | >= 8.0.0 | Package manager |
| **Supabase Account** | - | [Sign up free](https://supabase.com/) |
| **OpenRouter API Key** | - | [Get API key](https://openrouter.ai/) |
| **Upstash Account** | - | [Sign up free](https://upstash.com/) (Redis + QStash) |

---

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/bahati-irene/bakamev2.git
cd bakamev2
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Environment Variables](#-environment-variables) section).

### 4. Set Up Database

Run the database migrations in your Supabase project:

1. Go to your Supabase Dashboard → SQL Editor
2. Execute each migration file in order from `supabase/migrations/`:
   - `001_auth_domain.sql`
   - `002_audit_domain.sql`
   - `003_user_domain.sql`
   - ... (continue through all migrations)

### 5. Start Development Server

```bash
pnpm dev
```

The server will start at `http://localhost:3000`.

---

## 🔐 Environment Variables

Create a `.env` file with the following variables:

### Supabase (Required)

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Public anonymous key |
| `SUPABASE_SERVICE_KEY` | Service role key (server-side only) |
| `SUPABASE_PROJECT_ID` | Project identifier |

### Upstash Redis (Required)

| Variable | Description |
|----------|-------------|
| `UPSTASH_REDIS_URL` | Redis REST URL |
| `UPSTASH_REDIS_TOKEN` | Redis authentication token |

### Upstash QStash (Required)

| Variable | Description |
|----------|-------------|
| `QSTASH_URL` | QStash API URL |
| `QSTASH_TOKEN` | QStash authentication token |
| `QSTASH_CURRENT_SIGNING_KEY` | Current webhook signing key |
| `QSTASH_NEXT_SIGNING_KEY` | Next webhook signing key (rotation) |

### OpenRouter (Required)

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key |
| `OPENROUTER_DEFAULT_MODEL` | Default model (e.g., `anthropic/claude-3.5-sonnet`) |

### n8n Workflows (Optional)

| Variable | Description |
|----------|-------------|
| `N8N_BASE_URL` | Your n8n instance URL |
| `N8N_API_KEY` | n8n API key |

### Application

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment (`development`, `production`, `test`) | `development` |
| `PORT` | Server port | `3000` |
| `LOG_LEVEL` | Logging level | `debug` |

### Security

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | JWT signing secret (min 32 chars) |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) |

---

## 🏃 Running the Project

### Development Mode

```bash
pnpm dev          # Start with hot reload
```

### Production Build

```bash
pnpm build        # Compile TypeScript
pnpm start        # Run compiled code
```

### Code Quality

```bash
pnpm lint         # Run ESLint
pnpm lint:fix     # Fix linting issues
pnpm format       # Format with Prettier
pnpm format:check # Check formatting
pnpm typecheck    # TypeScript type checking
```

### Testing

```bash
pnpm test              # Run all tests
pnpm test:watch        # Run tests in watch mode
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests only
pnpm test:contract     # API contract tests
pnpm test:e2e          # End-to-end tests
pnpm test:coverage     # Generate coverage report
```

---

## 📁 Project Structure

```
bakamev2/
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions CI pipeline
├── supabase/
│   └── migrations/             # Database migration files
│       ├── 001_auth_domain.sql
│       ├── 002_audit_domain.sql
│       ├── 003_user_domain.sql
│       ├── 004_chat_domain.sql
│       ├── 005_memory_domain.sql
│       ├── 006_file_domain.sql
│       ├── 007_subscription_domain.sql
│       ├── 008_approval_domain.sql
│       ├── 009_tool_domain.sql
│       ├── 010_system_actors.sql
│       ├── 011_knowledge_domain.sql
│       ├── 012_prompt_domain.sql
│       ├── 013_rag_config_domain.sql
│       └── 014_knowledge_vectors.sql
├── src/
│   ├── api/                    # API Layer
│   │   ├── routes/             # Route handlers
│   │   ├── middleware/         # Auth, rate limiting
│   │   ├── utils/              # API utilities
│   │   ├── app.ts              # Hono app configuration
│   │   └── types.ts            # API types
│   ├── services/               # Service Layer (Domain Logic)
│   │   ├── auth.service.ts     # Authentication
│   │   ├── user.service.ts     # User management
│   │   ├── chat.service.ts     # Chat operations
│   │   ├── memory.service.ts   # Long-term memory
│   │   ├── knowledge.service.ts # Knowledge base
│   │   ├── tool.service.ts     # Tool registry
│   │   ├── subscription.service.ts
│   │   ├── audit.service.ts    # Audit logging
│   │   ├── approval.service.ts # Approval workflows
│   │   ├── prompt.service.ts   # System prompts
│   │   ├── context.service.ts  # Context assembly
│   │   ├── file.service.ts     # File management
│   │   ├── embedding.service.ts # Vector embeddings
│   │   ├── rag-config.service.ts
│   │   └── *.db.ts             # Database adapters
│   ├── orchestrator/           # AI Orchestrator
│   │   ├── orchestrator.ts     # Main orchestrator
│   │   ├── prompt-builder.ts   # Layered prompts
│   │   ├── tool-loop.ts        # Tool execution loop
│   │   └── llm-client.ts       # LLM communication
│   ├── tools/                  # Tool Execution Layer
│   │   ├── executor.ts         # Unified executor
│   │   ├── local/              # Built-in tools
│   │   ├── mcp/                # MCP server integration
│   │   └── workflow/           # n8n workflows
│   ├── lib/                    # Shared Libraries
│   │   ├── supabase.ts         # Supabase client
│   │   └── redis.ts            # Redis client
│   ├── types/                  # TypeScript Types
│   │   ├── result.ts           # Result pattern
│   │   ├── auth.ts
│   │   ├── chat.ts
│   │   ├── memory.ts
│   │   └── ...
│   ├── workers/                # Background Workers
│   └── index.ts                # Application entry point
├── tests/
│   ├── unit/                   # Unit tests
│   │   ├── services/           # Service tests
│   │   ├── orchestrator/       # Orchestrator tests
│   │   ├── tools/              # Tool tests
│   │   └── api/                # API tests
│   ├── integration/            # Integration tests
│   ├── contracts/              # API contract tests
│   ├── e2e/                    # End-to-end tests
│   ├── fixtures/               # Test data
│   ├── mocks/                  # Mock implementations
│   └── helpers/                # Test utilities
├── docs/                       # Architecture Documentation
│   ├── architecture.md         # System architecture
│   ├── methodology.md          # Development methodology
│   ├── stage-1-database-governance.md
│   ├── stage-2-service-layer.md
│   ├── stage-3a-minimal-api.md
│   ├── stage-3b-expand-api.md
│   ├── stage-4-ai-orchestrator.md
│   ├── stage-5-tool-execution.md
│   └── backend-hardening-plan.md
├── coverage/                   # Test coverage reports
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
├── openapi.yaml                # OpenAPI specification
├── docker-compose.test.yml     # Test containers
└── claude.md                   # AI development instructions
```

---

## 🧪 Testing

Bakame follows a strict TDD (Test-Driven Development) methodology with comprehensive test coverage.

### Test Pyramid

```
        ┌─────────────────┐
        │    E2E Tests    │  ← Critical user flows
        │   (Minimal)     │
        └────────┬────────┘
                 │
        ┌────────┴────────┐
        │  Integration    │  ← Service + real DB
        │     Tests       │
        └────────┬────────┘
                 │
        ┌────────┴────────┐
        │   Unit Tests    │  ← Services & rules
        │   (Majority)    │
        └─────────────────┘
```

### Running Tests

```bash
# All tests
pnpm test

# Specific test types
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:e2e

# With coverage
pnpm test:coverage
```

### Coverage Requirements

- **Unit Tests**: 80% minimum coverage
- **Integration Tests**: Critical paths covered
- **Contract Tests**: All API endpoints
- **E2E Tests**: Happy paths

---

## 📚 API Documentation

The API follows RESTful conventions with consistent response formats.

### Base URL

```
/api/v1
```

### Response Format

**Success:**
```json
{
  "data": { ... },
  "meta": {
    "requestId": "req_abc123"
  }
}
```

**Error:**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "requestId": "req_abc123"
  }
}
```

### Available Endpoints

| Category | Endpoints | Description |
|----------|-----------|-------------|
| **Health** | `GET /health` | Service health check |
| **Chats** | `GET/POST /chats`, `GET/DELETE /chats/:id` | Chat management |
| **Messages** | `POST /chats/:id/messages`, `GET /chats/:id/messages` | Message operations |
| **Users** | `GET/PATCH /users/me`, `GET/PATCH /users/me/preferences` | User profile |
| **Memories** | `GET/POST/DELETE /memories` | Memory management |
| **Knowledge** | `GET/POST /knowledge`, `POST /knowledge/search` | Knowledge base |
| **Tools** | `GET /tools` | Available tools |
| **Subscription** | `GET /subscription`, `GET /subscription/usage` | Subscription info |
| **Admin** | `GET/POST/PATCH /admin/*` | Administrative functions |

### OpenAPI Specification

Full API documentation is available in `openapi.yaml`. Import into Swagger UI or Postman for interactive exploration.

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Development Workflow

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Write tests first** (TDD required)
4. **Implement** the feature
5. **Ensure** all tests pass (`pnpm test`)
6. **Run** linting (`pnpm lint`)
7. **Commit** your changes
8. **Push** to your branch
9. **Open** a Pull Request

### Code Standards

- All code must be TypeScript
- All service methods return `Result<T>` (never throw)
- All public APIs must have tests
- Follow existing code style (enforced by ESLint/Prettier)
- Keep PRs focused and small

### Commit Message Format

```
feat(service): add user preference update
fix(api): handle missing auth token gracefully
docs(readme): update installation instructions
test(chat): add message pagination tests
```

### CI Requirements

All PRs must pass:
- [ ] ESLint (0 errors)
- [ ] TypeScript (0 errors)
- [ ] Unit Tests (100% pass)
- [ ] Coverage (80% minimum)
- [ ] Integration Tests
- [ ] Security Audit

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

```
MIT License

Copyright (c) 2024 Bahati Irene

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 👤 Author

**Bahati Irene**

- GitHub: [@bahati-irene](https://github.com/bahati-irene)

---

## 🙏 Acknowledgments

- [Hono](https://hono.dev/) - Ultrafast web framework
- [Supabase](https://supabase.com/) - Open source Firebase alternative
- [OpenRouter](https://openrouter.ai/) - Unified LLM API access
- [Upstash](https://upstash.com/) - Serverless data platform
- [n8n](https://n8n.io/) - Workflow automation

---

<div align="center">

**Built with ❤️ for the AI-first future**

[⬆ Back to top](#-bakame-ai-backend)

</div>
]]>