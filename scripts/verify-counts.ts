import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string
);

async function verifyCounts() {
  console.log('=== REAL DATABASE COUNTS ===\n');

  // Count users
  const { count: userCount } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });
  console.log(`Total Users: ${userCount}`);

  // Count chats
  const { count: chatCount } = await supabase
    .from('chats')
    .select('*', { count: 'exact', head: true });
  console.log(`Total Chats: ${chatCount}`);

  // Count messages
  const { count: messageCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true });
  console.log(`Total Messages: ${messageCount}`);

  // Count knowledge items
  const { count: knowledgeCount } = await supabase
    .from('knowledge_items')
    .select('*', { count: 'exact', head: true });
  console.log(`Knowledge Items: ${knowledgeCount}`);

  // Count pending approvals
  const { count: approvalCount } = await supabase
    .from('approval_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  console.log(`Pending Approvals: ${approvalCount}`);

  // Count audit logs
  const { count: auditCount } = await supabase
    .from('audit_logs')
    .select('*', { count: 'exact', head: true });
  console.log(`Audit Logs: ${auditCount}`);

  console.log('\n=== END ===');
}

verifyCounts();
