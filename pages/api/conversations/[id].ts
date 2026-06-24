/**
 * GET    /api/conversations/[id]  — full conversation + messages
 * DELETE /api/conversations/[id]  — delete conversation (cascades messages)
 *
 * RLS enforces ownership at the DB layer; we also check at API layer
 * for clearer error responses.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'invalid id' });
  }

  const supabase = createSupabaseServerClient(req, res);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  if (req.method === 'GET') {
    // Get the conversation (RLS will reject if not owner)
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, title, mode, created_at, updated_at')
      .eq('id', id)
      .single();

    if (convError || !conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Get messages in order
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('id, role, content, created_at, model, input_tokens, output_tokens')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (msgError) {
      return res.status(500).json({ error: msgError.message });
    }

    // Get citations for all assistant messages in one query
    const assistantMessageIds = (messages ?? [])
      .filter((m) => m.role === 'assistant')
      .map((m) => m.id);

    let citationsByMessage: Record<
      string,
      Array<{
        chunk_ref: string;
        source_doc: string;
        source_section: string | null;
        snippet: string | null;
      }>
    > = {};

    if (assistantMessageIds.length > 0) {
      const { data: citations } = await supabase
        .from('kb_citations')
        .select('message_id, chunk_ref, source_doc, source_section, snippet')
        .in('message_id', assistantMessageIds);

      for (const c of citations ?? []) {
        if (!citationsByMessage[c.message_id]) {
          citationsByMessage[c.message_id] = [];
        }
        citationsByMessage[c.message_id].push({
          chunk_ref: c.chunk_ref,
          source_doc: c.source_doc,
          source_section: c.source_section,
          snippet: c.snippet,
        });
      }
    }

    // Get feedback by current user on these messages
    const { data: feedback } = await supabase
      .from('message_feedback')
      .select('message_id, kind, reason, notes')
      .in('message_id', (messages ?? []).map((m) => m.id))
      .eq('user_id', user.id);

    const feedbackByMessage: Record<
      string,
      { kind: string; reason: string | null; notes: string | null }
    > = {};
    for (const f of feedback ?? []) {
      feedbackByMessage[f.message_id] = {
        kind: f.kind,
        reason: f.reason,
        notes: f.notes,
      };
    }

    return res.status(200).json({
      conversation,
      messages: (messages ?? []).map((m) => ({
        ...m,
        citations: citationsByMessage[m.id] ?? [],
        feedback: feedbackByMessage[m.id] ?? null,
      })),
    });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true });
  }

  res.setHeader('Allow', 'GET, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
