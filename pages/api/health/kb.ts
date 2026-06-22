/**
 * /api/health/kb — has the KB been ingested?
 *
 * Reads kb_documents to confirm content exists. Used after running the
 * ingestion script locally, to confirm Vercel/Supabase can see what was
 * uploaded. Read-only.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

interface KbHealthResponse {
  ok: boolean;
  documents_count: number;
  chunks_count: number;
  discontinued_count: number;
  documents: Array<{
    source_name: string;
    title: string;
    chunk_count: number;
    ingested_at: string;
  }>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<KbHealthResponse | { ok: false; error: string }>
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Requires authenticated session — even reading kb_documents needs sign-in
  // per the RLS policy. This endpoint is for admins/consultants to verify
  // ingestion worked.
  const supabase = createSupabaseServerClient(req, res);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return res.status(401).json({ ok: false, error: 'Sign in required' });
  }

  try {
    const { data: docs, error: docsError } = await supabase
      .from('kb_documents')
      .select('source_name, title, chunk_count, ingested_at')
      .order('source_name');

    if (docsError) throw new Error(docsError.message);

    const { count: chunksCount } = await supabase
      .from('kb_chunks')
      .select('*', { count: 'exact', head: true });

    const { count: discontinuedCount } = await supabase
      .from('kb_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('is_discontinued', true);

    return res.status(200).json({
      ok: true,
      documents_count: docs?.length ?? 0,
      chunks_count: chunksCount ?? 0,
      discontinued_count: discontinuedCount ?? 0,
      documents: (docs ?? []).map((d) => ({
        source_name: d.source_name,
        title: d.title,
        chunk_count: d.chunk_count,
        ingested_at: d.ingested_at,
      })),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
