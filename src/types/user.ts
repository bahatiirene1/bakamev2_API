/**
 * UserService Types
 * From Stage 2: Service Layer Design - Section 3.2
 *
 * SCOPE: Profiles, AI preferences, account status
 * NOT IN SCOPE: Roles, permissions, auth tokens, subscriptions
 */

/**
 * User entity - identity anchor
 */
export interface User {
  id: string;
  email: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null; // Soft delete
}

/**
 * User account status
 */
export type UserStatus = 'active' | 'suspended' | 'deleted';

/**
 * User profile - presentation data only
 */
export interface Profile {
  id: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Profile update parameters
 * All fields optional - only provided fields are updated
 */
export interface ProfileUpdate {
  displayName?: string | null;
  avatarUrl?: string | null;
  timezone?: string;
  locale?: string;
}

/**
 * AI preferences - user's AI interaction settings
 */
export interface AIPreferences {
  id: string;
  userId: string;
  responseLength: ResponseLength;
  formality: Formality;
  allowMemory: boolean;
  allowWebSearch: boolean;
  customInstructions: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Response length preference
 */
export type ResponseLength = 'concise' | 'balanced' | 'detailed';

/**
 * Formality preference
 */
export type Formality = 'casual' | 'neutral' | 'formal';

/**
 * AI preferences update parameters
 * All fields optional - only provided fields are updated
 */
export interface AIPreferencesUpdate {
  responseLength?: ResponseLength;
  formality?: Formality;
  allowMemory?: boolean;
  allowWebSearch?: boolean;
  customInstructions?: string | null;
}

/**
 * Parameters for user signup (post Supabase auth)
 */
export interface UserSignupParams {
  authUserId: string; // From Supabase auth.users
  email: string;
}

/**
 * Parameters for listing users
 */
export interface ListUsersParams {
  status?: UserStatus;
  limit: number;
  cursor?: string;
}
