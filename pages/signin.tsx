/**
 * Sign-in page.
 *
 * Email + password auth (per Jason's choice). No magic links. No social.
 * Pilot users (Cristina, Christo, Chris) are invited by the admin; they
 * accept the invite at /accept-invite and set their password there. After
 * that, they sign in here.
 *
 * On success: redirects to /dashboard. On failure: shows the error inline.
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import SkyBackground from '@/components/SkyBackground';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      // On success the session cookie is set. Redirect to dashboard.
      // Using router.push with a small delay to let the cookie persist.
      router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unexpected error signing in'
      );
      setLoading(false);
    }
  }

  return (
    <>
      <SkyBackground />
      <Head>
        <title>Sign in — FIP</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="auth-container">
        <header className="auth-header">
          <span className="dot" />
          <span className="brand">Agvance &middot; Dairy Brain</span>
        </header>
        <div
          style={{
            textAlign: 'center',
            fontSize: 11,
            letterSpacing: '0.42em',
            textTransform: 'uppercase',
            color: 'var(--horizon, #e8b962)',
            opacity: 0.9,
            fontWeight: 500,
            marginBottom: 22,
            paddingLeft: '0.42em',
          }}
        >
          Success Together
        </div>

        <section className="auth-card">
          <h1>Sign in</h1>
          <p className="sub">
            Welcome back. Sign in with the email address your invite was sent
            to.
          </p>

          <form onSubmit={handleSubmit}>
            <label>
              <span>Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </label>

            <label>
              <span>Password</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </label>

            {error && <div className="auth-error">{error}</div>}

            <button type="submit" disabled={loading}>
              {loading ? 'Signing in&hellip;' : 'Sign in'}
            </button>
          </form>

          <div className="auth-foot">
            New here? Accounts are invitation-only. Contact the admin to
            request access.
          </div>
        </section>
      </main>
    </>
  );
}
