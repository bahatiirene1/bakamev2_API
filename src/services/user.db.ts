/**
 * UserService Database Adapter
 * Implements UserServiceDb interface using Supabase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.2
 *
 * SCOPE: Profiles, AI preferences, account status
 * NOT IN SCOPE: Roles, permissions, auth tokens, subscriptions
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type {
  User,
  UserStatus,
  Profile,
  ProfileUpdate,
  AIPreferences,
  AIPreferencesUpdate,
  ListUsersParams,
  PaginatedResult,
} from '@/types/index.js';

import type { UserServiceDb } from './user.service.js';

/**
 * Database row types
 */
interface UserRow {
  id: string;
  email: string;
  status: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ProfileRow {
  id: string;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  locale: string;
  created_at: string;
  updated_at: string;
}

interface AIPreferencesRow {
  id: string;
  user_id: string;
  response_length: string;
  formality: string;
  allow_memory: boolean;
  allow_web_search: boolean;
  custom_instructions: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Map database row to User entity
 */
function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    status: row.status as UserStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    deletedAt: row.deleted_at !== null ? new Date(row.deleted_at) : null,
  };
}

/**
 * Map database row to Profile entity
 */
function mapRowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    locale: row.locale,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to AIPreferences entity
 */
function mapRowToAIPreferences(row: AIPreferencesRow): AIPreferences {
  return {
    id: row.id,
    userId: row.user_id,
    responseLength: row.response_length as AIPreferences['responseLength'],
    formality: row.formality as AIPreferences['formality'],
    allowMemory: row.allow_memory,
    allowWebSearch: row.allow_web_search,
    customInstructions: row.custom_instructions,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Create UserServiceDb implementation using Supabase
 */
export function createUserServiceDb(supabase: SupabaseClient): UserServiceDb {
  return {
    /**
     * Get user by ID
     */
    async getUser(userId: string): Promise<User | null> {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null;
        }
        throw new Error(`Failed to get user: ${error.message}`);
      }

      return mapRowToUser(data as UserRow);
    },

    /**
     * Create a new user
     */
    async createUser(params: { id: string; email: string }): Promise<User> {
      const { data, error } = await supabase
        .from('users')
        .insert({
          id: params.id,
          email: params.email,
          status: 'active',
        })
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create user: ${error.message}`);
      }

      return mapRowToUser(data as UserRow);
    },

    /**
     * Update user status
     */
    async updateUserStatus(userId: string, status: UserStatus): Promise<User> {
      const updateData: Record<string, unknown> = { status };

      // Set deleted_at when status is 'deleted'
      if (status === 'deleted') {
        updateData.deleted_at = new Date().toISOString();
      } else {
        updateData.deleted_at = null;
      }

      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update user status: ${error.message}`);
      }

      return mapRowToUser(data as UserRow);
    },

    /**
     * Get profile by user ID
     */
    async getProfile(userId: string): Promise<Profile | null> {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Failed to get profile: ${error.message}`);
      }

      return mapRowToProfile(data as ProfileRow);
    },

    /**
     * Create a new profile with defaults
     */
    async createProfile(params: { userId: string }): Promise<Profile> {
      const { data, error } = await supabase
        .from('profiles')
        .insert({
          user_id: params.userId,
          timezone: 'UTC',
          locale: 'en',
        })
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create profile: ${error.message}`);
      }

      return mapRowToProfile(data as ProfileRow);
    },

    /**
     * Update profile
     */
    async updateProfile(
      userId: string,
      updates: ProfileUpdate
    ): Promise<Profile> {
      const updateData: Record<string, unknown> = {};

      if (updates.displayName !== undefined) {
        updateData.display_name = updates.displayName;
      }
      if (updates.avatarUrl !== undefined) {
        updateData.avatar_url = updates.avatarUrl;
      }
      if (updates.timezone !== undefined) {
        updateData.timezone = updates.timezone;
      }
      if (updates.locale !== undefined) {
        updateData.locale = updates.locale;
      }

      const { data, error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update profile: ${error.message}`);
      }

      return mapRowToProfile(data as ProfileRow);
    },

    /**
     * Get AI preferences by user ID
     */
    async getAIPreferences(userId: string): Promise<AIPreferences | null> {
      const { data, error } = await supabase
        .from('ai_preferences')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error !== null) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw new Error(`Failed to get AI preferences: ${error.message}`);
      }

      return mapRowToAIPreferences(data as AIPreferencesRow);
    },

    /**
     * Create AI preferences with defaults
     */
    async createAIPreferences(params: {
      userId: string;
    }): Promise<AIPreferences> {
      const { data, error } = await supabase
        .from('ai_preferences')
        .insert({
          user_id: params.userId,
          response_length: 'balanced',
          formality: 'neutral',
          allow_memory: true,
          allow_web_search: false,
        })
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to create AI preferences: ${error.message}`);
      }

      return mapRowToAIPreferences(data as AIPreferencesRow);
    },

    /**
     * Update AI preferences
     */
    async updateAIPreferences(
      userId: string,
      updates: AIPreferencesUpdate
    ): Promise<AIPreferences> {
      const updateData: Record<string, unknown> = {};

      if (updates.responseLength !== undefined) {
        updateData.response_length = updates.responseLength;
      }
      if (updates.formality !== undefined) {
        updateData.formality = updates.formality;
      }
      if (updates.allowMemory !== undefined) {
        updateData.allow_memory = updates.allowMemory;
      }
      if (updates.allowWebSearch !== undefined) {
        updateData.allow_web_search = updates.allowWebSearch;
      }
      if (updates.customInstructions !== undefined) {
        updateData.custom_instructions = updates.customInstructions;
      }

      const { data, error } = await supabase
        .from('ai_preferences')
        .update(updateData)
        .eq('user_id', userId)
        .select('*')
        .single();

      if (error !== null) {
        throw new Error(`Failed to update AI preferences: ${error.message}`);
      }

      return mapRowToAIPreferences(data as AIPreferencesRow);
    },

    /**
     * List users with pagination
     */
    async listUsers(params: ListUsersParams): Promise<PaginatedResult<User>> {
      let query = supabase
        .from('users')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      // Filter by status if provided
      if (params.status !== undefined) {
        query = query.eq('status', params.status);
      }

      // Apply cursor-based pagination
      if (params.cursor !== undefined) {
        query = query.lt('created_at', params.cursor);
      }

      // Fetch one more than limit to determine hasMore
      const limit = params.limit;
      query = query.limit(limit + 1);

      const { data, error } = await query;

      if (error !== null) {
        throw new Error(`Failed to list users: ${error.message}`);
      }

      const rows = (data ?? []) as UserRow[];
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit).map(mapRowToUser);

      const result: PaginatedResult<User> = { items, hasMore };
      const lastItem = items[items.length - 1];
      if (hasMore && lastItem !== undefined) {
        result.nextCursor = lastItem.createdAt.toISOString();
      }
      return result;
    },
  };
}
