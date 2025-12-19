# DEVELOPMENT METHODOLOGY, CI/CD & PLATFORM STACK

## Purpose
This document defines **how the system is built, tested, deployed, observed, and evolved**.

It complements the architecture by answering:
- *How do we work without breaking things?*
- *How do we scale as a solo founder → team?*
- *How do we ship safely across web, Android, iOS, tablets?*

The goal is **predictable velocity without architectural decay**.

---

## 1. Core Development Principles (Non-Negotiable)

1. **Architecture first, code second**
2. **Small changes, continuous shipping**
3. **Tests protect intent, not implementation**
4. **Observability before optimization**
5. **Platform > product** mindset

These principles guide all tooling choices.

---

## 2. Development Methodology (Founder-Optimized)

### Recommended Model: *Trunk-Based Development + Feature Flags*

Why:
- You are a founder (fast feedback)
- Avoid long-lived branches
- Enables CI/CD automation

### Workflow

```
main (always deployable)
  ↑
 short-lived feature branches
```

Rules:
- Feature branches live < 3 days
- Every merge requires:
  - Tests passing
  - Linting
  - Review (future-proof for team)

Feature flags (not branches) control rollout.

---

## 3. Test Strategy (TDD, Pragmatic Not Dogmatic)

### Test Pyramid (Strict)

```
E2E (few, critical paths)
Integration (services & DB)
Unit (services & rules)
```

### What You MUST Test

- Service layer rules
- Permission checks
- Governance workflows
- Tool invocation logic
- Orchestrator decision flow (mocked LLM)

### What You Do NOT Over-Test

- UI visuals
- Framework internals
- LLM text phrasing

> Tests protect **rules and boundaries**, not words.

---

## 4. CI Pipeline (Every Commit)

### Pipeline Stages

```
1. Install & cache deps
2. Static analysis (lint, types)
3. Unit tests
4. Integration tests
5. Build artifacts
```

Fail fast.
No deploy if tests fail.

---

## 5. CD Pipeline (Safe by Default)

### Deployment Strategy

- Auto-deploy main branch
- Preview environments for PRs
- Feature flags for risky changes

### Rollback Philosophy

- Roll forward preferred
- Rollback supported
- Infra must be immutable

---

## 6. Observability (From Day 1)

### Three Pillars

1. **Logs** – structured, searchable
2. **Metrics** – latency, error rates, cost
3. **Traces** – request → service → tool

### Mandatory Signals

- API latency per endpoint
- Tool execution time & failure rate
- LLM cost per request
- Memory writes per user
- Admin actions

If you can’t see it, you can’t scale it.

---

## 7. Error Handling Philosophy

- Fail loudly in logs
- Fail gracefully for users
- Never hide tool failures

Errors are *data*, not embarrassment.

---

## 8. Platform Stack (Founder-Optimized, Future-Proof)

### Frontend

**Flutter**
- One codebase
- Web, Android, iOS, tablets
- Predictable UI logic

Frontend rules:
- UI never owns business logic
- UI never talks to DB
- UI calls APIs only

---

### Backend Runtime

**Vercel (Serverless / Edge)**
- Fast iteration
- Preview environments
- Easy scaling

Used for:
- API layer
- Orchestrator runtime
- Lightweight services

---

### Database & Auth

**Supabase (Postgres + Auth)**

Why:
- Strong relational DB
- Row-level security
- Auth out of the box
- SQL-first (future-safe)

Rules:
- RLS mirrors service permissions
- Migrations are versioned
- No logic in triggers

---

### Cache & Queues

**Upstash Redis**

Use cases:
- Rate limiting
- Tool execution state
- Job coordination
- Conversation locks

Avoid:
- Storing business truth

---

### Workflow Engine

**n8n Cloud**

Use for:
- Long-running workflows
- External system orchestration
- Business automation

Treat n8n as:
- Execution engine
- Not decision-maker

---

### Vector Store

- Supabase pgvector (initial)
- Swappable later (Pinecone, Weaviate)

Service layer abstracts access.

---

## 9. Environment Strategy

```
local → preview → staging → production
```

Rules:
- Same infra, different config
- No prod-only logic
- Secrets managed centrally

---

## 10. Security & Secrets

- Secrets never in code
- Separate API keys per env
- Rotate keys regularly
- Least-privilege access

---

## 11. Documentation as a First-Class Asset

You must maintain:
- Architecture docs (this)
- ADRs (Architecture Decision Records)
- Service contracts

Docs are part of CI (lintable markdown).

---

## 12. Team Scaling Readiness

This setup supports:
- Solo founder
- Small team
- Multi-team org

Without re-architecture.

---

## 13. Anti-Patterns to Avoid

- Skipping tests to move fast
- Letting AI write DB logic
- UI-driven architecture
- Over-optimizing early
- "Just this once" permission bypass

---

## 14. Final Outcome

This methodology ensures:
- Predictable shipping
- Safe experimentation
- Low stress debugging
- Long-term survivability

---

## Status

This layer is **complete**.

Next step (when ready):
**Translate this into a repo structure + initial bootstrap checklist.**

