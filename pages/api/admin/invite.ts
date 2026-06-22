/**
 * /api/admin/invite — admin-only endpoint to invite new users.
 *
 * Usage: POST /api/admin/invite with body { email, role, first_name?, last_name? }
 *
 * Authorization: only callable by users whose profile.role = 'admin'.
 * Verified server-side via the session cookie + profile lookup.
 *
 * The role on the new user is set via raw_user_meta_data so the
 * handle_new_auth_user trigger picks it up when the profile row is auto-created.
 *
 * Supabase sends the invite email; the link lands the user at /accept-invite
 * where they set their password.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase-server';

type InviteRequest = {
  email: string;
  role: 'admin' | 'consultant' | 'vet' | 'farmer';
  first_name?: string;
  last_name?: string;
};

type InviteResponse =
  | { ok: true; user_id: string; email: string }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<InviteResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Step 1: verify the caller is signed in
  const supabase = createSupabaseServerClient(req, res);
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return res.status(401).json({ ok: false, error: 'Not signed in' });
  }

  // Step 2: verify the caller is an admin (DB check, not trust client claim)
  const { data: callerProfile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', authUser.id)
    .single();

  if (profileError || callerProfile?.role !== 'admin') {
    return res
      .status(403)
      .json({ ok: false, error: 'Admin role required to invite users' });
  }

  // Step 3: validate the request body
  const body = req.body as Partial<InviteRequest>;

  if (!body.email || typeof body.email !== 'string') {
    return res.status(400).json({ ok: false, error: 'Email is required' });
  }
  if (
    !body.role ||
    !['admin', 'consultant', 'vet', 'farmer'].includes(body.role)
  ) {
    return res.status(400).json({
      ok: false,
      error: 'Role must be admin, consultant, vet, or farmer',
    });
  }

  const email = body.email.trim().toLowerCase();
  const role = body.role;

  // Step 4: use the service-role client to send the invite. We're already
  // through the auth + role check, so this is safe.
  let serviceClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error:
        'Service role not configured. Set SUPABASE_SERVICE_ROLE_KEY in env.',
    });
  }

  // Construct the redirect URL the invite link will use
  const redirectBase =
    process.env.NEXT_PUBLIC_SITE_URL ||
    `https://${req.headers.host}`;

  const { data: inviteData, error: inviteError } =
    await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${redirectBase}/accept-invite`,
      data: {
        role,
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
      },
    });

  if (inviteError) {
    return res
      .status(400)
      .json({ ok: false, error: inviteError.message });
  }

  if (!inviteData?.user) {
    return res.status(500).json({
      ok: false,
      error: 'Invite succeeded but no user returned',
    });
  }

  return res.status(200).json({
    ok: true,
    user_id: inviteData.user.id,
    email: inviteData.user.email ?? email,
  });
}
