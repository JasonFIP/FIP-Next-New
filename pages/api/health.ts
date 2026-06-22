/**
 * /api/health — does this backend actually work?
 *
 * Returns a JSON object with no dependencies on Supabase, no database, no
 * Anthropic. If this responds with 200 OK, you have a working Next.js API
 * route on Vercel. Also reports whether Supabase env vars are present so
 * the deploy harness can confirm the secrets were added.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  timestamp: string;
  environment: string;
  supabase_configured: boolean;
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      ok: false,
      service: 'fip-backend',
      version: '0.2.0',
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV || 'local',
      supabase_configured: false,
    });
  }

  // Are the Supabase env vars set?
  // We check both since they're both needed for the auth flow.
  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  res.status(200).json({
    ok: true,
    service: 'fip-backend',
    version: '0.2.0',
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || 'local',
    supabase_configured: supabaseConfigured,
  });
}
