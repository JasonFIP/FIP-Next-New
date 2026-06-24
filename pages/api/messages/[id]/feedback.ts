/**
 * POST /api/messages/[id]/feedback
 *
 * Captures feedback on an individual assistant message. This is the data
 * behind the Option A continuous-learning loop: failures get reviewed by
 * humans, the KB gets edited, re-ingestion improves performance.
 *
 * Body shape:
 *   {
 *     kind: 'thumbs_up' | 'thumbs_down' | 'correction' | 'rejected' | 'flag',
 *     reason?: 'stale_figure' | 'wrong_product' | ... (optional)
 *     notes?: string (optional)
 *     corrected_text?: string (only for kind=correction)
 *   }
 *
 * Upserts on (message_id, user_id) so re-clicking thumbs replaces prior
 * feedback rather than creating duplicates.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

const VALID_KINDS = [
  'thumbs_up',
  'thumbs_down',
  'correction',
  'rejected',
  'flag',
];

const VALID_REASONS = [
  'stale_figure',
  'wrong_product',
  'nz_context_missed',
  'phosphate_p_confusion',
  'narrow_safety_margin',
  'diagnosis_creep',
  'hierarchy_violated',
  'hallucination',
  'other',
];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  // Parse + validate body
  const body = req.body as {
    kind?: string;
    reason?: string | null;
    notes?: string | null;
    corrected_text?: string | null;
  };

  if (!body.kind || !VALID_KINDS.includes(body.kind)) {
    return res.status(400).json({
      error: `kind must be one of: ${VALID_KINDS.join(', ')}`,
    });
  }
  if (body.reason && !VALID_REASONS.includes(body.reason)) {
    return res.status(400).json({
      error: `reason must be one of: ${VALID_REASONS.join(', ')}`,
    });
  }

  // Verify the message exists and is accessible (RLS will block if not)
  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .select('id, conversation_id, role')
    .eq('id', id)
    .single();

  if (msgError || !msg) {
    return res.status(404).json({ error: 'Message not found or not accessible' });
  }

  // Only feedback on assistant messages
  if (msg.role !== 'assistant') {
    return res.status(400).json({
      error: 'Feedback can only be left on assistant messages',
    });
  }

  // Upsert feedback. Use a manual approach since we need to handle
  // the (message_id, user_id) uniqueness ourselves.
  // First check if existing feedback exists
  const { data: existing } = await supabase
    .from('message_feedback')
    .select('id')
    .eq('message_id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    // Update
    const { error: updateError } = await supabase
      .from('message_feedback')
      .update({
        kind: body.kind,
        reason: body.reason ?? null,
        notes: body.notes ?? null,
        corrected_text: body.corrected_text ?? null,
      })
      .eq('id', existing.id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }
  } else {
    // Insert
    const { error: insertError } = await supabase
      .from('message_feedback')
      .insert({
        message_id: id,
        user_id: user.id,
        kind: body.kind,
        reason: body.reason ?? null,
        notes: body.notes ?? null,
        corrected_text: body.corrected_text ?? null,
      });

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }
  }

  return res.status(200).json({ ok: true });
}
