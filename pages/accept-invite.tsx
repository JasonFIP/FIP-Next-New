/**
 * Accept-invite page.
 *
 * When the admin invites a user via Supabase's auth.admin.inviteUserByEmail(),
 * Supabase sends an email with a link that lands here. The link includes an
 * access token that establishes a temporary session, allowing the user to
 * set their password.
 *
 * Flow:
 *   1. User clicks link in email -> lands here with auth tokens in URL hash
 *   2. Supabase's auth listener picks up the tokens and establishes session
 *   3. User enters their name + new password -> we call updateUser()
 *   4. Redirect to /dashboard
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function AcceptInvite() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  // Wait for Supabase to pick up the auth tokens from the URL hash
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    // Check if we have a session right away
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSessionReady(true);
      }
    });

    // Or listen for the SIGNED_IN event that fires after Supabase processes
    // the URL fragment from the invite link
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
          setSessionReady(true);
        }
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();

      // Set the password
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        },
      });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      // Also update the profile row directly so name fields populate
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        })
        .eq('id', (await supabase.auth.getUser()).data.user?.id);

      if (profileError) {
        // Non-fatal — the trigger should also handle this via raw_user_meta_data
        console.warn('Profile update failed:', profileError);
      }

      router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unexpected error setting password'
      );
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Set your password — FIP</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="auth-container">
        <header className="auth-header">
          <span className="dot" />
          <span className="brand">FIP &middot; Farm Intelligence</span>
        </header>

        <section className="auth-card">
          <h1>Welcome</h1>
          <p className="sub">
            Set your password to finish creating your account. You&rsquo;ll
            sign in with this from now on.
          </p>

          {!sessionReady && (
            <div className="auth-note">
              Verifying your invite link&hellip;
            </div>
          )}

          {sessionReady && (
            <form onSubmit={handleSubmit}>
              <label>
                <span>First name</span>
                <input
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={loading}
                />
              </label>

              <label>
                <span>Last name</span>
                <input
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={loading}
                />
              </label>

              <label>
                <span>Password</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
              </label>

              <label>
                <span>Confirm password</span>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                />
              </label>

              {error && <div className="auth-error">{error}</div>}

              <button type="submit" disabled={loading}>
                {loading ? 'Saving&hellip;' : 'Save and continue'}
              </button>
            </form>
          )}
        </section>
      </main>
    </>
  );
}
