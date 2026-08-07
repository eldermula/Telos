import { apiRequest } from './client';

export type AssistantConversation = {
  id: string;
  created_at: string;
  title?: string | null;
};

export type AssistantMessage = {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
};

export type AssistantInsights = {
  generated_at: string;
  source: string;
  insights: Array<{ code: string; severity: string; message: string }>;
};

export function listConversations(): Promise<{
  data: AssistantConversation[];
  meta: { page: number; limit: number; total: number };
}> {
  return apiRequest('/assistant/conversations');
}

export function createConversation(): Promise<AssistantConversation> {
  return apiRequest('/assistant/conversations', { method: 'POST' });
}

export function listMessages(conversationId: string): Promise<{
  data: AssistantMessage[];
  meta: { page: number; limit: number; total: number };
}> {
  return apiRequest(`/assistant/conversations/${conversationId}/messages?limit=100`);
}

export function postMessage(
  conversationId: string,
  content: string,
): Promise<{ user_message: AssistantMessage; assistant_message: AssistantMessage }> {
  return apiRequest(`/assistant/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { content },
  });
}

export function getInsights(): Promise<AssistantInsights> {
  return apiRequest('/assistant/insights');
}
