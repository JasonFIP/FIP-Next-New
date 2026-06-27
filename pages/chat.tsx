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
import Markdown from '@/components/Markdown';
import { useVoice } from '@/lib/use-voice';

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
  const [farms, setFarms] = useState<
    { id: string; name: string; region: string | null }[]
  >([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string>('');
  useEffect(() => {
    if (user.role === 'farmer') return;
    fetch('/api/farms')
      .then((r) => (r.ok ? r.json() : { farms: [] }))
      .then((d) => setFarms(d.farms || []))
      .catch(() => {});
  }, [user.role]);
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

  // -- Voice: dictation (speech-to-text) + read-aloud (text-to-speech) --
  const voiceBaseRef = useRef('');
  const voice = useVoice({
    lang: 'en-NZ',
    onTranscript: (text) => {
      const base = voiceBaseRef.current;
      setInput((base ? base + ' ' : '') + text);
    },
  });
  const handleMic = () => {
    if (voice.listening) {
      voice.stopListening();
      return;
    }
    voice.stopSpeaking();
    voiceBaseRef.current = input.trim();
    voice.startListening();
  };
  const handleSpeakerToggle = () => {
    const next = !voice.speakEnabled;
    voice.setSpeakEnabled(next);
    if (!next) voice.stopSpeaking();
  };
  // Latest read-aloud closure — callable from sendMessage without dep churn.
  const speakAnswerRef = useRef<(t: string) => void>(() => {});
  speakAnswerRef.current = (t: string) => {
    if (voice.speakEnabled) voice.speak(t);
  };

  // -- Attachments: image (Claude vision) or transcript (text) --
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<{
    kind: 'image' | 'text';
    name: string;
    mediaType?: string;
    data?: string;
    text?: string;
    previewUrl?: string;
  } | null>(null);

  const clearAttachment = () => {
    setAttachment((a) => {
      if (a?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl);
      return null;
    });
  };

  // Downscale + re-encode to keep photos small and within Claude's image limits.
  function downscaleImage(
    file: File,
    maxDim = 1568,
    quality = 0.85
  ): Promise<{ data: string; mediaType: string; previewUrl: string }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        URL.revokeObjectURL(url);
        if (!ctx) {
          reject(new Error('no canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({
          data: dataUrl.split(',')[1],
          mediaType: 'image/jpeg',
          previewUrl: dataUrl,
        });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image decode failed'));
      };
      img.src = url;
    });
  }

  const readRawImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      setAttachment({
        kind: 'image',
        name: file.name,
        mediaType: file.type || 'image/jpeg',
        data: result.includes(',') ? result.split(',')[1] : result,
        previewUrl: result,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleFile = (file: File) => {
    if (!file) return;
    if (file.type.startsWith('image/')) {
      downscaleImage(file)
        .then(({ data, mediaType, previewUrl }) =>
          setAttachment({
            kind: 'image',
            name: file.name,
            mediaType,
            data,
            previewUrl,
          })
        )
        .catch(() => readRawImage(file));
    } else {
      const reader = new FileReader();
      reader.onload = () =>
        setAttachment({
          kind: 'text',
          name: file.name,
          text: String(reader.result || ''),
        });
      reader.readAsText(file);
    }
  };

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
    if ((!text && !attachment) || isStreaming) return;

    // Stop any in-progress read-aloud when a new question is sent.
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();

    // Capture the attachment for this turn (cleared from the composer below).
    const att = attachment;
    const attNote = att
      ? `\n\n[Attached ${att.kind === 'image' ? 'image' : 'transcript'}: ${att.name}]`
      : '';
    const optimisticContent = (text + attNote).trim() || '(attachment)';

    // Add the user message optimistically
    const userMsgId = `temp-${Date.now()}-user`;
    const assistantMsgId = `temp-${Date.now()}-assistant`;

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: optimisticContent },
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        citations: [],
        isStreaming: true,
      },
    ]);
    setInput('');
    clearAttachment();
    setIsStreaming(true);
    setStatusText('Searching Dairy Brain…');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversation_id: activeConversationId ?? undefined,
          farm_id: selectedFarmId || undefined,
          attachment: att
            ? {
                kind: att.kind,
                name: att.name,
                media_type: att.mediaType,
                data: att.data,
                text: att.text,
              }
            : undefined,
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
              speakAnswerRef.current(assistantContent);
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
  }, [input, isStreaming, attachment, activeConversationId, selectedFarmId, loadConversations]);

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
          {!isFarmer && farms.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 20px',
                borderBottom: '1px solid var(--line, rgba(242,240,230,0.08))',
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: 'var(--star-dim, #c9c6b8)',
                  whiteSpace: 'nowrap',
                }}
              >
                Advising
              </span>
              <select
                value={selectedFarmId}
                onChange={(e) => setSelectedFarmId(e.target.value)}
                style={{
                  background: 'rgba(0,0,0,0.28)',
                  color: 'var(--star, #f2f0e6)',
                  border: '1px solid var(--line-2, rgba(242,240,230,0.16))',
                  borderRadius: 8,
                  padding: '6px 10px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  maxWidth: 320,
                }}
              >
                <option value="">No farm — general advice</option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.region ? ` · ${f.region}` : ''}
                  </option>
                ))}
              </select>
              <a
                href="/farms"
                style={{
                  fontSize: 12,
                  color: 'var(--star-dim, #c9c6b8)',
                  textDecoration: 'none',
                  marginLeft: 'auto',
                  whiteSpace: 'nowrap',
                }}
              >
                Manage farms
              </a>
            </div>
          )}
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
                      {m.content ? (
                        <Markdown>{m.content}</Markdown>
                      ) : (
                        <span className="thinking">
                          <span className="dot-pulse" />
                          {statusText || 'Thinking…'}
                        </span>
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
            <style>{`@keyframes db-voice-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.65;transform:scale(1.07)}}`}</style>
            {attachment && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 8,
                  padding: '7px 10px',
                  background: 'rgba(0,0,0,0.28)',
                  border: '1px solid var(--line-2, rgba(242,240,230,0.16))',
                  borderRadius: 10,
                }}
              >
                {attachment.kind === 'image' && attachment.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={attachment.previewUrl}
                    alt=""
                    style={{
                      width: 32,
                      height: 32,
                      objectFit: 'cover',
                      borderRadius: 6,
                      flex: 'none',
                    }}
                  />
                ) : (
                  <span style={{ flex: 'none', color: 'var(--star-dim, #c9c6b8)' }}>
                    📎
                  </span>
                )}
                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--star, #f2f0e6)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {attachment.name}
                  <span
                    style={{
                      color: 'var(--star-dim, #c9c6b8)',
                      marginLeft: 8,
                      fontSize: 11,
                    }}
                  >
                    {attachment.kind === 'image' ? 'image' : 'transcript'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={clearAttachment}
                  aria-label="Remove attachment"
                  style={{
                    marginLeft: 'auto',
                    flex: 'none',
                    background: 'none',
                    border: 'none',
                    color: 'var(--star-dim, #c9c6b8)',
                    cursor: 'pointer',
                    fontSize: 16,
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </div>
            )}
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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,.txt,.md,.vtt,.srt"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                aria-label="Upload a transcript or image"
                title="Upload transcript or image"
                style={{
                  flex: 'none',
                  width: 42,
                  height: 42,
                  borderRadius: 11,
                  cursor: isStreaming ? 'default' : 'pointer',
                  border: '1px solid var(--line-2, rgba(242,240,230,0.16))',
                  background: attachment
                    ? 'rgba(120,160,220,0.16)'
                    : 'transparent',
                  color: attachment
                    ? 'var(--star, #f2f0e6)'
                    : 'var(--star-dim, #c9c6b8)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
              {voice.supported && (
                <button
                  type="button"
                  onClick={handleMic}
                  disabled={isStreaming}
                  aria-label={
                    voice.listening ? 'Stop dictation' : 'Dictate your question'
                  }
                  title={voice.listening ? 'Stop' : 'Speak'}
                  style={{
                    flex: 'none',
                    width: 42,
                    height: 42,
                    borderRadius: 11,
                    cursor: isStreaming ? 'default' : 'pointer',
                    border: '1px solid var(--line-2, rgba(242,240,230,0.16))',
                    background: voice.listening
                      ? 'rgba(220,90,90,0.18)'
                      : 'transparent',
                    color: voice.listening
                      ? '#ff9a9a'
                      : 'var(--star-dim, #c9c6b8)',
                    display: 'grid',
                    placeItems: 'center',
                    animation: voice.listening
                      ? 'db-voice-pulse 1.3s ease-in-out infinite'
                      : 'none',
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="2" width="6" height="11" rx="3" />
                    <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={handleSpeakerToggle}
                aria-label={
                  voice.speakEnabled
                    ? 'Turn off read aloud'
                    : 'Read answers aloud'
                }
                aria-pressed={voice.speakEnabled}
                title={
                  voice.speakEnabled ? 'Read aloud: on' : 'Read aloud: off'
                }
                style={{
                  flex: 'none',
                  width: 42,
                  height: 42,
                  borderRadius: 11,
                  cursor: 'pointer',
                  border: '1px solid var(--line-2, rgba(242,240,230,0.16))',
                  background: voice.speakEnabled
                    ? 'rgba(120,160,220,0.16)'
                    : 'transparent',
                  color: voice.speakEnabled
                    ? 'var(--star, #f2f0e6)'
                    : 'var(--star-dim, #c9c6b8)',
                  display: 'grid',
                  placeItems: 'center',
                  animation: voice.speaking
                    ? 'db-voice-pulse 1s ease-in-out infinite'
                    : 'none',
                }}
              >
                {voice.speakEnabled ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 9v6h4l5 4V5L8 9H4z" />
                    <path d="M16 8a5 5 0 0 1 0 8" />
                  </svg>
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 9v6h4l5 4V5L8 9H4z" />
                    <path d="M22 9l-6 6M16 9l6 6" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                onClick={sendMessage}
                disabled={(!input.trim() && !attachment) || isStreaming}
                className="send-btn"
              >
                {isStreaming ? '…' : 'Send'}
              </button>
            </div>
            <div className="input-foot">
              {voice.supported ? 'Mic to speak · ' : ''}Paperclip to attach a photo
              or transcript · Enter to send · Cited against the Agvance Dairy Brain
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
