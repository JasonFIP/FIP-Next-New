/**
 * FIP backend — home page.
 *
 * Step 1 version: still shows the health check (proves backend is up), but
 * now also offers a way into sign-in / dashboard.
 */

import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface HealthCheck {
  ok: boolean;
  service: string;
  version: string;
  timestamp: string;
  environment: string;
  supabase_configured?: boolean;
  error?: string;
}

export default function Home() {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: HealthCheck) => setHealth(data))
      .catch((err: Error) => setHealthError(err.message));
  }, []);

  return (
    <>
      <Head>
        <title>FIP Backend</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="container">
        <header>
          <span className="dot" />
          <span className="brand">FIP &middot; Farm Intelligence</span>
        </header>

        <section className="hero">
          <h1>Backend deployed.</h1>
          <p className="sub">
            Step 1 of the Agvance Dairy Nutrition agent rollout: Supabase
            auth wired into the deployment harness. Health check below
            confirms the backend is up and that Supabase env vars are set.
          </p>
        </section>

        <section className="health">
          <h2>Health check</h2>
          {healthError && (
            <div className="card error">
              <strong>Error reaching /api/health</strong>
              <code>{healthError}</code>
            </div>
          )}
          {!health && !healthError && (
            <div className="card loading">Checking&hellip;</div>
          )}
          {health && (
            <div className={`card ${health.ok ? 'ok' : 'error'}`}>
              <div className="row">
                <span className="k">Status</span>
                <span className="v">{health.ok ? 'OK' : 'DEGRADED'}</span>
              </div>
              <div className="row">
                <span className="k">Service</span>
                <span className="v">{health.service}</span>
              </div>
              <div className="row">
                <span className="k">Version</span>
                <span className="v">{health.version}</span>
              </div>
              <div className="row">
                <span className="k">Environment</span>
                <span className="v">{health.environment}</span>
              </div>
              <div className="row">
                <span className="k">Supabase</span>
                <span className="v">
                  {health.supabase_configured ? 'configured' : 'not configured'}
                </span>
              </div>
              <div className="row">
                <span className="k">Server time</span>
                <span className="v">
                  {new Date(health.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="next">
          <h2>Sign in</h2>
          <ul>
            <li>
              <Link href="/signin">Sign in</Link> &mdash; existing users
            </li>
            <li>
              <Link href="/dashboard">Dashboard</Link> &mdash; signed-in users
              only (redirects to sign-in if not authed)
            </li>
          </ul>

          <h2>What this proves</h2>
          <ul>
            <li>The Next.js page renders</li>
            <li>The /api/health endpoint responds</li>
            <li>Supabase env vars are set (if &ldquo;configured&rdquo; shows)</li>
            <li>Auth flow (sign in, sign out) works via Supabase</li>
          </ul>
          <h2>What this does not prove</h2>
          <ul>
            <li>The KB ingestion or RAG layer exists (step 2)</li>
            <li>Anthropic API works from this backend (step 3)</li>
            <li>The agent itself answers questions (step 3)</li>
          </ul>
        </section>

        <footer>
          <small>
            FIP backend deployment harness. Real product UI to come.
          </small>
        </footer>
      </main>
    </>
  );
}
