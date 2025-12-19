/**
 * Setup Test Admin User
 * Creates an admin user with full permissions for testing
 *
 * Run: npx tsx scripts/setup-test-admin.ts
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// Test admin credentials
const TEST_ADMIN_EMAIL = 'admin@bakame.test';
const TEST_ADMIN_PASSWORD = 'AdminTest123!';

async function setupTestAdmin() {
  console.log('Setting up test admin user...\n');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Create or get the auth user
  console.log('1. Creating/getting auth user...');

  // First try to get existing user
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  let authUser = existingUsers?.users?.find(
    (u) => u.email === TEST_ADMIN_EMAIL
  );

  if (!authUser) {
    const { data: newUser, error: createError } =
      await supabase.auth.admin.createUser({
        email: TEST_ADMIN_EMAIL,
        password: TEST_ADMIN_PASSWORD,
        email_confirm: true,
      });

    if (createError) {
      console.error('Failed to create auth user:', createError);
      process.exit(1);
    }
    authUser = newUser.user;
    console.log(`   Created new auth user: ${authUser.id}`);
  } else {
    console.log(`   Found existing auth user: ${authUser.id}`);
  }

  const userId = authUser.id;

  // 2. Ensure user exists in users table
  console.log('2. Ensuring user in users table...');

  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!existingUser) {
    const { error: insertError } = await supabase.from('users').insert({
      id: userId,
      email: TEST_ADMIN_EMAIL,
      status: 'active',
    });

    if (insertError) {
      console.error('Failed to insert user:', insertError);
      process.exit(1);
    }
    console.log('   Created user in users table');
  } else {
    console.log('   User already exists in users table');
  }

  // 3. Get or create admin role
  console.log('3. Getting/creating admin role...');

  let { data: adminRole } = await supabase
    .from('roles')
    .select('id')
    .eq('name', 'admin')
    .maybeSingle();

  if (!adminRole) {
    const { data: newRole, error: roleError } = await supabase
      .from('roles')
      .insert({
        name: 'admin',
        description: 'Full administrative access',
        is_system: true,
      })
      .select('id')
      .single();

    if (roleError) {
      console.error('Failed to create admin role:', roleError);
      process.exit(1);
    }
    adminRole = newRole;
    console.log(`   Created admin role: ${adminRole.id}`);
  } else {
    console.log(`   Found existing admin role: ${adminRole.id}`);
  }

  // 4. Get all permissions and assign to admin role
  console.log('4. Setting up admin permissions...');

  const { data: allPermissions } = await supabase
    .from('permissions')
    .select('id, code');

  if (!allPermissions || allPermissions.length === 0) {
    // Create default permissions if none exist
    console.log('   Creating default permissions...');
    const defaultPermissions = [
      { code: 'admin:*', description: 'Full admin access', category: 'admin' },
      { code: 'user:read', description: 'Read users', category: 'user' },
      { code: 'user:write', description: 'Write users', category: 'user' },
      { code: 'user:manage', description: 'Manage users', category: 'user' },
      { code: 'chat:read', description: 'Read chats', category: 'chat' },
      { code: 'chat:write', description: 'Write chats', category: 'chat' },
      {
        code: 'knowledge:read',
        description: 'Read knowledge',
        category: 'knowledge',
      },
      {
        code: 'knowledge:write',
        description: 'Write knowledge',
        category: 'knowledge',
      },
      {
        code: 'knowledge:publish',
        description: 'Publish knowledge',
        category: 'knowledge',
      },
      {
        code: 'approval:read',
        description: 'Read approvals',
        category: 'approval',
      },
      {
        code: 'approval:write',
        description: 'Write approvals',
        category: 'approval',
      },
      { code: 'audit:read', description: 'Read audit logs', category: 'audit' },
      { code: 'tool:read', description: 'Read tools', category: 'tool' },
      { code: 'tool:execute', description: 'Execute tools', category: 'tool' },
    ];

    const { data: createdPerms, error: permError } = await supabase
      .from('permissions')
      .insert(defaultPermissions)
      .select('id, code');

    if (permError) {
      console.error('Failed to create permissions:', permError);
      process.exit(1);
    }

    // Assign all permissions to admin role
    const rolePermissions = createdPerms.map((p) => ({
      role_id: adminRole!.id,
      permission_id: p.id,
    }));

    const { error: rpError } = await supabase
      .from('role_permissions')
      .upsert(rolePermissions, { onConflict: 'role_id,permission_id' });

    if (rpError) {
      console.error('Failed to assign permissions to role:', rpError);
    }
    console.log(
      `   Created ${createdPerms.length} permissions and assigned to admin role`
    );
  } else {
    // Assign all existing permissions to admin role
    const rolePermissions = allPermissions.map((p) => ({
      role_id: adminRole!.id,
      permission_id: p.id,
    }));

    const { error: rpError } = await supabase
      .from('role_permissions')
      .upsert(rolePermissions, { onConflict: 'role_id,permission_id' });

    if (rpError) {
      console.error('Failed to assign permissions to role:', rpError);
    }
    console.log(
      `   Assigned ${allPermissions.length} permissions to admin role`
    );
  }

  // 5. Assign admin role to user
  console.log('5. Assigning admin role to user...');

  const { data: existingAssignment } = await supabase
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role_id', adminRole.id)
    .maybeSingle();

  if (!existingAssignment) {
    const { error: assignError } = await supabase.from('user_roles').insert({
      user_id: userId,
      role_id: adminRole.id,
      granted_by: null,
    });

    if (assignError) {
      console.error('Failed to assign role:', assignError);
      process.exit(1);
    }
    console.log('   Assigned admin role to user');
  } else {
    console.log('   User already has admin role');
  }

  // 6. Generate access token for testing
  console.log('\n6. Generating access token...');

  const { data: session, error: signInError } =
    await supabase.auth.signInWithPassword({
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
    });

  if (signInError) {
    console.error('Failed to sign in:', signInError);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('TEST ADMIN SETUP COMPLETE');
  console.log('========================================');
  console.log(`Email: ${TEST_ADMIN_EMAIL}`);
  console.log(`Password: ${TEST_ADMIN_PASSWORD}`);
  console.log(`User ID: ${userId}`);
  console.log('\nAccess Token (for API testing):');
  console.log(session.session?.access_token);
  console.log('\nRefresh Token:');
  console.log(session.session?.refresh_token);
  console.log('========================================\n');

  // Save token to a file for easy access
  const fs = await import('fs');
  fs.writeFileSync(
    '/home/bahati/bakamev2/.admin-token',
    session.session?.access_token || ''
  );
  console.log('Token saved to .admin-token file');
}

setupTestAdmin().catch(console.error);
