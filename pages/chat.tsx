/**
 * /chat — the main agent chat interface.
 *
 * Visual treatment: prototype-style NZ southern-sky dark palette,
 * glassmorphic input bar, citation chips, feedback controls. Streaming
 * responses render token by token. Conversation history in left sidebar.
 *
 * The constellation/farm-data visualisations from the original prototype
 * are not built here — those are step 5 once farm data lands. This is
 * pure conversational chat.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

type Citation = {
  index?: number;
  citation_label: string;
  source_name: string;
  heading: string;
  source_type: string;
  similarity?: number;
  has_nz_caveat?: boolean;
  chunk_ref?: string;
  source_doc?: string;
  source_section?: string | null;
  snippet?: string | null;
};

type Feedback = {
  kind: string;
  reason: string | null;
  notes: string | null;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  citations?: Citation[];
  feedback?: Feedback | null;
  isStreaming?: boolean;
};

type ConversationSummary = {
  id: string;
  title: string;
  updated_at: string;
};

type Props = {
  user: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    role: string;
  };
};

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const supabase = createSupabaseServerClient(ctx.req as any, ctx.res as any);
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return { redirect: { destination: '/signin', permanent: false } };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, role')
    .eq('id', authUser.id)
    .single();

  if (!profile) {
    return { redirect: { destination: '/signin', permanent: false } };
  }

  // Farmers are allowed now (farmer mode). Only genuinely unknown roles bounce.
  if (!['admin', 'consultant', 'vet', 'farmer'].includes(profile.role)) {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }

  return { props: { user: profile } };
};

export default function ChatPage({
  user,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const router = useRouter();
  const isFarmer = user.role === 'farmer';
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [feedbackPopup, setFeedbackPopup] = useState<string | null>(null);
  const [expandedCitations, setExpandedCitations] = useState<Set<string>>(
    new Set()
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // -- Load conversation list --
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (Array.isArray(data.conversations)) {
        setConversations(data.conversations);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // -- Load a specific conversation --
  const loadConversation = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      if (!res.ok) {
        const err = await res.json();
        console.error('Failed to load conversation:', err);
        return;
      }
      const data = await res.json();
      setActiveConversationId(conversationId);
      setMessages(
        (data.messages ?? []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citations: m.citations ?? [],
          feedback: m.feedback ?? null,
        }))
      );
    } catch (err) {
      console.error('Error loading conversation:', err);
    }
  }, []);

  // -- Start a new conversation --
  const startNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setInput('');
    inputRef.current?.focus();
  }, []);

  // -- Sign out --
  const handleSignOut = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/signin');
  }, [router]);

  // -- Send a message --
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    // Add the user message optimistically
    const userMsgId = `temp-${Date.now()}-user`;
    const assistantMsgId = `temp-${Date.now()}-assistant`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: text },
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        citations: [],
        isStreaming: true,
      },
    ]);
    setInput('');
    setIsStreaming(true);
    setStatusText('Searching Dairy Brain…');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation_id: activeConversationId ?? undefined,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = 'Chat request failed';
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error ?? errMsg;
        } catch {
          errMsg = errText.slice(0, 300);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: `Error: ${errMsg}`, isStreaming: false }
              : m
          )
        );
        setIsStreaming(false);
        setStatusText('');
        return;
      }

      if (!res.body) {
        setIsStreaming(false);
        setStatusText('');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let assistantContent = '';
      let realAssistantId = assistantMsgId;
      let citations: Citation[] = [];
      let newConversationId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          try {
            const evt = JSON.parse(payload);

            if (evt.type === 'meta') {
              newConversationId = evt.conversation_id;
              citations = evt.citations ?? [];
              setStatusText(
                citations.length > 0
                  ? `Drawing on ${citations.length} KB sections…`
                  : 'Composing response…'
              );

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, citations } : m
                )
              );
            } else if (evt.type === 'token') {
              assistantContent += evt.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, content: assistantContent }
                    : m
                )
              );
            } else if (evt.type === 'done') {
              if (evt.assistant_message_id) {
                realAssistantId = evt.assistant_message_id;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, id: evt.assistant_message_id, isStreaming: false }
                      : m
                  )
                );
              }
            } else if (evt.type === 'error') {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content:
                          assistantContent +
                          `\n\n[Error: ${evt.message}]`,
                        isStreaming: false,
                      }
                    : m
                )
              );
            }
          } catch {
            /* ignore */
          }
        }
      }

      // Update conversation list and active id
      if (newConversationId && newConversationId !== activeConversationId) {
        setActiveConversationId(newConversationId);
        loadConversations();
      } else {
        loadConversations();
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: `Error: ${
                  err instanceof Error ? err.message : 'unknown'
                }`,
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      setStatusText('');
      // Mark assistant message as no longer streaming
      setMessages((prev) =>
        prev.map((m) =>
          m.role === 'assistant' && m.isStreaming
            ? { ...m, isStreaming: false }
            : m
        )
      );
    }
  }, [input, isStreaming, activeConversationId, loadConversations]);

  // -- Submit feedback --
  const submitFeedback = useCallback(
    async (
      messageId: string,
      kind: 'thumbs_up' | 'thumbs_down',
      reason?: string,
      notes?: string
    ) => {
      try {
        const res = await fetch(`/api/messages/${messageId}/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, reason, notes }),
        });
        if (res.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    feedback: { kind, reason: reason ?? null, notes: notes ?? null },
                  }
                : m
            )
          );
        }
      } catch (err) {
        console.error('Feedback failed:', err);
      }
      setFeedbackPopup(null);
    },
    []
  );

  // -- Toggle citation panel --
  const toggleCitation = useCallback((messageId: string) => {
    setExpandedCitations((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  // -- Auto-scroll to bottom on new messages --
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // -- Submit on Enter (Shift+Enter = newline) --
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const displayName =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || user.email;

  return (
    <>
      <Head>
        <title>FIP &middot; Chat</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="chat-app">
        {/* Sidebar */}
        <aside className="chat-sidebar">
          <div className="chat-sidebar-head">
            <div className="brand-line">
              <span className="dot" />
              <span className="brand">FIP &middot; Farm Intelligence</span>
            </div>
            <button
              onClick={startNewConversation}
              className="new-chat-btn"
              type="button"
            >
              + New conversation
            </button>
          </div>

          <div className="conv-list">
            {conversations.length === 0 && (
              <div className="conv-empty">
                No conversations yet.
                <br />
                Start one below.
              </div>
            )}
            {conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => loadConversation(c.id)}
                className={`conv-item ${
                  c.id === activeConversationId ? 'active' : ''
                }`}
                type="button"
              >
                <div className="conv-title">{c.title || 'Untitled'}</div>
                <div className="conv-date">
                  {new Date(c.updated_at).toLocaleDateString('en-NZ', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </div>
              </button>
            ))}
          </div>

          <div className="chat-sidebar-foot">
            <div className="user-card">
              <div className="user-name">{displayName}</div>
              <div className="user-role">{user.role}</div>
            </div>
            <button onClick={handleSignOut} className="signout-btn" type="button">
              Sign out
            </button>
          </div>
        </aside>

        {/* Main chat area */}
        <main className="chat-main">
          <div className="chat-stream">
            {messages.length === 0 && (
              <div className="welcome">
                <h1>Dairy Brain</h1>
                <p>
                  Grounded nutrition advice for NZ dairy consultants. Ask about
                  products, rumen health, transition, feed reference, or
                  seasonal challenges. Every answer is cited against the
                  Agvance Dairy Brain knowledge base.
                </p>
                <div className="suggested">
                  <button
                    type="button"
                    onClick={() => setInput('What is CalSea Powder Advance used for?')}
                  >
                    What is CalSea Powder Advance?
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setInput('What should I recommend for a client running fodder beet this winter?')
                    }
                  >
                    Recommendations for a fodder-beet wintering herd
                  </button>
                  <button
                    type="button"
                    onClick={() => setInput('How does SARA contribute to lameness?')}
                  >
                    SARA and lameness
                  </button>
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={`msg msg-${m.role}`}>
                {m.role === 'user' && (
                  <div className="msg-user-content">{m.content}</div>
                )}

                {m.role === 'assistant' && (
                  <>
                    <div className="msg-assistant-content">
                      {m.content || (
                        <span className="thinking">
                          <span className="dot-pulse" />
                          {statusText || 'Thinking…'}
                        </span>
                      )}
                      {m.isStreaming && m.content && (
                        <span className="cursor-blink">▍</span>
                      )}
                    </div>

                    {isFarmer &&
                      !m.isStreaming &&
                      m.content &&
                      !m.content.startsWith('Error:') && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: '10px 14px',
                            background: 'rgba(232,185,98,0.10)',
                            borderLeft: '3px solid var(--horizon)',
                            borderRadius: 8,
                            fontSize: '0.82rem',
                            color: 'var(--star-dim)',
                            lineHeight: 1.5,
                          }}
                        >
                          ⏳ Sent to your consultant as a draft — they&rsquo;ll
                          confirm or adjust it before you act on it.{' '}
                          <Link
                            href="/inbox"
                            style={{
                              color: 'var(--horizon)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Track status →
                          </Link>
                        </div>
                      )}

                    {!isFarmer && m.citations && m.citations.length > 0 && !m.isStreaming && (
                      <div className="msg-citations">
                        <button
                          type="button"
                          onClick={() => toggleCitation(m.id)}
                          className="citations-toggle"
                        >
                          {expandedCitations.has(m.id) ? '▾' : '▸'} {m.citations.length} source{m.citations.length === 1 ? '' : 's'}
                        </button>
                        {expandedCitations.has(m.id) && (
                          <ol className="citations-list">
                            {m.citations.map((c, i) => (
                              <li key={i}>
                                <span className="cite-num">[{c.index ?? i + 1}]</span>{' '}
                                <span className="cite-label">
                                  {c.citation_label || `${c.source_doc} > ${c.source_section ?? ''}`}
                                </span>
                                {c.has_nz_caveat && (
                                  <span className="cite-nz" title="Carries NZ-context caveat">
                                    {' '}🌏 NZ caveat
                                  </span>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}

                    {!isFarmer && !m.isStreaming && m.content && !m.id.startsWith('temp-') && (
                      <div className="msg-feedback">
                        <button
                          type="button"
                          className={`fb-btn ${m.feedback?.kind === 'thumbs_up' ? 'active' : ''}`}
                          onClick={() => submitFeedback(m.id, 'thumbs_up')}
                          title="Helpful"
                        >
                          👍
                        </button>
                        <button
                          type="button"
                          className={`fb-btn ${m.feedback?.kind === 'thumbs_down' ? 'active' : ''}`}
                          onClick={() => setFeedbackPopup(m.id)}
                          title="Not helpful"
                        >
                          👎
                        </button>
                      </div>
                    )}

                    {feedbackPopup === m.id && (
                      <FeedbackPopup
                        onSubmit={(reason, notes) =>
                          submitFeedback(m.id, 'thumbs_down', reason, notes)
                        }
                        onCancel={() => setFeedbackPopup(null)}
                      />
                    )}
                  </>
                )}
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-wrap">
            <div className="chat-input">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about products, rumen health, transition, seasonal challenges…"
                rows={1}
                disabled={isStreaming}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || isStreaming}
                className="send-btn"
              >
                {isStreaming ? '…' : 'Send'}
              </button>
            </div>
            <div className="input-foot">
              Shift+Enter for new line · Enter to send · Cited against the Agvance Dairy Brain
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

// -- Feedback reason picker --
function FeedbackPopup(props: {
  onSubmit: (reason: string, notes: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState('other');
  const [notes, setNotes] = useState('');

  return (
    <div className="fb-popup">
      <h3>What was wrong?</h3>
      <label>
        <span>Reason</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="stale_figure">Stale figure / out-of-date number</option>
          <option value="wrong_product">Wrong product / shouldn't have been recommended</option>
          <option value="nz_context_missed">Overseas figure quoted as NZ fact</option>
          <option value="phosphate_p_confusion">Phosphate / elemental P confusion</option>
          <option value="narrow_safety_margin">Gave dose without flagging safety margin</option>
          <option value="diagnosis_creep">Diagnosed or treated when shouldn't have</option>
          <option value="hierarchy_violated">Evidence overrode Agvance guidance</option>
          <option value="hallucination">Fabricated a fact</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        <span>Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="What specifically went wrong?"
        />
      </label>
      <div className="fb-popup-actions">
        <button type="button" onClick={props.onCancel} className="fb-cancel">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => props.onSubmit(reason, notes)}
          className="fb-submit"
        >
          Submit
        </button>
      </div>
    </div>
  );
}
