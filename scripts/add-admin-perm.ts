import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function addAdminPermission() {
  const adminRoleId = 'af6b6e26-51b9-4029-89c3-44b3c25968c3';

  // 1. Check if admin:* permission exists
  const { data: existing } = await supabase
    .from('permissions')
    .select('id')
    .eq('code', 'admin:*')
    .maybeSingle();

  let permissionId: string;

  if (existing) {
    permissionId = existing.id;
    console.log('admin:* permission already exists:', permissionId);
  } else {
    // Create admin:* permission
    const { data: newPerm, error: permError } = await supabase
      .from('permissions')
      .insert({
        code: 'admin:*',
        description: 'Full administrative access',
        category: 'admin',
      })
      .select('id')
      .single();

    if (permError) {
      console.error('Failed to create permission:', permError);
      process.exit(1);
    }

    permissionId = newPerm.id;
    console.log('Created admin:* permission:', permissionId);
  }

  // 2. Assign to admin role
  const { error: assignError } = await supabase.from('role_permissions').upsert(
    {
      role_id: adminRoleId,
      permission_id: permissionId,
    },
    { onConflict: 'role_id,permission_id' }
  );

  if (assignError) {
    console.error('Failed to assign permission to role:', assignError);
    process.exit(1);
  }

  console.log('Successfully assigned admin:* permission to admin role');
}

addAdminPermission();
