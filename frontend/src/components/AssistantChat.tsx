import { useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { Filters } from './FiltersPanel';

type ChatMsg = { role: 'user' | 'assistant'; content: string };
type Action =
  | { type: 'setFilters'; patch: Partial<Filters> }
  | { type: 'clearFilters' }
  | { type: 'navigate'; to: '/jobs' | '/applications' };

export function AssistantChat({
  filters,
  setFilters,
  clearFilters,
  navigate,
}: {
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
  navigate: (to: '/jobs' | '/applications') => void;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', content: 'Ask me to filter jobs (e.g., “only remote React jobs posted this week”).' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const history = useMemo(() => messages.slice(-10), [messages]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      try {
        const res = await apiFetch<{ history: { role: 'user' | 'assistant'; content: string }[] }>('/ai/assistant/history');
        if (res.history?.length) {
          setMessages((prev) => {
            // Preserve local messages if user already chatted in this session.
            if (prev.length > 1) return prev;
            return [
              { role: 'assistant', content: 'Ask me to filter jobs (e.g., “only remote React jobs posted this week”).' },
              ...res.history,
            ];
          });
        }
      } catch {
        // ignore
      }
    })();
  }, [open]);

  function applyActions(actions: Action[]) {
    for (const a of actions) {
      if (a.type === 'setFilters') setFilters(a.patch);
      if (a.type === 'clearFilters') clearFilters();
      if (a.type === 'navigate') navigate(a.to);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setLoading(true);
    setMessages((m) => [...m, { role: 'user', content: text }]);
    try {
      const res = await apiFetch<{ assistantText: string; actions: Action[] }>('/ai/assistant', {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          history,
          currentFilters: filters,
        }),
      } as any);
      if (res.actions?.length) applyActions(res.actions);
      setMessages((m) => [...m, { role: 'assistant', content: res.assistantText || 'Done.' }]);
      queueMicrotask(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'Something went wrong calling the assistant.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="chatWrap">
      {open ? (
        <div
          className="chatOverlay"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div className="chatPanel chatPanelOpen" onClick={(e) => e.stopPropagation()}>
          <div className="chatHeader">
            <div className="h2">Assistant</div>
            <button className="btn btnSecondary" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <div className="chatList" ref={listRef}>
            {messages.map((m, idx) => (
              <div key={idx} className={m.role === 'user' ? 'chatMsg chatUser' : 'chatMsg chatAi'}>
                {m.content}
              </div>
            ))}
          </div>
          <div className="chatComposer">
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g., Only remote full-time React jobs in Bangalore"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void send();
              }}
            />
            <button className="btn" onClick={() => void send()} disabled={loading}>
              {loading ? '…' : 'Send'}
            </button>
          </div>
          </div>
        </div>
      ) : (
        <button className="chatBubble btn" onClick={() => setOpen(true)}>
          Chat
        </button>
      )}
    </div>
  );
}

