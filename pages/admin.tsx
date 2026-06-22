/**
 * /admin — admin-only management page.
 *
 * Currently just hosts the invite form. Will grow into farm management,
 * KB upload UI, etc. as we add features.
 *
 * Protected at both layers:
 *   - getServerSideProps redirects non-admins server-side
 *   - The /api/admin/invite endpoint also checks role independently
 *
 * Defense in depth: even if you skip the page check via direct API call,
 * the API still requires admin role.
 */

import { useState } from 'react';
import Head from 'next/head';
import type { GetServerSideProps } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type Props = {
  adminEmail: string;
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
    .select('role, email')
    .eq('id', authUser.id)
    .single();

  if (profile?.role !== 'admin') {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }

  return { props: { adminEmail: profile.email } };
};

export default function AdminPage({ adminEmail }: Props) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'admin' | 'consultant' | 'vet' | 'farmer'>(
    'consultant'
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);

    try {
      const response = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          role,
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setError(data.error || 'Invite failed');
        setLoading(false);
        return;
      }

      setResult(
        `Invite sent to ${data.email}. They will receive an email with a link to set their password.`
      );
      setEmail('');
      setFirstName('');
      setLastName('');
      setLoading(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unexpected error sending invite'
      );
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Admin — FIP</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="container">
        <header>
          <span className="dot" />
          <span className="brand">FIP &middot; Admin</span>
        </header>

        <section className="hero">
          <h1>Admin.</h1>
          <p className="sub">
            Signed in as {adminEmail}. Use this page to invite consultants,
            vets, and farmers. Each invite goes to an email address; the
            recipient sets their own password via the invite link.
          </p>
        </section>

        <section className="health">
          <h2>Invite a user</h2>
          <div className="card">
            <form onSubmit={handleSubmit} style={{ display: 'block' }}>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </label>

              <label>
                <span>First name (optional)</span>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={loading}
                />
              </label>

              <label>
                <span>Last name (optional)</span>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={loading}
                />
              </label>

              <label>
                <span>Role</span>
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(
                      e.target.value as
                        | 'admin'
                        | 'consultant'
                        | 'vet'
                        | 'farmer'
                    )
                  }
                  disabled={loading}
                >
                  <option value="consultant">Consultant</option>
                  <option value="vet">Vet</option>
                  <option value="farmer">Farmer</option>
                  <option value="admin">Admin</option>
                </select>
              </label>

              {error && <div className="auth-error">{error}</div>}
              {result && <div className="auth-success">{result}</div>}

              <button type="submit" disabled={loading}>
                {loading ? 'Sending&hellip;' : 'Send invite'}
              </button>
            </form>
          </div>
        </section>

        <section className="next">
          <h2>Pilot users to invite</h2>
          <ul>
            <li>Cristina H &mdash; consultant</li>
            <li>Christo V &mdash; consultant</li>
            <li>Chris B &mdash; consultant</li>
          </ul>
        </section>
      </main>
    </>
  );
}
