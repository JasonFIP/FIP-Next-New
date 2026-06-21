/**
 * /api/health — does this backend actually work?
 *
 * The simplest possible API route. Returns a JSON object with no dependencies
 * on Supabase, no database, no Anthropic. If this responds with 200 OK, you
 * have a working Next.js API route on Vercel. That's step 0.
 *
 * Hit it directly: https://YOUR-DEPLOYMENT.vercel.app/api/health
 * Or via the home page, which fetches and displays the result.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
  timestamp: string;
  environment: string;
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse>
) {
  // Only respond to GET. Anything else is a misconfigured client.
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      ok: false,
      service: 'fip-backend',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      environment: process.env.VERCEL_ENV || 'local',
    });
  }

  res.status(200).json({
    ok: true,
    service: 'fip-backend',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    // VERCEL_ENV is set automatically by Vercel ('production', 'preview',
    // 'development'). Falls back to 'local' when running `npm run dev`.
    environment: process.env.VERCEL_ENV || 'local',
  });
}
