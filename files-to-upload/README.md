# FIP Backend — step 1

This is step 1 of the Agvance Dairy Nutrition agent rollout. Adds Supabase
authentication, the database schema, and the admin invite flow onto the
working step 0 deployment harness.

If step 0 deployed and you saw the green "Backend deployed." page, this is the
next layer on top.

## What changed since step 0

- **New: Supabase database schema** — `supabase/migrations/0001_initial_schema.sql`
- **New: Auth pages** — `/signin`, `/accept-invite`, `/dashboard`, `/admin`
- **New: Admin invite API** — `/api/admin/invite` for inviting users by email
- **New: Supabase client libraries** — `lib/supabase-browser.ts`, `lib/supabase-server.ts`
- **Updated: `/api/health`** — now reports whether Supabase env vars are configured
- **Updated: `/` (home page)** — links to sign-in / dashboard
- **Updated: `package.json`** — adds `@supabase/supabase-js` and `@supabase/ssr`

## Deployment order — IMPORTANT

Do these in order. Skipping a step will fail in confusing ways.

### 1. Run the database migration in Supabase

Before deploying any code:

- Go to your Supabase project dashboard
- Left sidebar: **SQL Editor**
- Click "New query"
- Open `supabase/migrations/0001_initial_schema.sql` from this folder
- Copy the ENTIRE contents
- Paste into the SQL editor
- Click "Run" (or Cmd/Ctrl + Enter)

You should see "Success. No rows returned." If you see an error, screenshot
it and stop. The migration is idempotent for fresh databases but won't run
twice cleanly — if you have to retry, drop the tables first.

### 2. Get the service_role key from Supabase

The invite flow needs this. It's the powerful key that bypasses RLS.

- Supabase dashboard → Settings → API
- Find "service_role secret" → click "Reveal"
- Copy the value (starts with `eyJ...`)
- **Do not commit this anywhere. Do not paste it in chat.**

### 3. Set environment variables in Vercel

Before pushing the new code:

- Go to vercel.com → your project (`fip-next-new`) → Settings → Environment Variables
- Add these four variables (Production environment):

| Name | Value |
|------|-------|
| NEXT_PUBLIC_SUPABASE_URL | https://ehuvqkolypfqrywonkxj.supabase.co |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | sb_publishable_99-S0z8FJxQWNbhkzZBTSg_jZ8G-Dax |
| SUPABASE_SERVICE_ROLE_KEY | (the secret from step 2) |
| NEXT_PUBLIC_SITE_URL | https://fip-next-new.vercel.app |

For each variable: name it, paste the value, select "Production" environment,
click Save.

### 4. Push the new code

Same flow as step 0:
- Copy these files into your `FIP-Next-New` GitHub repo via web upload
- Preserve folder structure exactly
- The new folders to upload: `lib/`, `supabase/`
- Updated files at root + in `pages/`: see the file list below
- Commit with message "step 1 — supabase auth"
- Vercel auto-redeploys on push

### 5. Verify the deployment

After Vercel finishes building:

1. Open your deployment URL
2. The home page should show **Supabase: configured** in the health check
3. Click "Sign in" link

You won't be able to sign in yet because there's no admin user. That's step 6.

### 6. Create your admin user

- Supabase dashboard → Authentication → Users
- Click "Add user" → "Create new user"
- Email: your email address
- Password: set a password you'll remember
- Auto Confirm User: checked
- Click "Create user"

Then make yourself admin:
- Supabase dashboard → SQL Editor → New query
- Run:
  ```sql
  UPDATE profiles SET role = 'admin' WHERE email = 'your-email@example.com';
  ```
- Replace with the email you just used

### 7. Sign in and verify

- Go to your-deployment-url/signin
- Enter your admin email and password
- You should land on `/dashboard` showing your role as `admin`
- Try going to `/admin` — should load (it's admin-only)

### 8. Invite the pilot consultants

On the `/admin` page:
- Email: cristina@example.com (use her real email)
- First name: Cristina
- Last name: H
- Role: Consultant
- Click Send invite

Repeat for Christo V and Chris B.

Each one will get an email from Supabase with a link to accept the invite.
That link lands them at `/accept-invite` where they set their password,
then they're redirected to `/dashboard`.

## What this build proves

- Auth flow works end to end (sign in, dashboard renders, sign out)
- Role-based access control is enforced server-side
- The admin invite flow sends real emails via Supabase
- The database schema is ready for the agent (conversations, messages,
  recommendations, kb_citations all exist)
- The deployment pipeline still works after adding a real backend

## What this build does NOT do

- No KB ingestion yet (step 2)
- No vector storage or RAG (step 2)
- No Anthropic API integration yet (step 3)
- No actual agent chat (step 3)
- No farm-data tools (step 4)
- No recommendation draft generation (step 5)

These are the next phases. Each builds on this foundation.

## Troubleshooting

**Sign-in fails with "Invalid login credentials"**: the password is wrong, OR
the user doesn't exist yet (no admin created in step 6), OR you're using the
wrong email.

**Dashboard immediately redirects to sign-in even after signing in**: cookie
likely not persisting. Check that NEXT_PUBLIC_SITE_URL matches your actual
deployment URL.

**Admin page redirects to dashboard**: your profile.role isn't 'admin'. Check
in Supabase: `SELECT email, role FROM profiles;`

**Invite fails with "Service role not configured"**: SUPABASE_SERVICE_ROLE_KEY
not set in Vercel env vars. Add it and redeploy.

**Health check shows "Supabase: not configured"**: NEXT_PUBLIC_SUPABASE_URL
or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing from Vercel env vars.
