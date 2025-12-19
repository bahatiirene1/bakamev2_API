/**
 * Supabase Client Configuration
 * Provides authenticated and admin clients for database access
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('SUPABASE_URL is required');
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY;
  if (key === undefined || key === '') {
    throw new Error('SUPABASE_ANON_KEY is required');
  }
  return key;
}

function getSupabaseServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (key === undefined || key === '') {
    throw new Error('SUPABASE_SERVICE_KEY is required for admin client');
  }
  return key;
}

/**
 * Create a Supabase client with user authentication
 * Use this for user-facing operations that respect RLS
 */
export function createSupabaseClient(accessToken?: string): SupabaseClient {
  const options: Parameters<typeof createClient>[2] = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  };

  if (accessToken !== undefined && accessToken !== '') {
    options.global = {
      headers: { Authorization: `Bearer ${accessToken}` },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), options);
}

/**
 * Create a Supabase admin client that bypasses RLS
 * Use this ONLY for system operations that require elevated privileges
 * NEVER expose this to user-facing code
 */
export function createSupabaseAdmin(): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return createClient(getSupabaseUrl(), getSupabaseServiceKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
