/**
 * Supabase client for the browser.
 *
 * Used in React components that need to read user data, call auth methods,
 * or subscribe to realtime updates. Session is stored in cookies (handled by
 * @supabase/ssr) so it works with Next.js SSR.
 *
 * NEVER import this in API routes or server-side rendering — those need the
 * server client from supabase-server.ts so session cookies are read from the
 * incoming request, not from window.document.cookie.
 */

import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    // Fail loudly during development. In production these are baked into the
    // build by Next.js, so a missing env var would have failed the deploy.
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (dev) or in ' +
        'the Vercel project environment variables (production).'
    );
  }

  return createBrowserClient(url, key);
}
