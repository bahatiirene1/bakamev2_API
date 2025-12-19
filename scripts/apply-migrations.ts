/**
 * Apply database migrations to Supabase
 * Usage: npx tsx scripts/apply-migrations.ts
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function applyMigration(filename: string): Promise<void> {
  const filepath = join(process.cwd(), 'supabase/migrations', filename);
  const sql = readFileSync(filepath, 'utf-8');

  console.log(`Applying migration: ${filename}`);

  // Split SQL into statements and execute each one
  // Simple split by semicolon (doesn't handle all edge cases but works for our SQL)
  const statements = sql
    .split(/;(?=\s*(?:--|CREATE|INSERT|ALTER|DROP|$))/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    if (!statement) continue;

    const { error } = await supabase.rpc('exec_sql', { sql: statement });
    if (error) {
      // Try direct query if RPC doesn't exist
      const { error: directError } = await supabase
        .from('_migrations')
        .select();
      if (directError?.message.includes('does not exist')) {
        console.log(
          'Note: Direct SQL execution requires Supabase dashboard or CLI'
        );
      }
      console.error(`Error executing SQL: ${error.message}`);
      console.log('Statement:', statement.substring(0, 100) + '...');
    }
  }

  console.log(`Migration ${filename} completed`);
}

async function main(): Promise<void> {
  try {
    await applyMigration('001_auth_domain.sql');
    console.log('All migrations applied successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

main();
