import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function check() {
  const userId = 'df30f1c4-b007-490d-8925-de3c24cd6dd1';

  // Get user roles
  const { data: roles } = await supabase
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId);

  console.log('User roles:', roles);

  // Get role permissions for each role
  for (const role of roles || []) {
    const { data: perms } = await supabase
      .from('role_permissions')
      .select('permissions(code)')
      .eq('role_id', role.role_id);

    console.log('Permissions for role', role.role_id, ':');
    perms?.forEach((p) =>
      console.log('  -', (p.permissions as { code: string }).code)
    );
  }

  // Check all permissions in DB
  const { data: allPerms } = await supabase
    .from('permissions')
    .select('code')
    .order('code');

  console.log('\nAll available permissions in DB:');
  allPerms?.forEach((p) => console.log('  -', p.code));
}

check();
