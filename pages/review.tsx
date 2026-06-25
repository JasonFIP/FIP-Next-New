/**
 * /review — the consultant review queue (the sign-off gate, consultant side).
 *
 * Lists farmer-mode drafts in 'pending_review' for the farms this advisor
 * advises. Each draft can be approved, edited-then-approved, or rejected
 * with a reason. Actioned drafts drop out of the queue.
 *
 * Farmer-facing surfaces (the draft banner in chat, the inbox, the status
 * flip) are a separate increment. This page is advisor-only.
 *
 * Styling reuses the southern-sky tokens from globals.css (--ink, --star,
 * --moss/approve, --rata/reject, --horizon/pending) so it matches /chat
 * without needing edits to the global stylesheet.
 */

import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type Recommendation = {
  id: string;
  farm_id: string;
  state: string;
  title: string;
  summary: string;
  reasoning: string;
  caveats: string | null;
  drafted_at: string;
  farm_name: string | null;
  drafted_by_name: string | null;
};

type Props = {
  user: { id: string; first_name: string | null; role: string };
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
    .select('id, first_name, role')
    .eq('id', authUser.id)
    .single();

  if (!profile) {
    return { redirect: { destination: '/signin', permanent: false } };
  }
  // Advisors only. Farmers don't have a review queue.
  if (!['admin', 'consultant', 'vet'].includes(profile.role)) {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }

  return { props: { user: profile } };
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function ReviewPage({
  user,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // per-card UI state
  const [mode, setMode] = useState<Record<string, 'edit' | 'reject' | null>>({});
  const [editText, setEditText] = useState<Record<string, string>>({});
  const [rejectText, setRejectText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Record<string, string>>({}); // id -> result label

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/recommendations');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setRecs(data.recommendations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function action(
    id: string,
    payload: {
      action: 'approve' | 'reject';
      edited_summary?: string;
      review_notes?: string;
    }
  ) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/recommendations/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Action failed');
      setDone((d) => ({
        ...d,
        [id]: payload.action === 'approve' ? 'Approved' : 'Rejected',
      }));
      // drop the card after a beat
      setTimeout(() => setRecs((rs) => rs.filter((r) => r.id !== id)), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  return (
    <>
      <Head>
        <title>Review queue · Agvance</title>
      </Head>
      <main className="rv-wrap">
        <header className="rv-head">
          <div>
            <h1 className="rv-title">Review queue</h1>
            <p className="rv-sub">
              Farmer drafts awaiting your sign-off. Nothing reaches a farmer as
              confirmed advice until you approve it.
            </p>
          </div>
          <div className="rv-headright">
            <span className="rv-count">{recs.length} pending</span>
            <Link href="/chat" className="rv-link">
              ← Back to chat
            </Link>
          </div>
        </header>

        {error && <div className="rv-error">{error}</div>}

        {loading ? (
          <p className="rv-muted">Loading…</p>
        ) : recs.length === 0 ? (
          <div className="rv-empty">
            <p>You&rsquo;re all caught up.</p>
            <p className="rv-muted">
              New farmer drafts for your farms will appear here.
            </p>
          </div>
        ) : (
          <ul className="rv-list">
            {recs.map((r) => {
              const m = mode[r.id] ?? null;
              const isBusy = busy[r.id];
              const result = done[r.id];
              return (
                <li
                  key={r.id}
                  className={`rv-card ${result ? 'rv-card-done' : ''}`}
                >
                  <div className="rv-meta">
                    <span className="rv-farm">{r.farm_name ?? 'Unknown farm'}</span>
                    <span className="rv-dot">·</span>
                    <span>{r.drafted_by_name ?? 'Farmer'}</span>
                    <span className="rv-dot">·</span>
                    <span className="rv-muted">{timeAgo(r.drafted_at)}</span>
                    {result && <span className="rv-result">{result}</span>}
                  </div>

                  <div className="rv-q">
                    <span className="rv-qlabel">Farmer asked</span>
                    {r.title}
                  </div>

                  <div className="rv-draft">{r.summary}</div>

                  {r.reasoning && (
                    <div className="rv-reason">{r.reasoning}</div>
                  )}

                  {m === 'edit' && (
                    <textarea
                      className="rv-textarea"
                      value={editText[r.id] ?? r.summary}
                      onChange={(e) =>
                        setEditText((t) => ({ ...t, [r.id]: e.target.value }))
                      }
                      rows={8}
                    />
                  )}

                  {m === 'reject' && (
                    <textarea
                      className="rv-textarea"
                      placeholder="Reason for rejecting (the farmer's consultant record keeps this)…"
                      value={rejectText[r.id] ?? ''}
                      onChange={(e) =>
                        setRejectText((t) => ({ ...t, [r.id]: e.target.value }))
                      }
                      rows={3}
                    />
                  )}

                  {!result && (
                    <div className="rv-actions">
                      {m === null && (
                        <>
                          <button
                            className="rv-btn rv-approve"
                            disabled={isBusy}
                            onClick={() => action(r.id, { action: 'approve' })}
                          >
                            Approve
                          </button>
                          <button
                            className="rv-btn rv-ghost"
                            disabled={isBusy}
                            onClick={() =>
                              setMode((s) => ({ ...s, [r.id]: 'edit' }))
                            }
                          >
                            Edit &amp; approve
                          </button>
                          <button
                            className="rv-btn rv-reject"
                            disabled={isBusy}
                            onClick={() =>
                              setMode((s) => ({ ...s, [r.id]: 'reject' }))
                            }
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {m === 'edit' && (
                        <>
                          <button
                            className="rv-btn rv-approve"
                            disabled={isBusy}
                            onClick={() =>
                              action(r.id, {
                                action: 'approve',
                                edited_summary: editText[r.id] ?? r.summary,
                              })
                            }
                          >
                            Save &amp; approve
                          </button>
                          <button
                            className="rv-btn rv-ghost"
                            disabled={isBusy}
                            onClick={() =>
                              setMode((s) => ({ ...s, [r.id]: null }))
                            }
                          >
                            Cancel
                          </button>
                        </>
                      )}

                      {m === 'reject' && (
                        <>
                          <button
                            className="rv-btn rv-reject"
                            disabled={isBusy || !(rejectText[r.id]?.trim())}
                            onClick={() =>
                              action(r.id, {
                                action: 'reject',
                                review_notes: rejectText[r.id],
                              })
                            }
                          >
                            Confirm reject
                          </button>
                          <button
                            className="rv-btn rv-ghost"
                            disabled={isBusy}
                            onClick={() =>
                              setMode((s) => ({ ...s, [r.id]: null }))
                            }
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <style jsx>{`
        .rv-wrap {
          max-width: 760px;
          margin: 0 auto;
          padding: 40px 20px 80px;
          color: var(--star);
        }
        .rv-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 28px;
        }
        .rv-title {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0 0 6px;
        }
        .rv-sub {
          margin: 0;
          color: var(--star-dim);
          font-size: 0.9rem;
          max-width: 46ch;
        }
        .rv-headright {
          text-align: right;
          white-space: nowrap;
        }
        .rv-count {
          display: block;
          color: var(--horizon);
          font-size: 0.85rem;
          margin-bottom: 8px;
        }
        .rv-link {
          color: var(--star-dim);
          font-size: 0.85rem;
          text-decoration: none;
        }
        .rv-link:hover {
          color: var(--star);
        }
        .rv-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .rv-card {
          background: var(--ink-2);
          border: 1px solid var(--line);
          border-left: 3px solid var(--horizon);
          border-radius: 12px;
          padding: 18px 20px;
          transition: opacity 0.3s ease, transform 0.3s ease;
        }
        .rv-card-done {
          opacity: 0.5;
          transform: scale(0.99);
          border-left-color: var(--moss);
        }
        .rv-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.82rem;
          color: var(--star-dim);
          margin-bottom: 12px;
        }
        .rv-farm {
          color: var(--star);
          font-weight: 500;
        }
        .rv-dot {
          color: var(--muted);
        }
        .rv-result {
          margin-left: auto;
          color: var(--moss);
          font-weight: 600;
        }
        .rv-q {
          font-size: 0.95rem;
          margin-bottom: 12px;
          color: var(--star);
        }
        .rv-qlabel {
          display: block;
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted);
          margin-bottom: 4px;
        }
        .rv-draft {
          white-space: pre-wrap;
          line-height: 1.55;
          font-size: 0.92rem;
          color: var(--star-dim);
          background: rgba(0, 0, 0, 0.22);
          border-radius: 8px;
          padding: 14px 16px;
        }
        .rv-reason {
          margin-top: 10px;
          font-size: 0.78rem;
          color: var(--muted);
          font-style: italic;
        }
        .rv-textarea {
          width: 100%;
          margin-top: 12px;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid var(--line-2);
          border-radius: 8px;
          color: var(--star);
          padding: 12px 14px;
          font-family: inherit;
          font-size: 0.9rem;
          line-height: 1.5;
          resize: vertical;
        }
        .rv-textarea:focus {
          outline: none;
          border-color: var(--horizon);
        }
        .rv-actions {
          display: flex;
          gap: 10px;
          margin-top: 16px;
          flex-wrap: wrap;
        }
        .rv-btn {
          border: 1px solid var(--line-2);
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 0.85rem;
          font-family: inherit;
          cursor: pointer;
          background: transparent;
          color: var(--star);
          transition: all 0.15s ease;
        }
        .rv-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .rv-approve {
          background: var(--moss);
          border-color: var(--moss);
          color: #0e1218;
          font-weight: 600;
        }
        .rv-approve:hover:not(:disabled) {
          filter: brightness(1.08);
        }
        .rv-reject {
          color: var(--rata);
          border-color: rgba(200, 79, 58, 0.4);
        }
        .rv-reject:hover:not(:disabled) {
          background: rgba(200, 79, 58, 0.12);
        }
        .rv-ghost:hover:not(:disabled) {
          border-color: var(--star-dim);
        }
        .rv-empty {
          text-align: center;
          padding: 60px 20px;
        }
        .rv-muted {
          color: var(--muted);
        }
        .rv-error {
          background: rgba(200, 79, 58, 0.12);
          border: 1px solid rgba(200, 79, 58, 0.4);
          color: var(--rata);
          border-radius: 8px;
          padding: 10px 14px;
          margin-bottom: 16px;
          font-size: 0.88rem;
        }
      `}</style>
    </>
  );
}
