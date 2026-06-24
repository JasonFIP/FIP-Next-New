/**
 * GET  /api/conversations         — list current user's conversations
 * POST /api/conversations         — create a new empty conversation
 *
 * Returns conversations ordered by most-recently-updated, with the most
 * recent message preview for the sidebar.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const supabase = createSupabaseServerClient(req, res);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, mode, created_at, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ conversations: data ?? [] });
  }

  if (req.method === 'POST') {
    // Create an empty conversation. Title gets set when first message arrives.
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        user_id: user.id,
        mode: 'consultant',
        title: 'New conversation',
      })
      .select('id, title, mode, created_at, updated_at')
      .single();

    if (error || !data) {
      return res.status(500).json({
        error: `Failed to create conversation: ${error?.message}`,
      });
    }

    return res.status(200).json({ conversation: data });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
