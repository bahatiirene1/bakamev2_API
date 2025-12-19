#!/bin/bash
# Initialize test database with migrations
# Run this after docker compose up

set -e

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-54322}"
DB_USER="${DB_USER:-postgres}"
DB_PASSWORD="${DB_PASSWORD:-postgres}"
DB_NAME="${DB_NAME:-bakame_test}"

echo "Waiting for database to be ready..."
until PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c '\q' 2>/dev/null; do
  sleep 1
done
echo "Database is ready!"

echo "Running migrations..."
for migration in supabase/migrations/*.sql; do
  echo "Applying: $migration"
  PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$migration"
done

echo "Seeding test data..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME <<EOF
-- Seed minimal test data

-- System actors (from migration 010)
-- Already created by migration

-- Test subscription plans
INSERT INTO subscription_plans (code, name, description, price_monthly, price_yearly, status)
VALUES
  ('free', 'Free Plan', 'Basic features', 0, 0, 'active'),
  ('pro', 'Pro Plan', 'Advanced features', 1999, 19990, 'active'),
  ('enterprise', 'Enterprise', 'Full access', 9999, 99990, 'active')
ON CONFLICT (code) DO NOTHING;

-- Test plan features
INSERT INTO plan_features (plan_code, feature_code, feature_name, type, limit_value, enabled)
VALUES
  ('free', 'messages', 'Messages', 'metered', 50, true),
  ('free', 'web_search', 'Web Search', 'boolean', null, false),
  ('pro', 'messages', 'Messages', 'metered', 5000, true),
  ('pro', 'web_search', 'Web Search', 'boolean', null, true),
  ('enterprise', 'messages', 'Messages', 'metered', null, true),
  ('enterprise', 'web_search', 'Web Search', 'boolean', null, true)
ON CONFLICT DO NOTHING;

EOF

echo "Test database initialized successfully!"
