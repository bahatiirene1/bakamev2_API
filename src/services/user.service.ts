/**
 * UserService Implementation
 * Phase 2: TDD - GREEN phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.2
 *
 * SCOPE: Profiles, AI preferences, account status
 * NOT IN SCOPE: Roles, permissions, auth tokens, subscriptions
 *
 * Dependencies: AuditService (for logging)
 *
 * GUARDRAILS:
 * - AI_ACTOR must not mutate user data
 * - All mutations must emit audit events
 * - Result pattern required (no thrown errors)
 * - Soft delete only
 */

import type {
  ActorContext,
  User,
  Profile,
  ProfileUpdate,
  AIPreferences,
  AIPreferencesUpdate,
  UserSignupParams,
  ListUsersParams,
  PaginatedResult,
  Result,
  AuditEvent,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Database abstraction interface for UserService
 */
export interface UserServiceDb {
  getUser: (userId: string) => Promise<User | null>;
  createUser: (params: { id: string; email: string }) => Promise<User>;
  updateUserStatus: (userId: string, status: User['status']) => Promise<User>;
  getProfile: (userId: string) => Promise<Profile | null>;
  createProfile: (params: { userId: string }) => Promise<Profile>;
  updateProfile: (userId: string, updates: ProfileUpdate) => Promise<Profile>;
  getAIPreferences: (userId: string) => Promise<AIPreferences | null>;
  createAIPreferences: (params: { userId: string }) => Promise<AIPreferences>;
  updateAIPreferences: (
    userId: string,
    updates: AIPreferencesUpdate
  ) => Promise<AIPreferences>;
  listUsers: (params: ListUsersParams) => Promise<PaginatedResult<User>>;
}

/**
 * Minimal AuditService interface (subset needed by UserService)
 */
export interface UserServiceAudit {
  log: (actor: ActorContext, event: AuditEvent) => Promise<Result<void>>;
}

/**
 * UserService interface
 */
export interface UserService {
  onUserSignup(
    actor: ActorContext,
    params: UserSignupParams
  ): Promise<Result<User>>;
  getUser(actor: ActorContext, userId: string): Promise<Result<User>>;
  suspendUser(
    actor: ActorContext,
    userId: string,
    reason: string
  ): Promise<Result<void>>;
  reactivateUser(actor: ActorContext, userId: string): Promise<Result<void>>;
  softDeleteUser(
    actor: ActorContext,
    userId: string,
    reason?: string
  ): Promise<Result<void>>;
  getProfile(actor: ActorContext, userId: string): Promise<Result<Profile>>;
  updateProfile(
    actor: ActorContext,
    userId: string,
    updates: ProfileUpdate
  ): Promise<Result<Profile>>;
  getAIPreferences(
    actor: ActorContext,
    userId: string
  ): Promise<Result<AIPreferences>>;
  updateAIPreferences(
    actor: ActorContext,
    userId: string,
    updates: AIPreferencesUpdate
  ): Promise<Result<AIPreferences>>;
  listUsers(
    actor: ActorContext,
    params: ListUsersParams
  ): Promise<Result<PaginatedResult<User>>>;
}

// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────

const MAX_DISPLAY_NAME_LENGTH = 255;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Check if actor is AI_ACTOR (no mutations allowed)
 */
function isAIActor(actor: ActorContext): boolean {
  return actor.type === 'ai';
}

/**
 * Check if actor has wildcard permission
 */
function hasWildcardPermission(actor: ActorContext): boolean {
  return actor.permissions.includes('*');
}

/**
 * Check if actor can perform action on target user
 */
function canAccessUser(
  actor: ActorContext,
  targetUserId: string,
  requiredPermission: string
): boolean {
  // AI_ACTOR can read anything (for context assembly)
  // Design decision: AI needs read access to assemble context
  if (isAIActor(actor) && requiredPermission.endsWith(':read')) {
    return true;
  }
  // Self-access is always allowed
  if (actor.userId === targetUserId) {
    return true;
  }
  // Wildcard permission allows everything
  if (hasWildcardPermission(actor)) {
    return true;
  }
  // Check for specific permission
  return actor.permissions.includes(requiredPermission);
}

/**
 * Check if actor can mutate (AI_ACTOR cannot)
 */
function canMutate(actor: ActorContext): boolean {
  // AI_ACTOR is strictly forbidden from mutations
  if (isAIActor(actor)) {
    return false;
  }
  return true;
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Validate profile update fields
 */
function validateProfileUpdate(updates: ProfileUpdate): {
  valid: boolean;
  error?: string;
} {
  if (updates.displayName !== undefined) {
    if (
      updates.displayName !== null &&
      updates.displayName.length > MAX_DISPLAY_NAME_LENGTH
    ) {
      return { valid: false, error: 'Display name exceeds maximum length' };
    }
  }
  if (updates.timezone !== undefined && updates.timezone === '') {
    return { valid: false, error: 'Timezone cannot be empty' };
  }
  if (updates.locale !== undefined && updates.locale === '') {
    return { valid: false, error: 'Locale cannot be empty' };
  }
  return { valid: true };
}

/**
 * Get list of changed fields from update object
 */
function getChangedFields(updates: Record<string, unknown>): string[] {
  return Object.keys(updates).filter((key) => updates[key] !== undefined);
}

// ─────────────────────────────────────────────────────────────
// SERVICE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────

/**
 * Create UserService instance
 */
export function createUserService(deps: {
  db: UserServiceDb;
  auditService: UserServiceAudit;
}): UserService {
  const { db, auditService } = deps;

  return {
    /**
     * Called after Supabase auth signup to create application user
     * Creates: user record, profile, default ai_preferences
     * NOTE: Does NOT assign roles (guardrail: no role assignment)
     */
    async onUserSignup(
      actor: ActorContext,
      params: UserSignupParams
    ): Promise<Result<User>> {
      // AI_ACTOR cannot trigger signup
      if (isAIActor(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot trigger user signup');
      }

      // Validate email
      if (!isValidEmail(params.email)) {
        return failure('VALIDATION_ERROR', 'Invalid email format');
      }

      try {
        // Create user
        const user = await db.createUser({
          id: params.authUserId,
          email: params.email,
        });

        // Create profile with defaults
        await db.createProfile({ userId: user.id });

        // Create AI preferences with defaults
        await db.createAIPreferences({ userId: user.id });

        // Emit audit event
        await auditService.log(actor, {
          action: 'user:signup',
          resourceType: 'user',
          resourceId: user.id,
          details: { email: params.email },
        });

        return success(user);
      } catch {
        return failure('INTERNAL_ERROR', 'Failed to create user');
      }
    },

    /**
     * Get user by ID
     * Users can only get themselves unless they have 'user:read' permission
     */
    async getUser(actor: ActorContext, userId: string): Promise<Result<User>> {
      // Validate userId
      if (!userId || userId.trim() === '') {
        return failure('VALIDATION_ERROR', 'User ID is required');
      }

      // Check permission
      if (!canAccessUser(actor, userId, 'user:read')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access other users without user:read permission'
        );
      }

      const user = await db.getUser(userId);
      if (user === null) {
        return failure('NOT_FOUND', 'User not found');
      }

      return success(user);
    },

    /**
     * Suspend a user account
     * Requires: 'user:manage' permission
     */
    async suspendUser(
      actor: ActorContext,
      userId: string,
      reason: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot suspend users
      if (!canMutate(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot suspend users');
      }

      // Check permission
      if (
        !hasWildcardPermission(actor) &&
        !actor.permissions.includes('user:manage')
      ) {
        return failure(
          'PERMISSION_DENIED',
          'Requires user:manage permission to suspend users'
        );
      }

      // Prevent self-suspension
      if (actor.userId === userId) {
        return failure('VALIDATION_ERROR', 'Cannot suspend yourself');
      }

      // Get current user
      const user = await db.getUser(userId);
      if (user === null) {
        return failure('NOT_FOUND', 'User not found');
      }

      // Update status
      await db.updateUserStatus(userId, 'suspended');

      // Emit audit event
      await auditService.log(actor, {
        action: 'user:suspended',
        resourceType: 'user',
        resourceId: userId,
        details: { reason },
      });

      return success(undefined);
    },

    /**
     * Reactivate a suspended user
     * Requires: 'user:manage' permission
     */
    async reactivateUser(
      actor: ActorContext,
      userId: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot reactivate users
      if (!canMutate(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot reactivate users');
      }

      // Check permission
      if (
        !hasWildcardPermission(actor) &&
        !actor.permissions.includes('user:manage')
      ) {
        return failure(
          'PERMISSION_DENIED',
          'Requires user:manage permission to reactivate users'
        );
      }

      // Get current user
      const user = await db.getUser(userId);
      if (user === null) {
        return failure('NOT_FOUND', 'User not found');
      }

      // Update status
      await db.updateUserStatus(userId, 'active');

      // Emit audit event
      await auditService.log(actor, {
        action: 'user:reactivated',
        resourceType: 'user',
        resourceId: userId,
      });

      return success(undefined);
    },

    /**
     * Soft delete a user (sets status to 'deleted' and deleted_at timestamp)
     * Requires: 'user:manage' permission
     * Cannot delete yourself
     */
    async softDeleteUser(
      actor: ActorContext,
      userId: string,
      reason?: string
    ): Promise<Result<void>> {
      // AI_ACTOR cannot delete users
      if (!canMutate(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot delete users');
      }

      // Check permission
      if (
        !hasWildcardPermission(actor) &&
        !actor.permissions.includes('user:manage')
      ) {
        return failure(
          'PERMISSION_DENIED',
          'Requires user:manage permission to delete users'
        );
      }

      // Cannot delete yourself
      if (actor.userId === userId) {
        return failure('INVALID_OPERATION', 'Cannot delete yourself');
      }

      // Get current user
      const user = await db.getUser(userId);
      if (user === null) {
        return failure('NOT_FOUND', 'User not found');
      }

      // Cannot delete already deleted user
      if (user.status === 'deleted') {
        return failure('INVALID_OPERATION', 'User is already deleted');
      }

      // Update status to deleted (db.updateUserStatus sets deleted_at automatically)
      await db.updateUserStatus(userId, 'deleted');

      // Emit audit event
      await auditService.log(actor, {
        action: 'user:deleted',
        resourceType: 'user',
        resourceId: userId,
        details: { reason: reason ?? 'No reason provided' },
      });

      return success(undefined);
    },

    /**
     * Get user's profile
     * Users can only access their own profile unless they have 'user:read'
     * AI_ACTOR CAN read profiles (for context assembly)
     */
    async getProfile(
      actor: ActorContext,
      userId: string
    ): Promise<Result<Profile>> {
      // Check permission (AI can read)
      if (!canAccessUser(actor, userId, 'user:read')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access other profiles without user:read permission'
        );
      }

      const profile = await db.getProfile(userId);
      if (profile === null) {
        return failure('NOT_FOUND', 'Profile not found');
      }

      return success(profile);
    },

    /**
     * Update user's profile
     * Users can only update their own profile unless they have 'user:update'
     * AI_ACTOR CANNOT update profiles
     */
    async updateProfile(
      actor: ActorContext,
      userId: string,
      updates: ProfileUpdate
    ): Promise<Result<Profile>> {
      // AI_ACTOR cannot update profiles
      if (!canMutate(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot update profiles');
      }

      // Check permission
      if (!canAccessUser(actor, userId, 'user:update')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot update other profiles without user:update permission'
        );
      }

      // Validate updates
      const validation = validateProfileUpdate(updates);
      if (!validation.valid) {
        return failure(
          'VALIDATION_ERROR',
          validation.error ?? 'Invalid update'
        );
      }

      // Check if user is deleted
      const user = await db.getUser(userId);
      if (user !== null && user.status === 'deleted') {
        return failure(
          'VALIDATION_ERROR',
          'Cannot update deleted user profile'
        );
      }

      // Get current profile
      const currentProfile = await db.getProfile(userId);
      if (currentProfile === null) {
        return failure('NOT_FOUND', 'Profile not found');
      }

      // Update profile
      const updatedProfile = await db.updateProfile(userId, updates);

      // Emit audit event
      await auditService.log(actor, {
        action: 'user:profile_updated',
        resourceType: 'profile',
        resourceId: currentProfile.id,
        details: {
          changedFields: getChangedFields(updates as Record<string, unknown>),
        },
      });

      return success(updatedProfile);
    },

    /**
     * Get user's AI preferences
     * Users can only access their own preferences unless they have 'user:read'
     * AI_ACTOR CAN read preferences (for context assembly)
     */
    async getAIPreferences(
      actor: ActorContext,
      userId: string
    ): Promise<Result<AIPreferences>> {
      // Check permission (AI can read)
      if (!canAccessUser(actor, userId, 'user:read')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot access other preferences without user:read permission'
        );
      }

      const prefs = await db.getAIPreferences(userId);
      if (prefs === null) {
        return failure('NOT_FOUND', 'AI preferences not found');
      }

      return success(prefs);
    },

    /**
     * Update user's AI preferences
     * Users can only update their own preferences unless they have 'user:update'
     * AI_ACTOR CANNOT update preferences
     */
    async updateAIPreferences(
      actor: ActorContext,
      userId: string,
      updates: AIPreferencesUpdate
    ): Promise<Result<AIPreferences>> {
      // AI_ACTOR cannot update preferences
      if (!canMutate(actor)) {
        return failure('PERMISSION_DENIED', 'AI cannot update AI preferences');
      }

      // Check permission
      if (!canAccessUser(actor, userId, 'user:update')) {
        return failure(
          'PERMISSION_DENIED',
          'Cannot update other preferences without user:update permission'
        );
      }

      // Get current preferences
      const currentPrefs = await db.getAIPreferences(userId);
      if (currentPrefs === null) {
        return failure('NOT_FOUND', 'AI preferences not found');
      }

      // Update preferences
      const updatedPrefs = await db.updateAIPreferences(userId, updates);

      // Emit audit event
      await auditService.log(actor, {
        action: 'user:ai_preferences_updated',
        resourceType: 'ai_preferences',
        resourceId: currentPrefs.id,
        details: {
          changedFields: getChangedFields(updates as Record<string, unknown>),
        },
      });

      return success(updatedPrefs);
    },

    /**
     * List all users (paginated)
     * Requires: 'user:read' permission
     */
    async listUsers(
      actor: ActorContext,
      params: ListUsersParams
    ): Promise<Result<PaginatedResult<User>>> {
      // Check permission
      if (
        !hasWildcardPermission(actor) &&
        !actor.permissions.includes('user:read')
      ) {
        return failure(
          'PERMISSION_DENIED',
          'Requires user:read permission to list users'
        );
      }

      const result = await db.listUsers(params);
      return success(result);
    },
  };
}
