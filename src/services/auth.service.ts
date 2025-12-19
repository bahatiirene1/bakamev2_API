/**
 * AuthService Implementation
 * Phase 2: TDD - GREEN phase
 *
 * Reference: docs/stage-2-service-layer.md Section 3.1
 *
 * Purpose: Authentication and authorization decisions.
 * Owns: permissions, roles, role_permissions, user_roles
 * Dependencies: AuditService (will be added later)
 */

import type {
  ActorContext,
  Role,
  AssignRoleParams,
  RevokeRoleParams,
  Result,
} from '@/types/index.js';
import { success, failure } from '@/types/index.js';

/**
 * Database abstraction interface for AuthService
 * Allows mocking in tests
 */
export interface AuthServiceDb {
  getUserRoles: (
    userId: string
  ) => Promise<Array<{ roleId: string; expiresAt: Date | null }>>;
  getRolePermissions: (roleId: string) => Promise<Array<{ code: string }>>;
  getRole: (roleId: string) => Promise<Role | null>;
  getRoles: () => Promise<Role[]>;
  assignRole: (params: {
    userId: string;
    roleId: string;
    grantedBy: string | null;
    expiresAt?: Date;
  }) => Promise<{ id: string }>;
  revokeRole: (userId: string, roleId: string) => Promise<boolean>;
}

/**
 * AuthService interface
 */
export interface AuthService {
  hasPermission(actor: ActorContext, permission: string): Promise<boolean>;
  hasAllPermissions(
    actor: ActorContext,
    permissions: string[]
  ): Promise<boolean>;
  hasAnyPermission(
    actor: ActorContext,
    permissions: string[]
  ): Promise<boolean>;
  resolvePermissions(userId: string): Promise<Result<string[]>>;
  assignRole(
    actor: ActorContext,
    params: AssignRoleParams
  ): Promise<Result<void>>;
  revokeRole(
    actor: ActorContext,
    params: RevokeRoleParams
  ): Promise<Result<void>>;
  getUserRoles(actor: ActorContext, userId: string): Promise<Result<Role[]>>;
  listRoles(actor: ActorContext): Promise<Result<Role[]>>;
}

/**
 * Check if actor has wildcard permission (system actor)
 */
function hasWildcardPermission(actor: ActorContext): boolean {
  return actor.permissions.includes('*');
}

/**
 * Check if a role assignment is expired
 */
function isRoleExpired(expiresAt: Date | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  return expiresAt.getTime() < Date.now();
}

/**
 * Create AuthService instance
 */
