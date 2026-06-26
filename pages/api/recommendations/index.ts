/**
 * GET /api/recommendations
 *
 * Role-aware listing of sign-off-gate recommendations.
 *
 *   - Advisor (admin/consultant/vet): the REVIEW QUEUE — drafts for farms
 *     they advise. Defaults to state='pending_review'; pass ?state=approved
 *     (etc.) to widen. RLS ("Advisors read advised-farm recommendations")
 *     already restricts rows to farms the advisor is a member of, so a
 *     consultant only ever sees their own farms' drafts.
 *
 *   - Farmer: their OWN recommendations (the inbox, wired into the UI in a
 *     later increment). RLS ("Drafter reads own") restricts to their drafts.
 *
 * Rows are enriched with farm name + farmer/reviewer display names so the
 * UI doesn't need extra round-trips. Enrichment uses the same authenticated
 * client, so it's still RLS-guarded (advisors may read all profiles/farms;
 * farmers read their own farm).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase-server';

const ADVISOR_ROLES = ['admin', 'consultant', 'vet'];
const VALID_STATES = ['draft', 'pending_review', 'approved', 'rejected', 'expired'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = createSupabaseServerClient(req, res);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) {
    return res.status(403).json({ error: 'No profile found' });
  }

  const isAdvisor = ADVISOR_ROLES.includes(profile.role);

  // Build the base query. RLS does the security; this just shapes the view.
  let query = supabase
    .from('recommendations')
    .select(
      'id, farm_id, drafted_by, reviewed_by, state, title, summary, reasoning, caveats, review_notes, drafted_at, reviewed_at, farm_data_snapshot'
    );

  if (isAdvisor) {
    // The queue. Default to pending_review; allow widening via ?state=.
    const requested =
      typeof req.query.state === 'string' ? req.query.state : 'pending_review';
    if (!VALID_STATES.includes(requested)) {
      return res.status(400).json({
        error: `state must be one of: ${VALID_STATES.join(', ')}`,
      });
    }
    query = query
      .eq('state', requested)
      .order('drafted_at', { ascending: true }); // oldest first = act on them in order
  } else {
    // Farmer inbox: their own drafts, newest first.
    query = query
      .eq('drafted_by', profile.id)
      .order('drafted_at', { ascending: false });
  }

  const { data: recs, error: recError } = await query.limit(100);
  if (recError) {
    return res.status(500).json({ error: recError.message });
  }
  const rows = recs ?? [];

  // -- Enrich: farm names + drafter/reviewer display names --
  const farmIds = [...new Set(rows.map((r) => r.farm_id).filter(Boolean))];
  const personIds = [
    ...new Set(
      rows
        .flatMap((r) => [r.drafted_by, r.reviewed_by])
        .filter(Boolean) as string[]
    ),
  ];

  const farmNames: Record<string, string> = {};
  if (farmIds.length > 0) {
    const { data: farms } = await supabase
      .from('farms')
      .select('id, name')
      .in('id', farmIds);
    for (const f of farms ?? []) farmNames[f.id] = f.name;
  }

  const personNames: Record<string, string> = {};
  if (personIds.length > 0) {
    const { data: people } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', personIds);
    for (const p of people ?? []) {
      personNames[p.id] =
        [p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email;
    }
  }

  const recommendations = rows.map((r) => ({
    ...r,
    farm_name: r.farm_id ? farmNames[r.farm_id] ?? null : null,
    drafted_by_name: r.drafted_by ? personNames[r.drafted_by] ?? null : null,
    reviewed_by_name: r.reviewed_by ? personNames[r.reviewed_by] ?? null : null,
  }));

  return res.status(200).json({ recommendations, role: profile.role });
}
