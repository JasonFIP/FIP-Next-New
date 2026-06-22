/**
 * Dashboard page (post sign-in).
 *
 * Minimal "you're signed in" landing page. The whole job of this page is to
 * prove that auth works end-to-end: protected route, server-side session
 * check, profile fetch, role display. When we add real features later, they
 * mount on top of this.
 *
 * Server-side props handle redirect-if-not-signed-in BEFORE the page renders,
 * so unauthenticated users never see a flash of dashboard content.
 */

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

type DashboardProps = {
  user: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    role: string;
    region: string | null;
  };
};

export const getServerSideProps: GetServerSideProps<DashboardProps> = async (
  ctx
) => {
  const supabase = createSupabaseServerClient(ctx.req as any, ctx.res as any);

  // Is there a session?
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return {
      redirect: {
        destination: '/signin',
        permanent: false,
      },
    };
  }

  // Fetch profile (joined to auth.users)
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, role, region')
    .eq('id', authUser.id)
    .single();

  if (error || !profile) {
    // Profile row missing — shouldn't happen post-trigger, but guard anyway
    return {
      redirect: {
        destination: '/signin',
        permanent: false,
      },
    };
  }

  return {
    props: {
      user: profile,
    },
  };
};

export default function Dashboard({
  user,
}: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/signin');
  }

  const displayName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ')
    .trim() || user.email;

  return (
    <>
      <Head>
        <title>Dashboard — FIP</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="container">
        <header>
          <span className="dot" />
          <span className="brand">FIP &middot; Farm Intelligence</span>
        </header>

        <section className="hero">
          <h1>Signed in.</h1>
          <p className="sub">
            You&rsquo;re signed in as {displayName}. This page is protected by
            the Supabase session cookie. Unauthenticated requests redirect to
            sign-in before this page renders.
          </p>
        </section>

        <section className="health">
          <h2>Your profile</h2>
          <div className="card ok">
            <div className="row">
              <span className="k">Name</span>
              <span className="v">{displayName}</span>
            </div>
            <div className="row">
              <span className="k">Email</span>
              <span className="v">{user.email}</span>
            </div>
            <div className="row">
              <span className="k">Role</span>
              <span className="v">{user.role}</span>
            </div>
            <div className="row">
              <span className="k">Region</span>
              <span className="v">{user.region ?? 'not set'}</span>
            </div>
            <div className="row">
              <span className="k">User ID</span>
              <span className="v" style={{ fontSize: 11 }}>
                {user.id}
              </span>
            </div>
          </div>
        </section>

        <section className="next">
          <h2>What this proves</h2>
          <ul>
            <li>Server-side auth check works (redirect if not signed in)</li>
            <li>Session cookies persist across requests</li>
            <li>Profile row was auto-created from the auth user</li>
            <li>Role-based access control is wired (visible on this row)</li>
          </ul>
          <h2>What this does not prove</h2>
          <ul>
            <li>RAG retrieval (KB ingestion is the next step)</li>
            <li>Anthropic API calls from this backend</li>
            <li>The agent itself answers questions</li>
          </ul>
        </section>

        <section style={{ marginTop: 48 }}>
          <button
            onClick={handleSignOut}
            style={{
              background: 'transparent',
              border: '1px solid rgba(242,240,230,0.14)',
              color: '#c9c6b8',
              padding: '10px 22px',
              borderRadius: 999,
              fontFamily: 'inherit',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </section>

        <footer>
          <small>
            FIP backend &middot; signed-in user dashboard. The real product UI
            comes later.
          </small>
        </footer>
      </main>
    </>
  );
}
