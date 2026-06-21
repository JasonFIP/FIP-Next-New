/**
 * FIP backend — home page.
 *
 * The minimum useful "is this thing on?" page. If you can see this rendered
 * from your iPad Safari, the Next.js deployment pipeline works end to end.
 *
 * Once the deploy is bulletproof, this page gets replaced with the real FIP
 * conversational UI from fip-prototype.html. For now, this is step 0.
 */

import Head from 'next/head';
import { useEffect, useState } from 'react';

interface HealthCheck {
  ok: boolean;
  service: string;
  version: string;
  timestamp: string;
  environment: string;
  error?: string;
}

export default function Home() {
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  // On load, hit our own /api/health endpoint. This proves both the page
  // renders AND the API route works — two halves of the pipeline.
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
            Step 0 of the Agvance Dairy Nutrition agent rollout. If you can read
            this and the health check below shows OK, the Next.js &rarr; Vercel
            pipeline is working from your iPad.
          </p>
        </section>

        <section className="health">
          <h2>Health check</h2>
          {healthError && (
            <div className="card error">
              <strong>Error reaching /api/health</strong>
              <code>{healthError}</code>
              <p>
                If this shows, the page rendered but the API route failed.
                That's a different problem than no deployment at all &mdash; it
                usually means the API route file is in the wrong place.
              </p>
            </div>
          )}
          {!health && !healthError && (
            <div className="card loading">Checking&hellip;</div>
          )}
          {health && (
            <div className="card ok">
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
                <span className="k">Server time</span>
                <span className="v">
                  {new Date(health.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="next">
          <h2>What this proves</h2>
          <ul>
            <li>The Next.js page renders &mdash; React is mounted</li>
            <li>The /api/health endpoint responds &mdash; serverless routes work</li>
            <li>Page-to-API fetch works &mdash; client/server pipeline is wired</li>
            <li>Vercel deployment from GitHub via Working Copy is functional</li>
          </ul>
          <h2>What this does not prove</h2>
          <ul>
            <li>Supabase is connected (next step)</li>
            <li>Anthropic API works from this backend (step after that)</li>
            <li>The KB ingestion or RAG layer exists (much later)</li>
          </ul>
        </section>

        <footer>
          <small>
            This is the FIP backend deployment harness. Not a real product page.
            See the FIP prototype for the actual UI.
          </small>
        </footer>
      </main>
    </>
  );
}
