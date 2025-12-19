# Bakame AI Backend - Deployment & Setup Guide

This guide covers complete setup, deployment, and operational procedures for the Bakame AI Backend.

## Table of Contents

1. [Development Setup](#1-development-setup)
2. [Environment Variables](#2-environment-variables)
3. [Database Setup](#3-database-setup)
4. [Testing](#4-testing)
5. [Production Deployment](#5-production-deployment)
6. [Monitoring & Logging](#6-monitoring--logging)
7. [Security Considerations](#7-security-considerations)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Development Setup

### Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| Node.js | >= 20.0.0 | Required for ES modules support |
| pnpm | >= 8.0.0 | Package manager (v9.14.4 recommended) |
| Docker | Latest | For local database testing |
| Git | Latest | Version control |
| Supabase CLI | >= 2.9.0 | Database migrations |

### Install Prerequisites

```bash
# Install Node.js 20+ (using nvm)
nvm install 20
nvm use 20

# Install pnpm
npm install -g pnpm@9.14.4

# Install Supabase CLI
npm install -g supabase

# Verify installations
node --version    # Should be >= 20.0.0
pnpm --version    # Should be >= 8.0.0
supabase --version
```

### Clone and Install

```bash
# Clone the repository
git clone <repository-url> bakamev2
cd bakamev2

# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env
```

### Running Locally

```bash
# Development mode with hot reload
pnpm dev

# Type checking
pnpm typecheck

# Linting
pnpm lint
pnpm lint:fix

# Formatting
pnpm format
pnpm format:check
```

The development server starts on `http://localhost:3000` by default.

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development server with hot reload |
| `pnpm build` | Build TypeScript to JavaScript |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix ESLint issues |
| `pnpm format` | Format code with Prettier |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |

---

## 2. Environment Variables

### Complete Environment Configuration

Create a `.env` file in the project root with the following variables:

```bash
# =============================================================================
# SUPABASE (Required)
# =============================================================================
# Get these from: https://app.supabase.com/project/<project-id>/settings/api
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key
SUPABASE_PROJECT_ID=your-project-id

# =============================================================================
# UPSTASH REDIS (Required for caching)
# =============================================================================
# Get these from: https://console.upstash.com/redis
UPSTASH_REDIS_URL=https://your-redis.upstash.io
UPSTASH_REDIS_TOKEN=your-redis-token

# =============================================================================
# UPSTASH QSTASH (Required for background jobs)
# =============================================================================
# Get these from: https://console.upstash.com/qstash
QSTASH_URL=https://qstash.upstash.io
QSTASH_TOKEN=your-qstash-token
QSTASH_CURRENT_SIGNING_KEY=your-current-signing-key
QSTASH_NEXT_SIGNING_KEY=your-next-signing-key

# =============================================================================
# OPENROUTER (Required for AI)
# =============================================================================
# Get this from: https://openrouter.ai/keys
OPENROUTER_API_KEY=your-openrouter-api-key
# Default model (can be overridden per request)
OPENROUTER_DEFAULT_MODEL=anthropic/claude-3.5-sonnet

# =============================================================================
# N8N WORKFLOWS (Required for workflow execution)
# =============================================================================
N8N_BASE_URL=https://your-n8n-instance.n8n.cloud
N8N_API_KEY=your-n8n-api-key

# =============================================================================
# APPLICATION
# =============================================================================
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# =============================================================================
# SECURITY
# =============================================================================
JWT_SECRET=your-jwt-secret-min-32-chars
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Environment Variable Reference

| Variable | Required | Description | How to Obtain |
|----------|----------|-------------|---------------|
| `SUPABASE_URL` | Yes | Supabase project URL | Supabase Dashboard > Settings > API |
| `SUPABASE_ANON_KEY` | Yes | Public anonymous key | Supabase Dashboard > Settings > API |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key (admin) | Supabase Dashboard > Settings > API |
| `SUPABASE_PROJECT_ID` | Yes | Project identifier | Supabase Dashboard URL |
| `UPSTASH_REDIS_URL` | Yes | Redis REST API URL | Upstash Console > Redis > Details |
| `UPSTASH_REDIS_TOKEN` | Yes | Redis REST API token | Upstash Console > Redis > Details |
| `QSTASH_URL` | Yes | QStash API URL | Upstash Console > QStash |
| `QSTASH_TOKEN` | Yes | QStash API token | Upstash Console > QStash |
| `QSTASH_CURRENT_SIGNING_KEY` | Yes | Current webhook signing key | Upstash Console > QStash |
| `QSTASH_NEXT_SIGNING_KEY` | Yes | Next webhook signing key | Upstash Console > QStash |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key | OpenRouter Dashboard > Keys |
| `OPENROUTER_DEFAULT_MODEL` | No | Default AI model | OpenRouter model list |
| `N8N_BASE_URL` | Yes | N8N instance URL | Your N8N deployment |
| `N8N_API_KEY` | Yes | N8N API key | N8N Settings > API |
| `NODE_ENV` | No | Environment mode | `development`, `test`, `production` |
| `PORT` | No | Server port (default: 3000) | Any available port |
| `LOG_LEVEL` | No | Logging verbosity | `debug`, `info`, `warn`, `error` |
| `JWT_SECRET` | Yes | JWT signing secret | Generate: `openssl rand -hex 32` |
| `CORS_ORIGINS` | No | Allowed CORS origins | Comma-separated URLs |

### Test Environment

For testing, create `.env.test`:

```bash
# Database (Docker PostgreSQL)
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/bakame_test
SUPABASE_URL=http://localhost:54322
SUPABASE_ANON_KEY=test-anon-key
SUPABASE_SERVICE_KEY=test-service-key

# Redis (Docker)
UPSTASH_REDIS_URL=http://localhost:6380
UPSTASH_REDIS_TOKEN=test-token

# Test mode
NODE_ENV=test
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54322/bakame_test
```

---

## 3. Database Setup

### Supabase Project Creation

1. **Create a Supabase Account**
   - Go to [https://supabase.com](https://supabase.com)
   - Sign up or log in

2. **Create a New Project**
   - Click "New Project"
   - Choose organization and region (closest to your users)
   - Set a strong database password
   - Wait for project provisioning (~2 minutes)

3. **Enable Required Extensions**

Connect to your database via Supabase SQL Editor and run:

```sql
-- Enable pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Running Migrations

The project includes 14 migration files in `supabase/migrations/`:

| Migration | Purpose |
|-----------|---------|
| `001_auth_domain.sql` | Permissions, roles, role_permissions, user_roles |
| `002_audit_domain.sql` | Immutable audit_logs table |
| `003_user_domain.sql` | Users, profiles, ai_preferences |
| `004_chat_domain.sql` | Chat sessions and messages |
| `005_memory_domain.sql` | User memories and memory_vectors |
| `006_file_domain.sql` | File storage metadata |
| `007_subscription_domain.sql` | Plans, subscriptions, usage_records |
| `008_approval_domain.sql` | Approval workflows |
| `009_tool_domain.sql` | Tool definitions and invocations |
| `010_system_actors.sql` | System actor definitions |
| `011_knowledge_domain.sql` | Knowledge items and versions |
| `012_prompt_domain.sql` | System prompts |
| `013_rag_config_domain.sql` | RAG configuration |
| `014_knowledge_vectors.sql` | Knowledge embeddings with pgvector |

**Push migrations to Supabase:**

```bash
# Link to your Supabase project
supabase link --project-ref <your-project-id>

# Push migrations to remote database
pnpm db:migrate

# Or push to local Supabase instance
pnpm db:migrate:local

# Reset database (WARNING: destroys all data)
pnpm db:reset
```

**Generate TypeScript types:**

```bash
export SUPABASE_PROJECT_ID=your-project-id
pnpm db:types
```

### pgvector Setup for Embeddings

pgvector is automatically configured in migrations 005 and 014. The system uses:

- **Dimension**: 1536 (compatible with OpenAI text-embedding-3-small)
- **Index**: IVFFlat with cosine similarity
- **Tables**: `memory_vectors`, `knowledge_vectors`

```sql
-- Verify pgvector is enabled
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Check vector indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE indexdef LIKE '%vector%';
```

**Search functions are pre-created:**

```sql
-- Search knowledge by semantic similarity
SELECT * FROM search_knowledge_vectors(
    query_embedding := '[0.1, 0.2, ...]'::vector(1536),
    match_threshold := 0.7,
    match_count := 5,
    filter_categories := ARRAY['category1', 'category2']
);

-- Search user memories by semantic similarity
SELECT * FROM search_memory_vectors(
    p_user_id := 'user-id',
    query_embedding := '[0.1, 0.2, ...]'::vector(1536),
    match_threshold := 0.7,
    match_count := 10
);
```

### Seeded Data

Migrations automatically seed:

**Default Roles:**
- `user` - Standard user
- `editor` - Content editor
- `reviewer` - Content reviewer
- `admin` - Administrator
- `auditor` - Audit log viewer
- `super_admin` - Full access

**Default Plans:**
- `Free` - 10MB max file, 100MB storage, 100 API calls/month
- `Pro` - 100MB max file, 10GB storage, 10,000 API calls/month
- `Enterprise` - 500MB max file, 100GB storage, 100,000 API calls/month

**Default Permissions:**
- `chat:read`, `chat:write`
- `memory:read`, `memory:write`, `memory:delete`
- `knowledge:read`, `knowledge:write`, `knowledge:publish`, `knowledge:review`
- `prompt:read`, `prompt:write`, `prompt:activate`, `prompt:review`
- `tool:invoke`, `tool:manage`
- `user:read`, `user:manage`, `user:update`
- `role:assign`
- `audit:read`
- `billing:manage`

### Local Database with Docker

For local development and testing:

```bash
# Start PostgreSQL and Redis containers
pnpm docker:test:up

# Initialize test database with migrations
pnpm docker:test:init

# Stop and remove containers
pnpm docker:test:down
```

**Docker Compose configuration** (`docker-compose.test.yml`):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: bakame-test-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: bakame_test
    ports:
      - "54322:5432"
    volumes:
      - postgres_test_data:/var/lib/postgresql/data
      - ./supabase/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: bakame-test-redis
    ports:
      - "6380:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_test_data:
```

---

## 4. Testing

### Test Structure

```
tests/
├── contracts/          # API contract tests
│   └── api.contract.test.ts
├── e2e/                # End-to-end tests
│   ├── failure-resilience.e2e.test.ts
│   ├── full-chat-flow.e2e.test.ts
│   ├── knowledge-publish.e2e.test.ts
│   ├── load-stress.e2e.test.ts
│   ├── subscription-enforcement.e2e.test.ts
│   └── user-lifecycle.e2e.test.ts
├── fixtures/           # Test data fixtures
├── helpers/            # Test utilities
│   └── setup.ts        # Global test setup
├── integration/        # Integration tests
│   └── chat-flow.test.ts
├── mocks/              # Mock implementations
└── unit/               # Unit tests
    ├── api/
    ├── orchestrator/
    ├── services/
    └── tools/
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with coverage report
pnpm test:coverage

# Run specific test suites
pnpm test:unit         # Unit tests only
pnpm test:integration  # Integration tests only
pnpm test:contract     # Contract tests only
pnpm test:e2e          # All E2E tests

# E2E tests by category
pnpm test:e2e:mock     # Mock-based E2E (no DB required)
pnpm test:e2e:db       # Database-backed E2E (requires Docker)
```

### Test Configuration

Tests use Vitest with the following configuration (`vitest.config.ts`):

```typescript
{
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        global: {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
}
```

### Coverage Thresholds

The project enforces **80% coverage** across all metrics:
- Statements: 80%
- Branches: 80%
- Functions: 80%
- Lines: 80%

View coverage report after running:

```bash
pnpm test:coverage
# Report generated in ./coverage/
open coverage/index.html
```

### Database-Backed E2E Tests

```bash
# 1. Start test infrastructure
pnpm docker:test:up

# 2. Initialize database with migrations
pnpm docker:test:init

# 3. Run database E2E tests
pnpm test:e2e:db

# 4. Cleanup
pnpm docker:test:down
```

---

## 5. Production Deployment

### Build Process

```bash
# Install production dependencies
pnpm install --prod

# Build TypeScript
pnpm build

# Output is in ./dist/
```

### Environment Configuration

Production environment checklist:

```bash
# Required for production
NODE_ENV=production
PORT=3000

# Security (generate strong values)
JWT_SECRET=$(openssl rand -hex 32)

# CORS (restrict to your domain)
CORS_ORIGINS=https://your-app.com,https://api.your-app.com

# Logging
LOG_LEVEL=info

# All service keys (use production values)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
# ... etc
```

### Deployment Options

#### Option 1: Vercel (Recommended for Serverless)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Set environment variables
vercel env add SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
# ... add all required variables
```

Create `vercel.json`:

```json
{
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "installCommand": "pnpm install",
  "framework": null,
  "functions": {
    "dist/index.js": {
      "memory": 1024,
      "maxDuration": 30
    }
  }
}
```

#### Option 2: Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login and deploy
railway login
railway init
railway up

# Add environment variables via Railway dashboard
```

#### Option 3: Docker

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.14.4

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

RUN npm install -g pnpm@9.14.4

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

Build and run:

```bash
# Build image
docker build -t bakame-api .

# Run container
docker run -p 3000:3000 \
  -e SUPABASE_URL=... \
  -e SUPABASE_ANON_KEY=... \
  -e SUPABASE_SERVICE_KEY=... \
  bakame-api
```

### Health Checks

The API exposes health check endpoints:

```bash
# Basic health check
curl http://localhost:3000/health

# Response:
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "0.1.0"
}

# API health check (v1)
curl http://localhost:3000/api/v1/health

# Response:
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "v1"
}
```

Configure your deployment platform to use:
- **Health check endpoint**: `/health` or `/api/v1/health`
- **Expected status code**: 200
- **Check interval**: 30 seconds
- **Timeout**: 10 seconds

---

## 6. Monitoring & Logging

### Audit Logging

The system maintains immutable audit logs for all significant actions:

```sql
-- Audit log structure
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id        TEXT,           -- User ID
    actor_type      TEXT NOT NULL,  -- 'user', 'admin', 'system', 'ai'
    action          TEXT NOT NULL,  -- e.g., 'knowledge:publish'
    resource_type   TEXT NOT NULL,  -- e.g., 'knowledge_item'
    resource_id     TEXT,
    details         JSONB NOT NULL DEFAULT '{}',
    ip_address      INET,
    user_agent      TEXT,
    request_id      TEXT
);
```

Audit logs are:
- **Immutable**: Cannot be updated or deleted (enforced by triggers)
- **Indexed**: Optimized for time-based and actor-based queries
- **Protected**: Only users with `audit:read` permission can view

**Query audit logs:**

```sql
-- Recent actions by user
SELECT * FROM audit_logs
WHERE actor_id = 'user-123'
ORDER BY timestamp DESC
LIMIT 100;

-- Actions on a specific resource
SELECT * FROM audit_logs
WHERE resource_type = 'knowledge_item'
AND resource_id = 'item-456';

-- Actions by type in last 24 hours
SELECT action, COUNT(*)
FROM audit_logs
WHERE timestamp > now() - interval '24 hours'
GROUP BY action
ORDER BY count DESC;
```

### Request Logging

The API uses Hono's built-in logger middleware:

```typescript
app.use('*', logger());
```

Logs include:
- HTTP method and path
- Response status code
- Response time

### Error Tracking

Configure error tracking in production:

```typescript
// Example with Sentry
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
```

### Performance Monitoring

Key metrics to monitor:

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Response time (p95) | < 500ms | > 1000ms |
| Error rate | < 1% | > 5% |
| Database connections | < 80% pool | > 90% pool |
| Memory usage | < 80% | > 90% |
| CPU usage | < 70% | > 85% |

### Log Levels

Configure via `LOG_LEVEL` environment variable:

- `debug`: All logs (development)
- `info`: Info, warnings, errors (staging)
- `warn`: Warnings and errors
- `error`: Errors only (production)

---

## 7. Security Considerations

### API Key Management

1. **Never commit secrets to git**
   - Use `.env` files locally (in `.gitignore`)
   - Use environment variables in production
   - Rotate keys regularly

2. **Key hierarchy**
   - `SUPABASE_ANON_KEY`: Public, limited access
   - `SUPABASE_SERVICE_KEY`: Admin access, server-side only
   - Never expose service keys to clients

3. **Generate secure secrets**
   ```bash
   # Generate JWT secret
   openssl rand -hex 32

   # Generate API keys
   openssl rand -base64 32
   ```

### Row Level Security (RLS)

All tables have RLS enabled with appropriate policies:

```sql
-- Example: Users can only read their own data
CREATE POLICY users_read_own ON users
    FOR SELECT
    USING (id = auth.uid()::TEXT OR has_permission('user:read'));

-- Example: Audit logs are read-only for auditors
CREATE POLICY audit_logs_read_policy ON audit_logs
    FOR SELECT
    USING (has_permission('audit:read'));

-- Audit logs cannot be modified (triggers enforce this)
CREATE POLICY audit_logs_no_insert_policy ON audit_logs
    FOR INSERT
    WITH CHECK (false);
```

**Key RLS patterns:**
- Users read/write their own data
- Admins can access all data with appropriate permissions
- Service role bypasses RLS (use carefully)
- Published content is publicly readable

### Rate Limiting

Rate limiting is implemented using Upstash Redis:

```typescript
// Configuration
const DEFAULT_RATE_LIMIT_CONFIG = {
  limit: 100,    // requests
  window: 60,    // seconds (100 req/min)
};

// Headers returned
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705312200
```

**Rate limit response (429):**

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": {
      "retryAfter": 45,
      "limit": 100
    },
    "requestId": "req-123"
  }
}
```

### CORS Configuration

```typescript
app.use('*', cors({
  origin: allowedOrigins ?? ['http://localhost:3000'],
  credentials: true,
}));
```

**Production CORS:**

```bash
# Restrict to your domains
CORS_ORIGINS=https://your-app.com,https://api.your-app.com
```

### Authentication Flow

1. **Token-based authentication** via Supabase Auth
2. **Permission resolution** on each request
3. **Actor context** propagated through request lifecycle

```typescript
// Auth middleware flow
1. Extract JWT from Authorization header
2. Verify token with Supabase
3. Resolve user permissions from roles
4. Attach actor context to request
5. Continue to route handler
```

### Security Headers

Recommended headers for production:

```typescript
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});
```

---

## 8. Troubleshooting

### Common Issues and Solutions

#### Issue: Database connection failed

**Symptoms:**
```
Error: Connection refused to database
```

**Solutions:**
1. Verify `SUPABASE_URL` is correct
2. Check if Supabase project is active
3. Verify network connectivity
4. Check if IP is whitelisted in Supabase dashboard

```bash
# Test connection
curl $SUPABASE_URL/rest/v1/ -H "apikey: $SUPABASE_ANON_KEY"
```

#### Issue: Migration failed

**Symptoms:**
```
Error: relation "xyz" already exists
```

**Solutions:**
1. Check migration order (001 before 002, etc.)
2. Reset database if in development: `pnpm db:reset`
3. Check for conflicting manual schema changes

```bash
# View migration status
supabase db status

# Reset and reapply
supabase db reset
```

#### Issue: pgvector not working

**Symptoms:**
```
Error: type "vector" does not exist
```

**Solutions:**
1. Enable pgvector extension:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
2. Verify extension is enabled:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```

#### Issue: Rate limiting not working

**Symptoms:**
- No rate limit headers in response
- Rate limits not enforced

**Solutions:**
1. Verify Upstash Redis credentials
2. Check Redis connection:
   ```bash
   curl $UPSTASH_REDIS_URL -H "Authorization: Bearer $UPSTASH_REDIS_TOKEN"
   ```
3. Verify rate limit middleware is applied to routes

#### Issue: CORS errors

**Symptoms:**
```
Access-Control-Allow-Origin header missing
```

**Solutions:**
1. Add your domain to `CORS_ORIGINS`
2. Ensure credentials are handled properly
3. Check if preflight OPTIONS requests are allowed

```bash
# Test CORS
curl -X OPTIONS http://localhost:3000/api/v1/health \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: GET" -v
```

### Debug Mode

Enable debug logging:

```bash
# Set log level
LOG_LEVEL=debug pnpm dev

# Or in .env
LOG_LEVEL=debug
```

### Log Analysis

**Find errors:**
```bash
# Search logs for errors
grep -i "error" logs/app.log

# Find specific request
grep "req-123" logs/app.log
```

**Database query analysis:**
```sql
-- Enable query logging in Supabase
-- Dashboard > Database > Query Performance

-- Check slow queries
SELECT * FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;
```

### Health Check Debugging

```bash
# Basic health
curl -v http://localhost:3000/health

# API health
curl -v http://localhost:3000/api/v1/health

# Expected response
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "0.1.0"
}
```

### Container Debugging

```bash
# View container logs
docker logs bakame-test-db
docker logs bakame-test-redis

# Enter container shell
docker exec -it bakame-test-db psql -U postgres -d bakame_test

# Check container health
docker inspect bakame-test-db | grep -A 10 Health
```

### Test Debugging

```bash
# Run single test with verbose output
pnpm vitest run tests/unit/result.test.ts --reporter=verbose

# Debug test
pnpm vitest run tests/unit/result.test.ts --inspect-brk

# Run with console output
pnpm vitest run --reporter=verbose --no-threads
```

---

## Quick Reference

### Essential Commands

```bash
# Development
pnpm dev                    # Start dev server
pnpm build                  # Build for production
pnpm start                  # Start production server

# Database
pnpm db:migrate             # Push migrations
pnpm db:reset               # Reset database
pnpm db:types               # Generate TypeScript types

# Testing
pnpm test                   # Run all tests
pnpm test:coverage          # Run with coverage
pnpm docker:test:up         # Start test DB
pnpm docker:test:down       # Stop test DB

# Quality
pnpm lint                   # Check linting
pnpm typecheck              # Check types
pnpm format                 # Format code
```

### API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Basic health check |
| `/api/v1/health` | GET | No | API health check |
| `/api/v1/chats` | ALL | Yes | Chat operations |
| `/api/v1/users` | ALL | Yes | User operations |
| `/api/v1/memories` | ALL | Yes | Memory operations |
| `/api/v1/knowledge` | ALL | Yes | Knowledge operations |
| `/api/v1/tools` | ALL | Yes | Tool operations |
| `/api/v1/subscription` | ALL | Yes | Subscription operations |
| `/api/v1/admin/*` | ALL | Admin | Admin operations |

### Support

For issues and questions:
1. Check this documentation
2. Review error logs
3. Search existing issues
4. Create a new issue with:
   - Environment details
   - Steps to reproduce
   - Error messages
   - Relevant logs
