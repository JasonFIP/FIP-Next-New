/**
 * Home / front door.
 *
 * Two faces, decided server-side off the session:
 *   - Signed out → a clean landing: what the platform is + a sign-in CTA.
 *   - Signed in  → a role-aware hub linking to the actual tools (consultation,
 *                  and for advisors the review queue with a live pending count).
 *
 * Replaces the old dev home (the health-check panel lived here) so it's
 * presentable to a pilot consultant. Themed with the southern-sky tokens.
 */

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

type Props = {
  user: { id: string; first_name: string | null; role: string } | null;
  pendingCount: number;
};

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const supabase = createSupabaseServerClient(ctx.req as any, ctx.res as any);
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return { props: { user: null, pendingCount: 0 } };

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, first_name, role')
    .eq('id', authUser.id)
    .single();

  if (!profile) return { props: { user: null, pendingCount: 0 } };

  // For advisors, a live count of drafts awaiting sign-off (RLS scopes it to
  // farms they advise) — shown on the review tile.
  let pendingCount = 0;
  if (['admin', 'consultant', 'vet'].includes(profile.role)) {
    const { count } = await supabase
      .from('recommendations')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'pending_review');
    pendingCount = count ?? 0;
  }

  return { props: { user: profile, pendingCount } };
};

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  consultant: 'Consultant',
  vet: 'Vet',
  farmer: 'Farmer',
};

