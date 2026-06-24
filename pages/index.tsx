/**
 * FIP backend — home page.
 *
 * Step 3 version: shifts focus from the harness checks to the actual product.
 * Health check is still shown (proves the backend is up) but the primary
 * action for signed-in advisors is "Open chat."
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
  anthropic_configured?: boolean;
  voyage_configured?: boolean;
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
        <title>FIP &middot; Farm Intelligence Platform</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <main className="container">
        <header>
          <span className="dot" />
          <span className="brand">FIP &middot; Farm Intelligence</span>
        </header>

        <section className="hero">
          <h1>Agvance Dairy Nutrition agent.</h1>
          <p className="sub">
            Grounded nutrition advice for NZ dairy consultants. Every answer is
            cited against the Agvance Dairy Brain knowledge base &mdash; product
            library, seasonal playbooks, premix range, peer-reviewed evidence
            notes, and feed reference tables.
          </p>

          <div style={{ display: 'flex', gap: 10, marginBottom: 48 }}>
            <Link
              href="/chat"
              style={{
                background: 'var(--horizon)',
                color: '#1a1408',
                padding: '12px 22px',
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
                letterSpacing: '0.01em',
              }}
            >
              Open chat &rarr;
            </Link>
            <Link
              href="/signin"
              style={{
                background: 'transparent',
                border: '1px solid var(--line-2)',
                color: 'var(--star-dim)',
                padding: '12px 22px',
                borderRadius: 10,
                fontSize: 14,
                textDecoration: 'none',
                letterSpacing: '0.01em',
              }}
            >
              Sign in
            </Link>
          </div>
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
                <span className="k">Anthropic</span>
                <span className="v">
                  {health.anthropic_configured ? 'configured' : 'not configured'}
                </span>
              </div>
              <div className="row">
                <span className="k">Voyage</span>
                <span className="v">
                  {health.voyage_configured ? 'configured' : 'not configured'}
                </span>
              </div>
            </div>
          )}
        </section>

        <footer>
          <small>
            FIP backend &middot; Agvance Dairy Nutrition agent &middot; step 3
            &middot; consultant mode
          </small>
        </footer>
      </main>
    </>
  );
}
