/**
 * GET  /api/recommendations/[id]   — fetch one recommendation (RLS-guarded)
 * POST /api/recommendations/[id]   — an advisor actions a draft
 *
 * POST body:
 *   { action: 'approve', edited_title?, edited_summary?, review_notes? }
 *   { action: 'reject',  review_notes }   // notes required on reject
 *
 * "Edit-then-approve" is just an approve with edited_title/edited_summary
 * present — the consultant's version overwrites the draft text, the original
 * is preserved in conversation history (the assistant message is untouched).
 *
 * Only advisors may action, and RLS ("Advisors update recommendations")
 * further restricts updates to farms the advisor is a member of — so a
 * consultant can't approve a draft for a farm they don't advise even if they
 * guess the id.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

const ADVISOR_ROLES = ['admin', 'consultant', 'vet'];

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (!profile) {
    return res.status(403).json({ error: 'No profile found' });
  }

  // -- GET one --
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('recommendations')
      .select('*')
      .eq('id', id)
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Not found or not accessible' });
    }
    return res.status(200).json({ recommendation: data });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // -- POST: action a draft (advisors only) --
  if (!ADVISOR_ROLES.includes(profile.role)) {
    return res
      .status(403)
      .json({ error: 'Only consultants and vets can review recommendations' });
  }

  const body = req.body as {
    action?: string;
    edited_title?: string | null;
    edited_summary?: string | null;
    review_notes?: string | null;
  };

  if (body.action !== 'approve' && body.action !== 'reject') {
    return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
  }
  if (body.action === 'reject' && !body.review_notes?.trim()) {
    return res
      .status(400)
      .json({ error: 'A reason (review_notes) is required to reject' });
  }

  // Confirm the draft is still actionable (not already approved/rejected).
  const { data: current, error: currentError } = await supabase
    .from('recommendations')
    .select('id, state')
    .eq('id', id)
    .single();
  if (currentError || !current) {
    return res.status(404).json({ error: 'Not found or not accessible' });
  }
  if (!['draft', 'pending_review'].includes(current.state)) {
    return res.status(409).json({
      error: `This recommendation is already ${current.state} and can't be re-actioned.`,
    });
  }

  // Build the update.
  const update: Record<string, unknown> = {
    reviewed_by: profile.id,
    reviewed_at: new Date().toISOString(),
    review_notes: body.review_notes?.trim() || null,
  };

  if (body.action === 'approve') {
    update.state = 'approved';
    if (body.edited_title?.trim()) update.title = body.edited_title.trim();
    if (body.edited_summary?.trim()) update.summary = body.edited_summary.trim();
  } else {
    update.state = 'rejected';
  }

  const { data: updated, error: updateError } = await supabase
    .from('recommendations')
    .update(update)
    .eq('id', id)
    .select(
      'id, state, title, summary, reasoning, review_notes, reviewed_by, reviewed_at'
    )
    .single();

  if (updateError || !updated) {
    return res.status(500).json({
      error: `Failed to ${body.action}: ${updateError?.message ?? 'unknown'}`,
    });
  }

  return res.status(200).json({ recommendation: updated });
}
