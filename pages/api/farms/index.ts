/**
 * /api/farms — farm management for advisors.
 *
 * GET    → farms the signed-in user can see (admins: all; others: the farms
 *          they have a membership on) + the region dropdown options.
 * POST   → create a farm and link the creating consultant as primary_consultant.
 * PATCH  → update a farm's profile (membership-checked).
 *
 * Auth pattern mirrors the chat API: verify the session with the server
 * client, then do privileged reads/writes with the service client after an
 * explicit membership check — so we never depend on RLS getting this right.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase-server';

const ADVISOR_ROLES = ['admin', 'consultant', 'vet'];
const EDIT_MEMBERSHIP = ['primary_consultant', 'consultant'];

// Pull only the known farm columns off the request body, coercing types.
function cleanFarmFields(body: any) {
  const num = (v: any) =>
    v === '' || v === null || v === undefined || isNaN(Number(v))
      ? null
      : Number(v);
  const str = (v: any) =>
    v === undefined ? undefined : v === '' || v === null ? null : String(v);
  const int = (v: any) =>
    v === '' || v === null || v === undefined ? null : parseInt(v, 10);

  const out: Record<string, any> = {
    name: body.name !== undefined ? String(body.name).trim() : undefined,
    region: body.region !== undefined ? String(body.region) : undefined,
    island: str(body.island),
    herd_size: body.herd_size === undefined ? undefined : int(body.herd_size),
    supply_company: str(body.supply_company),
    diet: str(body.diet),
    mineral_delivery: str(body.mineral_delivery),
    production_stage: str(body.production_stage),
    milk_urea: body.milk_urea === undefined ? undefined : num(body.milk_urea),
    milk_protein:
      body.milk_protein === undefined ? undefined : num(body.milk_protein),
    milk_fat: body.milk_fat === undefined ? undefined : num(body.milk_fat),
    herd_test_date:
      body.herd_test_date === undefined ? undefined : body.herd_test_date || null,
    notes: str(body.notes),
  };
  // Drop keys that weren't provided so PATCH only touches what changed.
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const supabase = createSupabaseServerClient(req, res);
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return res.status(401).json({ error: 'Not signed in' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, first_name')
    .eq('id', authUser.id)
    .single();
  if (!profile) return res.status(403).json({ error: 'No profile found' });

  const svc = createSupabaseServiceClient();
  const isAdmin = profile.role === 'admin';
  const isAdvisor = ADVISOR_ROLES.includes(profile.role);

  // ---------- GET: list visible farms + region options ----------
  if (req.method === 'GET') {
    let farms: any[] = [];
    if (isAdmin) {
      const { data } = await svc.from('farms').select('*').order('name');
      farms = data ?? [];
    } else {
      const { data: mems } = await svc
        .from('farm_memberships')
        .select('farm_id, membership_role')
        .eq('user_id', profile.id);
      const roleByFarm = new Map(
        (mems ?? []).map((m: any) => [m.farm_id, m.membership_role])
      );
      const ids = [...roleByFarm.keys()];
      if (ids.length) {
        const { data } = await svc
          .from('farms')
          .select('*')
          .in('id', ids)
          .order('name');
        farms = (data ?? []).map((f: any) => ({
          ...f,
          _membership_role: roleByFarm.get(f.id),
        }));
      }
    }
    const { data: regionOptions } = await svc.rpc('region_options');
    return res
      .status(200)
      .json({ farms, regionOptions: regionOptions ?? [], role: profile.role });
  }

  // ---------- POST: create a farm ----------
  if (req.method === 'POST') {
    if (!isAdvisor)
      return res.status(403).json({ error: 'Only advisors can create farms' });
    const fields = cleanFarmFields(req.body);
    if (!fields.name)
      return res.status(400).json({ error: 'Farm name is required' });
    if (!fields.region)
      return res.status(400).json({ error: 'Region is required' });

    const { data: farm, error } = await svc
      .from('farms')
      .insert(fields)
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });

    const { error: memErr } = await svc.from('farm_memberships').insert({
      farm_id: farm.id,
      user_id: profile.id,
      membership_role: 'primary_consultant',
    });
    if (memErr)
      return res.status(207).json({
        farm,
        warning: 'Farm created, but linking you to it failed: ' + memErr.message,
      });

    return res
      .status(201)
      .json({ farm: { ...farm, _membership_role: 'primary_consultant' } });
  }

  // ---------- PATCH: update a farm ----------
  if (req.method === 'PATCH') {
    const id = req.body?.id;
    if (!id) return res.status(400).json({ error: 'Farm id is required' });

    if (!isAdmin) {
      const { data: mem } = await svc
        .from('farm_memberships')
        .select('membership_role')
        .eq('farm_id', id)
        .eq('user_id', profile.id)
        .in('membership_role', EDIT_MEMBERSHIP)
        .maybeSingle();
      if (!mem)
        return res
          .status(403)
          .json({ error: 'You do not have edit access to this farm' });
    }

    const update = cleanFarmFields(req.body);
    // Never null out the required columns.
    if (update.name === null) delete update.name;
    if (update.region === null) delete update.region;
    update.updated_at = new Date().toISOString();

    const { data: farm, error } = await svc
      .from('farms')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ farm });
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'Method not allowed' });
}
