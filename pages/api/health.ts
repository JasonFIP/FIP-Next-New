/**
 * /api/health — does this backend actually work?
 *
 * Returns a JSON object showing which dependencies are configured. Step 2
 * adds Anthropic and Voyage. The KB check (whether ingestion has happened)
 * requires a database round-trip and is exposed separately at /api/health/kb.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  timestamp: string;
  environment: string;
  supabase_configured: boolean;
  anthropic_configured: boolean;
  voyage_configured: boolean;
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
      version: '0.4.0',
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV || 'local',
      supabase_configured: false,
      anthropic_configured: false,
      voyage_configured: false,
    });
  }

  const supabaseConfigured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  res.status(200).json({
    ok: true,
    service: 'fip-backend',
    version: '0.4.0',
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV || 'local',
    supabase_configured: supabaseConfigured,
    anthropic_configured: !!process.env.ANTHROPIC_API_KEY,
    voyage_configured: !!process.env.VOYAGE_API_KEY,
  });
}
