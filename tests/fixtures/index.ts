/**
 * Test Fixtures
 * Reusable test data for consistent testing
 */

export const testUser = {
  id: 'user_test123',
  email: 'test@example.com',
  name: 'Test User',
};

export const testOrganization = {
  id: 'org_test123',
  name: 'Test Organization',
  slug: 'test-org',
};

export const testConversation = {
  id: 'conv_test123',
  title: 'Test Conversation',
  userId: testUser.id,
  organizationId: testOrganization.id,
};

export const testMessage = {
  id: 'msg_test123',
  conversationId: testConversation.id,
  role: 'user' as const,
  content: 'Hello, this is a test message',
};
