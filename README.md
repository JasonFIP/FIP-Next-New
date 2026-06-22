# FIP Backend — step 2

This is step 2 of the Agvance Dairy Nutrition agent rollout. Adds the
knowledge-base ingestion + retrieval layer on top of the working step 1
auth foundation.

If step 1 deployed and you signed in successfully as admin, this is the
next layer on top.

## What changed since step 1

- **New: KB schema migration** — `supabase/migrations/0002_kb_ingestion.sql`
  - Enables pgvector extension
  - Adds `kb_documents`, `kb_chunks`, `message_feedback` tables
  - Adds `match_kb_chunks` RPC function for similarity search with safety filters
- **New: client libraries** — `lib/voyage.ts`, `lib/anthropic.ts`, `lib/kb-search.ts`
- **New: ingestion script** — `scripts/ingest-kb.ts` (runs locally, not on Vercel)
- **New: verification script** — `scripts/verify-kb.ts` (runs locally)
- **New: KB health endpoint** — `/api/health/kb` (verify ingestion from deployed app)
- **Updated: `/api/health`** — now reports Anthropic + Voyage configuration
- **Updated: `package.json`** — adds `dotenv`, `tsx`, scripts for ingest/verify

## Prerequisites

Before deploying step 2 code, complete in order:

### 1. Install Node.js on your Windows machine

You'll need Node 18.17+ to run the ingestion script locally.

- Check if you have it: open Command Prompt (or PowerShell) and run `node --version`
- If you see a version number ≥ 18.17, you're good
- If you see "command not found" or the version is older:
  - Go to nodejs.org
  - Download the Windows installer for the LTS version
  - Run it (Next → Next → Install → Done)
  - Close and reopen Command Prompt, run `node --version` again

### 2. Run the SQL migration

- Supabase dashboard → SQL Editor → New query
- Open `supabase/migrations/0002_kb_ingestion.sql` in Notepad
- Copy the ENTIRE contents
- Paste into the SQL editor → Run
- Should say "Success. No rows returned."
- If errors, screenshot and stop

### 3. Confirm env vars in Vercel

These should already be there if you completed step 1 setup:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `ANTHROPIC_API_KEY`  (added when we set up Anthropic)
- `VOYAGE_API_KEY`     (added when we set up Voyage)

### 4. Push the new code to GitHub

Same flow as step 1 — UPDATE-OVERWRITE and NEW-UPLOAD zips that you drag into the
github.com web upload. Vercel auto-redeploys.

### 5. Verify the deployment

- Visit your deployment URL
- Health check at `/api/health` should now show:
  - `supabase_configured: true`
  - `anthropic_configured: true`
  - `voyage_configured: true`

## Ingesting the KB (this is the new bit)

The ingestion script runs on your **Windows machine**, not on Vercel.

### Set up local .env.local

Create a file called `.env.local` in your project folder with the same six
env vars from Vercel:

```
NEXT_PUBLIC_SUPABASE_URL=https://ehuvqkolypfqrywonkxj.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_99-S0z8FJxQWNbhkzZBTSg_jZ8G-Dax
SUPABASE_SERVICE_ROLE_KEY=eyJ...   (get from Supabase Settings → API → Reveal)
NEXT_PUBLIC_SITE_URL=https://fip-next-new.vercel.app
ANTHROPIC_API_KEY=sk-ant-api03-...
VOYAGE_API_KEY=pa-...
```

This file is in `.gitignore` and will never be committed.

### Put the KB files in `kb-source/`

Create a folder `kb-source` in the project root. Put your ten KB markdown files
in there:
- 01_Product_Library.md
- 02_Rumen_Health_and_Buffers.md
- 03_Seasonal_Facial_Eczema.md
- 04_Evidence_Notes.md
- 04_Evidence_Notes_E5_SARA_Inflammation_Liver_Hoof.md
- 04_Evidence_Notes_E6_Leaky_Gut.md
- 04_Evidence_Notes_E7_Yeast_Probiotics.md
- 05_Premix_and_Transition_Range.md
- 06_Feed_Reference_Tables.md
- 07_Agent_Behaviour_Spec.md

(`kb-source/` is `.gitignored` — KB stays out of the repo for now)

### Install dependencies and run ingest

Open Command Prompt in your project folder:

```
npm install
npm run ingest
```

You'll see output like:
```
Found 10 markdown files

01_Product_Library.md
  Title: Agvance Product Library
  Version: v3
  Type: agvance
  Chunks: 27
  Embedding batch 1/1 (27 chunks)...
  ✓ Wrote 27 chunks.
... [for each file]

=== Ingestion complete ===
  Files processed:   10
  Files skipped:     0
  Chunks written:    ~141
  Tokens embedded:   ~32000
  Voyage 3.5 free tier: used 0.0160% of it.
```

### Verify retrieval works

```
npm run verify-kb
```

This runs five sample queries and prints what comes back. Look for:
- Each query returns relevant chunks
- The "Recommend Rumenox" query has `✓ Discontinued filter works`
- No errors

## What this build proves

- Your KB is searchable by natural language
- Discontinued products are filtered out at the database level
- Retrieval works end to end (embed → similarity search → return chunks)
- The infrastructure is ready for step 3 (the actual chat endpoint)

## What this build does NOT do

- No chat endpoint yet (step 3)
- No agent system prompt yet (step 3)
- No farmer/consultant chat UI yet (step 3)
- No actual conversation with Claude yet (step 3)

## Troubleshooting

**Ingest fails with `VOYAGE_API_KEY is not set`**: your `.env.local` file is
missing the key or has a typo. The file must be in the project root, not in
a subfolder.

**Ingest fails with `match_kb_chunks does not exist`**: the SQL migration
didn't run. Re-run `supabase/migrations/0002_kb_ingestion.sql`.

**Ingest succeeds but `verify-kb` returns no results**: the embeddings may
have stored as nulls. Run this in Supabase SQL Editor to check:
```sql
SELECT COUNT(*) FROM kb_chunks WHERE embedding IS NOT NULL;
```
Should be ≥140. If it's zero, the chunks were inserted but embeddings
failed. Check Voyage API key.

**Discontinued products surface in search results**: shouldn't happen — the
`match_kb_chunks` RPC filters them by default. If they do, check that the
chunks have `is_discontinued = true` set:
```sql
SELECT source_name, citation_label FROM kb_chunks WHERE is_discontinued;
```
