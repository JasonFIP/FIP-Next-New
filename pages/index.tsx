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
import { useState } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import SkyBackground from '@/components/SkyBackground';
import InfoButton from '@/components/InfoButton';

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
  const [q, setQ] = useState('');
  const isAdvisor = !!user && ['admin', 'consultant', 'vet'].includes(user.role);

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/signin');
  }

  function go() {
    if (!user) {
      router.push('/signin');
      return;
    }
    const text = q.trim();
    router.push(text ? `/chat?q=${encodeURIComponent(text)}` : '/chat');
  }

  return (
    <>
      <SkyBackground labels />
      <Head>
        <title>Agvance Dairy Brain</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,380;9..144,460&display=swap"
          rel="stylesheet"
        />
      </Head>

      <nav className="topnav">
        {user ? (
          <>
            <span className="role">{ROLE_LABEL[user.role] ?? user.role}</span>
            {isAdvisor && (
              <Link href="/farms" className="navlink">
                Farms
              </Link>
            )}
            {isAdvisor && (
              <Link href="/review" className="navlink">
                Review{pendingCount > 0 ? ` (${pendingCount})` : ''}
              </Link>
            )}
            <button type="button" className="navlink" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <Link href="/signin" className="navlink">
            Sign in
          </Link>
        )}
      </nav>

      <header className="brandblock">
        <div className="mark">Agvance</div>
        <h1>Dairy&nbsp;Brain</h1>
        <div className="slogan">Success Together</div>
      </header>

      <main className="entry">
        <div className="composer">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') go();
            }}
            placeholder="Ask about your herd's nutrition…"
            aria-label="Ask about your herd's nutrition"
          />
          <Link
            href="/chat"
            className="ghost"
            aria-label="Upload a transcript or image"
            title="Upload transcript or image"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </Link>
          <Link
            href="/chat"
            className="ghost"
            aria-label="Dictate your question in chat"
            title="Speak"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="11" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v4" />
            </svg>
          </Link>
          <button
            type="button"
            className="go"
            onClick={go}
            aria-label={user ? 'Ask' : 'Sign in'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        </div>
        {!user && (
          <p className="invite">Sign in to start — access is by invitation.</p>
        )}
      </main>

      <InfoButton />

      <style jsx>{`
        .topnav {
          position: fixed;
          top: 18px;
          right: 22px;
          z-index: 5;
          display: flex;
          align-items: center;
          gap: 18px;
        }
        .role {
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--horizon);
          opacity: 0.85;
          border: 1px solid rgba(232, 185, 98, 0.3);
          border-radius: 999px;
          padding: 4px 10px;
        }
        .navlink {
          color: var(--star-dim);
          font-size: 13px;
          background: none;
          border: none;
          cursor: pointer;
          text-decoration: none;
          font-family: inherit;
          padding: 0;
        }
        .navlink:hover {
          color: var(--star);
        }

        .brandblock {
          position: fixed;
          top: clamp(22px, 6vh, 64px);
          left: 50%;
          transform: translateX(-50%);
          width: 100%;
          max-width: 760px;
          padding: 0 24px;
          text-align: center;
          z-index: 3;
        }
        .mark {
          font-size: 24px;
          letter-spacing: 0.34em;
          text-transform: uppercase;
          color: var(--horizon);
          opacity: 0.85;
          margin-bottom: 18px;
          font-weight: 500;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          text-shadow: 0 1px 12px rgba(0, 0, 0, 0.6);
        }
        .mark::before,
        .mark::after {
          content: '';
          width: 36px;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--horizon));
          opacity: 0.5;
        }
        .mark::after {
          background: linear-gradient(90deg, var(--horizon), transparent);
        }
        h1 {
          font-family: 'Fraunces', Georgia, serif;
          font-weight: 380;
          font-size: clamp(2.3rem, 6.6vw, 4.1rem);
          line-height: 1.02;
          letter-spacing: -0.01em;
          color: #fbfaf4;
          margin: 0;
          text-shadow: 0 2px 30px rgba(0, 0, 0, 0.55),
            0 0 40px rgba(120, 150, 220, 0.3);
        }
        .slogan {
          margin-top: 14px;
          font-size: clamp(0.7rem, 2.2vw, 0.84rem);
          letter-spacing: 0.46em;
          text-transform: uppercase;
          font-weight: 500;
          color: var(--horizon);
          opacity: 0.95;
          padding-left: 0.46em;
          text-shadow: 0 1px 12px rgba(0, 0, 0, 0.6);
        }

        .entry {
          position: fixed;
          inset: 0;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          transform: translateY(7vh);
        }
        .composer {
          width: min(620px, 92vw);
          background: rgba(11, 17, 34, 0.55);
          border: 1px solid var(--line-2);
          border-radius: 18px;
          padding: 8px 8px 8px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          backdrop-filter: blur(18px) saturate(1.2);
          -webkit-backdrop-filter: blur(18px) saturate(1.2);
          box-shadow: 0 28px 70px -30px rgba(0, 0, 0, 0.9),
            inset 0 1px 0 rgba(255, 255, 255, 0.07);
          transition: border-color 0.25s ease, box-shadow 0.25s ease;
        }
        .composer:focus-within {
          border-color: rgba(207, 224, 255, 0.45);
          box-shadow: 0 28px 80px -28px rgba(0, 0, 0, 0.92),
            0 0 0 1px rgba(207, 224, 255, 0.18);
        }
        .composer input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--star);
          font-size: 1rem;
          font-family: inherit;
          padding: 12px 0;
          min-width: 0;
        }
        .composer input::placeholder {
          color: rgba(194, 198, 214, 0.6);
        }
        .ghost {
          flex: none;
          width: 42px;
          height: 42px;
          border-radius: 11px;
          display: grid;
          place-items: center;
          border: 1px solid var(--line-2);
          color: var(--star-dim);
          text-decoration: none;
          transition: all 0.18s ease;
        }
        .ghost:hover {
          color: var(--star);
          border-color: rgba(207, 224, 255, 0.4);
        }
        .go {
          flex: none;
          width: 44px;
          height: 44px;
          border-radius: 13px;
          border: none;
          cursor: pointer;
          background: linear-gradient(160deg, #27456f, #16233f);
          color: #dce8ff;
          display: grid;
          place-items: center;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
          transition: transform 0.15s ease, filter 0.2s ease;
        }
        .go:hover {
          filter: brightness(1.18);
          transform: translateY(-1px);
        }
        .invite {
          margin-top: 18px;
          font-size: 0.85rem;
          color: var(--star-dim);
          text-shadow: 0 1px 10px rgba(0, 0, 0, 0.7);
        }

        @media (max-width: 560px) {
          .mark {
            letter-spacing: 0.24em;
          }
          .composer {
            gap: 8px;
            padding-left: 16px;
          }
          .ghost,
          .go {
            width: 40px;
            height: 40px;
          }
        }
      `}</style>
    </>
  );
}
