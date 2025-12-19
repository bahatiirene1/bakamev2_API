-- Migration: 007_subscription_domain.sql
-- Purpose: Create plans, subscriptions, and usage_records tables for SubscriptionService
-- Reference: docs/stage-2-service-layer.md Section 3.8
--
-- SCOPE: Billing, plans, and entitlement enforcement
--
-- Policy Enforcement: File storage quotas (Stage 1 Section 9.5)
-- - max_file_size_mb, total_storage_mb, api_calls_per_month
-- - Limits come from entitlements in plan, not hardcoded
--
-- GUARDRAILS:
-- - Only SYSTEM_ACTOR can create/modify subscriptions (payment webhooks)
-- - Users can only access their own subscription
-- - AI_ACTOR cannot modify subscriptions
-- - Admins can access any subscription
-- - Usage recording is idempotent (requestId/invocationId)

-- Plans table - defines what features a subscription includes
CREATE TABLE IF NOT EXISTS plans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    entitlements    JSONB NOT NULL DEFAULT '[]',
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscriptions table - user's active subscription
CREATE TABLE IF NOT EXISTS subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id                 UUID NOT NULL REFERENCES plans(id),
    status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'expired')),
    current_period_start    TIMESTAMPTZ NOT NULL,
    current_period_end      TIMESTAMPTZ NOT NULL,
    external_id             TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usage records table - tracks usage for metered features
CREATE TABLE IF NOT EXISTS usage_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_code    TEXT NOT NULL,
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    request_id      TEXT,
    invocation_id   TEXT,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint for idempotent usage recording
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_records_idempotency
    ON usage_records(user_id, feature_code, request_id)
    WHERE request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_records_invocation_idempotency
    ON usage_records(user_id, feature_code, invocation_id)
    WHERE invocation_id IS NOT NULL;

-- Indexes for plans
CREATE INDEX IF NOT EXISTS idx_plans_active ON plans(is_active) WHERE is_active = true;

-- Indexes for subscriptions
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_subscriptions_external_id ON subscriptions(external_id) WHERE external_id IS NOT NULL;

-- Indexes for usage records
CREATE INDEX IF NOT EXISTS idx_usage_records_user ON usage_records(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_user_feature ON usage_records(user_id, feature_code);
CREATE INDEX IF NOT EXISTS idx_usage_records_user_period ON usage_records(user_id, recorded_at);

-- Auto-update timestamps for plans
DROP TRIGGER IF EXISTS plans_updated_at ON plans;
CREATE TRIGGER plans_updated_at
    BEFORE UPDATE ON plans
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Auto-update timestamps for subscriptions
DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- RLS Policies
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;

-- Plans: everyone can read active plans (public pricing page)
CREATE POLICY plans_read_all ON plans
    FOR SELECT
    USING (is_active = true);

-- Plans: only service role can modify (system operations)
CREATE POLICY plans_service_role ON plans
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Subscriptions: read own or with subscription:manage permission
CREATE POLICY subscriptions_read_own ON subscriptions
    FOR SELECT
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'subscription:manage'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Subscriptions: only service role can insert/update/delete (webhook handlers)
CREATE POLICY subscriptions_service_role ON subscriptions
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Usage records: read own or with subscription:manage permission
CREATE POLICY usage_records_read_own ON usage_records
    FOR SELECT
    USING (
        user_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN role_permissions rp ON ur.role_id = rp.role_id
            JOIN permissions p ON rp.permission_id = p.id
            WHERE ur.user_id = auth.uid()::TEXT
            AND p.code = 'subscription:manage'
            AND (ur.expires_at IS NULL OR ur.expires_at > now())
        )
    );

-- Usage records: users can insert their own (via service layer validation)
CREATE POLICY usage_records_insert_own ON usage_records
    FOR INSERT
    WITH CHECK (user_id = auth.uid()::TEXT);

-- Usage records: service role can do all operations
CREATE POLICY usage_records_service_role ON usage_records
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Seed default plans
INSERT INTO plans (id, name, description, is_active, entitlements, metadata)
VALUES
    (
        'a0000000-0000-0000-0000-000000000001',
        'Free',
        'Basic free tier',
        true,
        '[
            {"featureCode": "max_file_size_mb", "value": {"limit": 10}},
            {"featureCode": "total_storage_mb", "value": {"limit": 100}},
            {"featureCode": "api_calls_per_month", "value": {"limit": 100}}
        ]'::jsonb,
        '{}'::jsonb
    ),
    (
        'a0000000-0000-0000-0000-000000000002',
        'Pro',
        'Professional tier with advanced features',
        true,
        '[
            {"featureCode": "max_file_size_mb", "value": {"limit": 100}},
            {"featureCode": "total_storage_mb", "value": {"limit": 10000}},
            {"featureCode": "api_calls_per_month", "value": {"limit": 10000}},
            {"featureCode": "priority_support", "value": {"enabled": true}}
        ]'::jsonb,
        '{}'::jsonb
    ),
    (
        'a0000000-0000-0000-0000-000000000003',
        'Enterprise',
        'Enterprise tier with unlimited features',
        true,
        '[
            {"featureCode": "max_file_size_mb", "value": {"limit": 500}},
            {"featureCode": "total_storage_mb", "value": {"limit": 100000}},
            {"featureCode": "api_calls_per_month", "value": {"limit": 100000}},
            {"featureCode": "priority_support", "value": {"enabled": true}},
            {"featureCode": "dedicated_support", "value": {"enabled": true}},
            {"featureCode": "custom_integrations", "value": {"enabled": true}}
        ]'::jsonb,
        '{}'::jsonb
    )
ON CONFLICT (name) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE plans IS 'Subscription plans defining feature entitlements';
COMMENT ON COLUMN plans.entitlements IS 'JSON array of {featureCode, value} objects defining limits and features';
COMMENT ON TABLE subscriptions IS 'User subscriptions linking to plans with billing periods';
COMMENT ON COLUMN subscriptions.status IS 'Subscription status: active, canceled, past_due, expired';
COMMENT ON COLUMN subscriptions.external_id IS 'External payment provider subscription ID (e.g., Stripe sub_xxx)';
COMMENT ON TABLE usage_records IS 'Metered usage records for quota tracking';
COMMENT ON COLUMN usage_records.request_id IS 'Request ID for idempotent recording';
COMMENT ON COLUMN usage_records.invocation_id IS 'Invocation ID for idempotent recording';
