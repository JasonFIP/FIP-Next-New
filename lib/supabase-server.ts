/**
 * Supabase client for server-side use (API routes, getServerSideProps).
 *
 * Reads the session cookie from the incoming request rather than the browser,
 * so server code knows which user is making the call.
 *
 * Two variants:
 *   - createSupabaseServerClient(req, res) — for API routes (uses NextApiRequest/Response)
 *     Uses the publishable key + RLS for security.
 *   - createSupabaseServiceClient() — uses the service_role key, BYPASSES RLS.
 *     Only use for: invite flow, admin operations, schema migrations. Never
 *     expose to a route a regular user can hit.
 */

import { createServerClient, serializeCookieHeader } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Server client tied to the current request's session.
 * Use this in API routes that should respect RLS (most routes).
 */
export function createSupabaseServerClient(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase env vars on server.');
  }

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return Object.entries(req.cookies).map(([name, value]) => ({
          name,
          value: value ?? '',
        }));
      },
      setAll(cookies) {
        const setCookieHeaders = cookies.map(({ name, value, options }) =>
          serializeCookieHeader(name, value, options)
        );
        // Append, don't replace — there may already be cookies set in the response
        const existing = res.getHeader('Set-Cookie');
        if (existing) {
          res.setHeader(
            'Set-Cookie',
            Array.isArray(existing)
              ? [...existing, ...setCookieHeaders]
              : [String(existing), ...setCookieHeaders]
          );
        } else {
          res.setHeader('Set-Cookie', setCookieHeaders);
        }
      },
    },
  });
}

/**
 * Service-role client. BYPASSES RLS. Treat with extreme care.
 *
 * Only used for:
 *   - Inviting new users (auth.admin.inviteUserByEmail)
 *   - Admin-only setup tasks
 *   - Migrations
 *
 * Never call this from a route that a regular user can hit without an
 * explicit role check first.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing service role env vars. Set SUPABASE_SERVICE_ROLE_KEY in ' +
        'Vercel project settings. Never commit this key to git.'
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