export function createAuthService(deps: { db: AuthServiceDb }): AuthService {
  const { db } = deps;

  return {
    /**
     * Check if actor has a specific permission
     */
    hasPermission(actor: ActorContext, permission: string): Promise<boolean> {
      // Empty permission is never granted
      if (permission === '') {
        return Promise.resolve(false);
      }

      // System actor with wildcard has all permissions
      if (hasWildcardPermission(actor)) {
        return Promise.resolve(true);
      }

      // Check if actor has the specific permission
      return Promise.resolve(actor.permissions.includes(permission));
    },

    /**
     * Check multiple permissions at once
     * Returns true only if ALL permissions are present
     */
    hasAllPermissions(
      actor: ActorContext,
      permissions: string[]
    ): Promise<boolean> {
      // Empty array means no permissions required
      if (permissions.length === 0) {
        return Promise.resolve(true);
      }

      // System actor with wildcard has all permissions
      if (hasWildcardPermission(actor)) {
        return Promise.resolve(true);
      }

      // Check if actor has ALL specified permissions
      return Promise.resolve(
        permissions.every((p) => actor.permissions.includes(p))
      );
    },

    /**
     * Check if actor has ANY of the specified permissions
     */
    hasAnyPermission(
      actor: ActorContext,
      permissions: string[]
    ): Promise<boolean> {
      // Empty array means no permissions to check
      if (permissions.length === 0) {
        return Promise.resolve(false);
      }

      // System actor with wildcard has all permissions
      if (hasWildcardPermission(actor)) {
        return Promise.resolve(true);
      }

      // Check if actor has ANY of the specified permissions
      return Promise.resolve(
        permissions.some((p) => actor.permissions.includes(p))
      );
    },

    /**
     * Resolve all permissions for a user (from their roles)
     * Used to build ActorContext at request start
     */
    async resolvePermissions(userId: string): Promise<Result<string[]>> {
      try {
        // Get all roles for the user
        const userRoles = await db.getUserRoles(userId);

        // Filter out expired roles and collect permissions
        const allPermissions: string[] = [];

        for (const userRole of userRoles) {
          // Skip expired roles
          if (isRoleExpired(userRole.expiresAt)) {
            continue;
          }

          // Get permissions for this role
          const rolePermissions = await db.getRolePermissions(userRole.roleId);
          for (const perm of rolePermissions) {
            allPermissions.push(perm.code);
          }
        }

        // Deduplicate permissions
        const uniquePermissions = [...new Set(allPermissions)];

        return success(uniquePermissions);
      } catch {
        return failure('NOT_FOUND', 'Failed to resolve permissions for user');
      }
    },

    /**
     * Assign a role to a user
     * Requires: 'role:assign' permission
     */
    async assignRole(
      actor: ActorContext,
      params: AssignRoleParams
    ): Promise<Result<void>> {
      // Check permission
      const canAssign = await this.hasPermission(actor, 'role:assign');
      if (!canAssign) {
        return failure(
          'PERMISSION_DENIED',
          'Actor lacks role:assign permission'
        );
      }

      // Check if role exists
      const role = await db.getRole(params.roleId);
      if (role === null) {
        return failure('NOT_FOUND', 'Role not found');
      }

      // Assign the role
      const assignParams: Parameters<typeof db.assignRole>[0] = {
        userId: params.targetUserId,
        roleId: params.roleId,
        grantedBy: actor.userId ?? null,
      };
      if (params.expiresAt !== undefined) {
        assignParams.expiresAt = params.expiresAt;
      }
      await db.assignRole(assignParams);

      // TODO: Emit audit event via AuditService

      return success(undefined);
    },

    /**
     * Revoke a role from a user
     * Requires: 'role:assign' permission
     */
    async revokeRole(
      actor: ActorContext,
      params: RevokeRoleParams
    ): Promise<Result<void>> {
      // Check permission
      const canRevoke = await this.hasPermission(actor, 'role:assign');
      if (!canRevoke) {
        return failure(
          'PERMISSION_DENIED',
          'Actor lacks role:assign permission'
        );
      }

      // Revoke the role
      const revoked = await db.revokeRole(params.targetUserId, params.roleId);

      if (!revoked) {
        return failure('NOT_FOUND', 'User-role assignment not found');
      }

      // TODO: Emit audit event via AuditService

      return success(undefined);
    },

    /**
     * Get all roles for a user
     */
    async getUserRoles(
      actor: ActorContext,
      userId: string
    ): Promise<Result<Role[]>> {
      // Users can view their own roles
      // Others need 'user:read' permission
      const isSelf = actor.userId === userId;
      if (!isSelf) {
        const canRead = await this.hasPermission(actor, 'user:read');
        if (!canRead) {
          return failure(
            'PERMISSION_DENIED',
            'Cannot view roles for other users'
          );
        }
      }

      // Get user's role assignments
      const userRoles = await db.getUserRoles(userId);

      // Fetch full role details
      const roles: Role[] = [];
      for (const userRole of userRoles) {
        const role = await db.getRole(userRole.roleId);
        if (role !== null) {
          roles.push(role);
        }
      }

      return success(roles);
    },

    /**
     * List all available roles
     */
    async listRoles(_actor: ActorContext): Promise<Result<Role[]>> {
      const roles = await db.getRoles();
      return success(roles);
    },
  };
}
