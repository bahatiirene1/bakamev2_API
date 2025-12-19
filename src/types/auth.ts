/**
 * AuthService Types
 * From Stage 2: Service Layer Design - Section 3.1
 */

/**
 * Actor Context - Who is performing the action
 * Every service method receives this context
 */
export interface ActorContext {
  type: 'user' | 'admin' | 'system' | 'ai' | 'anonymous';
  userId?: string;
  sessionId?: string;
  requestId: string;
  permissions: string[];
  ip?: string;
  userAgent?: string;
}

/**
 * System actor for background jobs and triggers
 * Has all permissions - use with caution
 */
export const SYSTEM_ACTOR: ActorContext = {
  type: 'system',
  requestId: 'system',
  permissions: ['*'],
};

/**
 * AI actor for orchestrator-initiated actions
 * CRITICAL: AI has NO direct permissions - must go through services
 */
export const AI_ACTOR: ActorContext = {
  type: 'ai',
  requestId: 'ai',
  permissions: [], // AI has NO permissions - this is intentional
};

/**
 * Role entity
 */
export interface Role {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: Permission[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Permission entity
 */
export interface Permission {
  id: string;
  code: string;
  description: string;
  category: string;
  createdAt: Date;
}

/**
 * User role assignment
 */
export interface UserRole {
  id: string;
  userId: string;
  roleId: string;
  grantedBy: string | null;
  grantedAt: Date;
  expiresAt: Date | null;
}

/**
 * Parameters for assigning a role
 */
export interface AssignRoleParams {
  targetUserId: string;
  roleId: string;
  expiresAt?: Date;
}

/**
 * Parameters for revoking a role
 */
export interface RevokeRoleParams {
  targetUserId: string;
  roleId: string;
}
