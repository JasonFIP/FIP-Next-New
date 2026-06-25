/**
 * /inbox — the farmer's recommendations, the farmer side of the sign-off gate.
 *
 * Lists the farmer's own drafts and their current state:
 *   - pending_review → awaiting the consultant
 *   - approved       → confirmed advice (shows the consultant's final text,
 *                      including any edits they made)
 *   - rejected       → not approved, with the consultant's reason
 *
 * Data comes from GET /api/recommendations, which returns the signed-in
 * user's own recommendations (RLS: drafter reads own). Reloading reflects
 * the latest state, so a farmer sees a draft flip to "confirmed" once their
 * consultant approves it in /review.
 *
 * Styling reuses the southern-sky tokens, same as /review.
 */

import { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type Recommendation = {
  id: string;
  state: string;
  title: string;
  summary: string;
  review_notes: string | null;
  drafted_at: string;
  reviewed_at: string | null;
  farm_name: string | null;
  reviewed_by_name: string | null;
};

type Props = { user: { id: string; first_name: string | null } };

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
    .select('id, first_name')
    .eq('id', authUser.id)
    .single();
  if (!profile) {
    return { redirect: { destination: '/signin', permanent: false } };
  }
  return { props: { user: profile } };
};

const STATE_LABEL: Record<string, string> = {
  draft: 'Being prepared',
  pending_review: 'Awaiting your consultant',
  approved: 'Confirmed',
  rejected: 'Not approved',
  expired: 'Expired',
};

const STATE_COLOR: Record<string, string> = {
  draft: 'var(--muted)',
  pending_review: 'var(--horizon)',
  approved: 'var(--moss)',
  rejected: 'var(--rata)',
  expired: 'var(--muted)',
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function InboxPage({
  user,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <Head>
        <title>Your recommendations · Agvance</title>
      </Head>
      <main className="ib-wrap">
        <header className="ib-head">
          <div>
            <h1 className="ib-title">Your recommendations</h1>
            <p className="ib-sub">
              Draft answers your consultant reviews before you act on them.
            </p>
          </div>
          <Link href="/chat" className="ib-link">
            ← Back to chat
          </Link>
        </header>

        {error && <div className="ib-error">{error}</div>}

        {loading ? (
          <p className="ib-muted">Loading…</p>
        ) : recs.length === 0 ? (
          <div className="ib-empty">
            <p>Nothing here yet.</p>
            <p className="ib-muted">
              When you ask the assistant a question, your draft answer shows up
              here while your consultant reviews it.
            </p>
            <Link href="/chat" className="ib-cta">
              Ask a question →
            </Link>
          </div>
        ) : (
          <ul className="ib-list">
            {recs.map((r) => (
              <li key={r.id} className="ib-card">
                <div className="ib-meta">
                  <span
                    className="ib-badge"
                    style={{
                      color: STATE_COLOR[r.state] ?? 'var(--muted)',
                      borderColor: STATE_COLOR[r.state] ?? 'var(--muted)',
                    }}
                  >
                    {STATE_LABEL[r.state] ?? r.state}
                  </span>
                  <span className="ib-muted">{timeAgo(r.drafted_at)}</span>
                </div>

                <div className="ib-q">{r.title}</div>

                <div className="ib-answer">{r.summary}</div>

                {r.state === 'pending_review' && (
                  <div className="ib-note ib-note-pending">
                    Your consultant
                    {r.farm_name ? ` for ${r.farm_name}` : ''} hasn&rsquo;t
                    reviewed this yet. Hold off on acting until it&rsquo;s
                    confirmed.
                  </div>
                )}
                {r.state === 'approved' && (
                  <div className="ib-note ib-note-ok">
                    ✓ Confirmed
                    {r.reviewed_by_name ? ` by ${r.reviewed_by_name}` : ''}. This
                    is good to act on.
                    {r.review_notes ? ` — ${r.review_notes}` : ''}
                  </div>
                )}
                {r.state === 'rejected' && (
                  <div className="ib-note ib-note-bad">
                    Your consultant didn&rsquo;t approve this
                    {r.review_notes ? `: ${r.review_notes}` : '.'} Best to talk
                    it through with them directly.
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      <style jsx>{`
        .ib-wrap {
          max-width: 720px;
          margin: 0 auto;
          padding: 40px 20px 80px;
          color: var(--star);
        }
        .ib-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          margin-bottom: 28px;
        }
        .ib-title {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0 0 6px;
        }
        .ib-sub {
          margin: 0;
          color: var(--star-dim);
          font-size: 0.9rem;
        }
        .ib-link {
          color: var(--star-dim);
          font-size: 0.85rem;
          text-decoration: none;
          white-space: nowrap;
        }
        .ib-link:hover {
          color: var(--star);
        }
        .ib-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .ib-card {
          background: var(--ink-2);
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 18px 20px;
        }
        .ib-meta {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .ib-badge {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          font-weight: 600;
          border: 1px solid;
          border-radius: 999px;
          padding: 3px 10px;
        }
        .ib-muted {
          color: var(--muted);
          font-size: 0.82rem;
        }
        .ib-q {
          font-size: 0.95rem;
          font-weight: 500;
          margin-bottom: 10px;
          color: var(--star);
        }
        .ib-answer {
          white-space: pre-wrap;
          line-height: 1.55;
          font-size: 0.92rem;
          color: var(--star-dim);
          background: rgba(0, 0, 0, 0.22);
          border-radius: 8px;
          padding: 14px 16px;
        }
        .ib-note {
          margin-top: 12px;
          font-size: 0.84rem;
          line-height: 1.5;
          padding: 10px 14px;
          border-radius: 8px;
        }
        .ib-note-pending {
          background: rgba(232, 185, 98, 0.1);
          color: var(--star-dim);
          border-left: 3px solid var(--horizon);
        }
        .ib-note-ok {
          background: rgba(125, 171, 106, 0.12);
          color: var(--star-dim);
          border-left: 3px solid var(--moss);
        }
        .ib-note-bad {
          background: rgba(200, 79, 58, 0.1);
          color: var(--star-dim);
          border-left: 3px solid var(--rata);
        }
        .ib-empty {
          text-align: center;
          padding: 60px 20px;
        }
        .ib-cta {
          display: inline-block;
          margin-top: 16px;
          color: var(--horizon);
          text-decoration: none;
        }
        .ib-error {
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
