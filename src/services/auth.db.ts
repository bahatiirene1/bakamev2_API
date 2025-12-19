/**
 * AuthService Database Adapter
 * Implements AuthServiceDb interface using Supabase
 *
 * Reference: docs/stage-1-database-governance.md Section 2.2
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Role, Permission } from '@/types/index.js';

import type { AuthServiceDb } from './auth.service.js';

/**
 * Database row types (from Stage 1 schema)
 */
interface RoleRow {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

interface PermissionRow {
  id: string;
  code: string;
  description: string;
  category: string;
  created_at: string;
}

interface RolePermissionRow {
  role_id: string;
  permission_id: string;
  permissions: PermissionRow;
}

/**
 * Map database row to Role entity
 */
function mapRowToRole(row: RoleRow, permissions: Permission[]): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    permissions,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Map database row to Permission entity
 */
function mapRowToPermission(row: PermissionRow): Permission {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    category: row.category,
    createdAt: new Date(row.created_at),
  };
}

/**
 * Create AuthServiceDb implementation using Supabase
 */
export function createAuthServiceDb(supabase: SupabaseClient): AuthServiceDb {
  return {
    /**
     * Get user's role assignments
     */
    async getUserRoles(
      userId: string
    ): Promise<Array<{ roleId: string; expiresAt: Date | null }>> {
      const { data, error } = await supabase
        .from('user_roles')
        .select('role_id, expires_at')
        .eq('user_id', userId);

      if (error !== null) {
        throw new Error(`Failed to get user roles: ${error.message}`);
      }

      return (data ?? []).map((row) => ({
        roleId: row.role_id as string,
        expiresAt:
          row.expires_at !== null ? new Date(row.expires_at as string) : null,
      }));
    },

    /**
     * Get permissions for a role
     */
    async getRolePermissions(roleId: string): Promise<Array<{ code: string }>> {
      const { data, error } = await supabase
        .from('role_permissions')
        .select('permissions(code)')
        .eq('role_id', roleId);

      if (error !== null) {
        throw new Error(`Failed to get role permissions: ${error.message}`);
      }

      return (data ?? []).map((row) => ({
        code: (row.permissions as unknown as { code: string }).code,
      }));
    },

    /**
     * Get a role by ID
     */
    async getRole(roleId: string): Promise<Role | null> {
      const result = await supabase
        .from('roles')
        .select('*')
        .eq('id', roleId)
        .maybeSingle();

      if (result.error !== null) {
        throw new Error(`Failed to get role: ${result.error.message}`);
      }

      if (result.data === null) {
        return null;
      }

      const roleData = result.data as RoleRow;

      // Get permissions for this role
      const permResult = await supabase
        .from('role_permissions')
        .select('permissions(*)')
        .eq('role_id', roleId);

      if (permResult.error !== null) {
        throw new Error(
          `Failed to get role permissions: ${permResult.error.message}`
        );
      }

      const permissions = (permResult.data ?? []).map((row) =>
        mapRowToPermission((row as unknown as RolePermissionRow).permissions)
      );

      return mapRowToRole(roleData, permissions);
    },

    /**
     * Get all roles
     */
    async getRoles(): Promise<Role[]> {
      const result = await supabase.from('roles').select('*').order('name');

      if (result.error !== null) {
        throw new Error(`Failed to get roles: ${result.error.message}`);
      }

      const rolesData = (result.data ?? []) as RoleRow[];
      const roles: Role[] = [];

      for (const roleRow of rolesData) {
        const permResult = await supabase
          .from('role_permissions')
          .select('permissions(*)')
          .eq('role_id', roleRow.id);

        if (permResult.error !== null) {
          throw new Error(
            `Failed to get role permissions: ${permResult.error.message}`
          );
        }

        const permissions = (permResult.data ?? []).map((row) =>
          mapRowToPermission((row as unknown as RolePermissionRow).permissions)
        );

        roles.push(mapRowToRole(roleRow, permissions));
      }

      return roles;
    },

    /**
     * Assign a role to a user
     */
    async assignRole(params: {
      userId: string;
      roleId: string;
      grantedBy: string | null;
      expiresAt?: Date;
    }): Promise<{ id: string }> {
      const insertData: Record<string, unknown> = {
        user_id: params.userId,
        role_id: params.roleId,
        granted_by: params.grantedBy,
      };

      if (params.expiresAt !== undefined) {
        insertData.expires_at = params.expiresAt.toISOString();
      }

      const { data, error } = await supabase
        .from('user_roles')
        .insert(insertData)
        .select('id')
        .single();

      if (error !== null) {
        throw new Error(`Failed to assign role: ${error.message}`);
      }

      return { id: data.id as string };
    },

    /**
     * Revoke a role from a user
     */
    async revokeRole(userId: string, roleId: string): Promise<boolean> {
      const { error, count } = await supabase
        .from('user_roles')
        .delete({ count: 'exact' })
        .eq('user_id', userId)
        .eq('role_id', roleId);

      if (error !== null) {
        throw new Error(`Failed to revoke role: ${error.message}`);
      }

      return (count ?? 0) > 0;
    },
  };
}
