-- Migration: 010_system_actors.sql
-- Purpose: Create system-level users for AI_ACTOR and SYSTEM_ACTOR
-- Reference: TDD invariant - FK constraints must be satisfiable
--
-- This migration creates:
-- 1. 'system' user - For SYSTEM_ACTOR background jobs and triggers
-- 2. 'ai' user - For AI_ACTOR orchestrator-initiated actions
--
-- These users exist to satisfy FK constraints when system/AI actors
-- perform operations that reference users.id (e.g., tool_invocation_logs)
--
-- CRITICAL: These are NOT real users - they are system anchors

-- ============================================================================
-- SYSTEM ACTOR USER
-- ============================================================================
-- Used by SYSTEM_ACTOR for background jobs, triggers, and system operations

INSERT INTO users (id, email, status, created_at, updated_at)
VALUES (
    'system',
    'system@bakame.internal',
    'active',
    '1970-01-01 00:00:00+00',
    '1970-01-01 00:00:00+00'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- AI ACTOR USER
-- ============================================================================
-- Used by AI_ACTOR for orchestrator-initiated actions
-- AI has NO permissions - this user exists only to satisfy FK constraints

INSERT INTO users (id, email, status, created_at, updated_at)
VALUES (
    'ai',
    'ai@bakame.internal',
    'active',
    '1970-01-01 00:00:00+00',
    '1970-01-01 00:00:00+00'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE users IS
'User identities. Includes system-level actors (id=system, id=ai) for FK satisfaction.';