export default function Home({
  user,
  pendingCount,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const router = useRouter();
  const isAdvisor = !!user && ['admin', 'consultant', 'vet'].includes(user.role);
  const isFarmer = user?.role === 'farmer';

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/signin');
  }

  return (
    <>
      <Head>
        <title>Agvance Dairy Brain</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="home">
        <header className="hd">
          <div className="brand">
            <span className="mark" />
            <span>
              Agvance <span className="brand-dim">Dairy Brain</span>
            </span>
          </div>
          {user ? (
            <div className="hd-right">
              <span className="role">{ROLE_LABEL[user.role] ?? user.role}</span>
              <button className="link-btn" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/signin" className="link-btn">
              Sign in
            </Link>
          )}
        </header>

        {!user ? (
          // ---------- Signed-out landing ----------
          <section className="hero">
            <h1>Grounded dairy nutrition advice.</h1>
            <p className="sub">
              The Agvance Dairy Brain answers NZ dairy nutrition questions for
              consultants — every answer cited against the product library,
              seasonal playbooks, premix range, evidence notes and feed tables.
              Farmer answers route through consultant sign-off before they&rsquo;re
              acted on.
            </p>
            <Link href="/signin" className="cta">
              Sign in to start &rarr;
            </Link>
            <p className="invite">Access is by invitation.</p>
          </section>
        ) : (
          // ---------- Signed-in hub ----------
          <section className="hub">
            <h1>
              Welcome back{user.first_name ? `, ${user.first_name}` : ''}.
            </h1>
            <p className="sub">
              {isFarmer
                ? 'Ask a nutrition question, then track it through your consultant\u2019s review.'
                : 'Ask the Dairy Brain a question, or work through farmer drafts awaiting your sign-off.'}
            </p>

            <div className="tiles">
              <Link href="/chat" className="tile tile-primary">
                <span className="tile-h">Start a consultation</span>
                <span className="tile-d">
                  Ask a grounded, cited nutrition question.
                </span>
                <span className="tile-go">Open chat &rarr;</span>
              </Link>

              {isAdvisor && (
                <Link href="/farms" className="tile">
                  <span className="tile-h">Farms</span>
                  <span className="tile-d">
                    Add and edit the farms you advise and their nutrition
                    profiles.
                  </span>
                  <span className="tile-go">Manage farms &rarr;</span>
                </Link>
              )}

              {isAdvisor && (
                <Link href="/review" className="tile">
                  <span className="tile-h">
                    Review queue
                    {pendingCount > 0 && (
                      <span className="badge">{pendingCount}</span>
                    )}
                  </span>
                  <span className="tile-d">
                    {pendingCount > 0
                      ? `${pendingCount} farmer draft${
                          pendingCount === 1 ? '' : 's'
                        } awaiting your sign-off.`
                      : 'Approve, edit or decline farmer drafts.'}
                  </span>
                  <span className="tile-go">Open queue &rarr;</span>
                </Link>
              )}

              {isFarmer && (
                <Link href="/inbox" className="tile">
                  <span className="tile-h">My recommendations</span>
                  <span className="tile-d">
                    Track your drafts through consultant review.
                  </span>
                  <span className="tile-go">Open inbox &rarr;</span>
                </Link>
              )}

              {user.role === 'admin' && (
                <Link href="/dashboard" className="tile">
                  <span className="tile-h">Dashboard</span>
                  <span className="tile-d">Account and admin details.</span>
                  <span className="tile-go">Open &rarr;</span>
                </Link>
              )}
            </div>
          </section>
        )}

        <footer className="ft">
          <small>Agvance Dairy Brain · Farm Intelligence Platform</small>
        </footer>
      </main>

      <style jsx>{`
        .home {
          max-width: 720px;
          margin: 0 auto;
          padding: 28px 20px 60px;
          color: var(--star);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .hd {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding-bottom: 40px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 600;
          font-size: 0.95rem;
        }
        .brand-dim {
          color: var(--star-dim);
          font-weight: 500;
        }
        .mark {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--horizon);
          box-shadow: 0 0 12px var(--horizon);
        }
        .hd-right {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .role {
          font-size: 0.72rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--horizon);
          border: 1px solid var(--line-2);
          border-radius: 999px;
          padding: 3px 10px;
        }
        .link-btn {
          background: none;
          border: none;
          color: var(--star-dim);
          font: inherit;
          font-size: 0.85rem;
          cursor: pointer;
          text-decoration: none;
          padding: 0;
        }
        .link-btn:hover {
          color: var(--star);
        }
        .hero,
        .hub {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        h1 {
          font-size: 1.7rem;
          font-weight: 600;
          margin: 0 0 14px;
          line-height: 1.2;
        }
        .sub {
          color: var(--star-dim);
          font-size: 0.98rem;
          line-height: 1.6;
          margin: 0 0 28px;
          max-width: 52ch;
        }
        .cta {
          align-self: flex-start;
          background: var(--horizon);
          color: #1a1408;
          padding: 12px 24px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 0.9rem;
          text-decoration: none;
        }
        .cta:hover {
          filter: brightness(1.08);
        }
        .invite {
          color: var(--muted);
          font-size: 0.8rem;
          margin: 16px 0 0;
        }
        .tiles {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .tile {
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: var(--ink-2);
          border: 1px solid var(--line);
          border-radius: 14px;
          padding: 22px;
          text-decoration: none;
          color: var(--star);
          transition: border-color 0.15s ease, transform 0.15s ease;
        }
        .tile:hover {
          border-color: var(--line-2);
          transform: translateY(-2px);
        }
        .tile-primary {
          grid-column: 1 / -1;
          border-left: 3px solid var(--horizon);
        }
        .tile-h {
          font-weight: 600;
          font-size: 1.02rem;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .tile-d {
          color: var(--star-dim);
          font-size: 0.88rem;
          line-height: 1.5;
        }
        .tile-go {
          color: var(--horizon);
          font-size: 0.85rem;
          margin-top: 6px;
        }
        .badge {
          background: var(--horizon);
          color: #1a1408;
          font-size: 0.72rem;
          font-weight: 700;
          border-radius: 999px;
          min-width: 20px;
          height: 20px;
          padding: 0 6px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .ft {
          padding-top: 40px;
          color: var(--muted);
        }
        @media (max-width: 540px) {
          .tiles {
            grid-template-columns: 1fr;
          }
          h1 {
            font-size: 1.4rem;
          }
        }
      `}</style>
    </>
  );
}
