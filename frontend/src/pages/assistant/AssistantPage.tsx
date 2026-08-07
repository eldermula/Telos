import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { GlassCard } from '../../components/ui/GlassCard';
import { Input } from '../../components/ui/Input';
import {
  createConversation,
  getInsights,
  listConversations,
  listMessages,
  postMessage,
  type AssistantConversation,
  type AssistantInsights,
  type AssistantMessage,
} from '../../lib/api/assistant';
import { ApiError } from '../../types/api';

export function AssistantPage() {
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [insights, setInsights] = useState<AssistantInsights | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    const page = await listConversations();
    setConversations(page.data);
    return page.data;
  }, []);

  const loadThread = useCallback(async (id: string) => {
    const page = await listMessages(id);
    setMessages(page.data);
    setActiveId(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, insightRes] = await Promise.all([refreshList(), getInsights()]);
        if (cancelled) return;
        setInsights(insightRes);
        if (list[0]) {
          await loadThread(list[0].id);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load assistant.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList, loadThread]);

  async function onNewConversation() {
    setError(null);
    try {
      const created = await createConversation();
      await refreshList();
      setMessages([]);
      setActiveId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create conversation.');
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      let conversationId = activeId;
      if (!conversationId) {
        const created = await createConversation();
        conversationId = created.id;
        setActiveId(created.id);
      }
      const result = await postMessage(conversationId, draft.trim());
      setDraft('');
      setMessages((prev) => [...prev, result.user_message, result.assistant_message]);
      await refreshList();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send message.');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return <p className="text-text-secondary">Loading assistant…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="type-display-sm">AI Assistant</h1>
        <p className="mt-1 text-text-secondary">
          Read-only advisory chat. It cannot start/stop trading or place orders.
        </p>
      </div>

      {error ? (
        <p className="rounded-[8px] border border-state-danger/40 bg-state-danger/10 px-4 py-3 text-state-danger">
          {error}
        </p>
      ) : null}

      {insights ? (
        <GlassCard>
          <h2 className="type-heading mb-3">Insights</h2>
          <ul className="space-y-2">
            {insights.insights.map((item) => (
              <li key={item.code} className="type-caption text-text-secondary">
                <span className="text-text-primary">{item.severity}</span> — {item.message}
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <GlassCard>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="type-heading">Chats</h2>
            <Button variant="ghost" onClick={() => void onNewConversation()}>
              New
            </Button>
          </div>
          <ul className="space-y-1">
            {conversations.length === 0 ? (
              <li className="type-caption text-text-secondary">No conversations yet.</li>
            ) : (
              conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`w-full rounded-[8px] px-2 py-2 text-left type-caption ${
                      activeId === c.id
                        ? 'bg-glass-fill text-text-primary'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                    onClick={() => void loadThread(c.id)}
                  >
                    {c.title || 'Conversation'}
                  </button>
                </li>
              ))
            )}
          </ul>
        </GlassCard>

        <GlassCard>
          <div className="mb-4 flex min-h-[280px] flex-col gap-3">
            {messages.length === 0 ? (
              <p className="text-text-secondary">Send a question about session health, risk, or where to find analytics.</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-[8px] px-3 py-2 ${
                    m.role === 'user' ? 'bg-glass-fill self-end max-w-[85%]' : 'border border-border-subtle max-w-[90%]'
                  }`}
                >
                  <p className="type-caption text-text-secondary mb-1">{m.role}</p>
                  <p className="whitespace-pre-wrap text-text-primary">{m.content}</p>
                </div>
              ))
            )}
          </div>
          <form className="flex flex-col gap-3" onSubmit={onSend}>
            <Input
              label="Message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask something advisory…"
              disabled={sending}
            />
            <div>
              <Button type="submit" disabled={sending || !draft.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </form>
        </GlassCard>
      </div>
    </div>
  );
}
