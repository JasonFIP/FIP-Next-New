# FIP Backend — step 0

This is the minimum-viable Next.js app for the Farm Intelligence Platform agent stack. It contains nothing of the real product yet. Its only job is to **prove the deployment pipeline works** end to end from iPad → GitHub → Vercel.

If you can deploy this and load it from your iPad Safari, we have a foundation to build on. If you can't, we need to fix that before any agent work begins.

## What's in here

```
fip-backend/
├── package.json              dependencies + scripts
├── next.config.js            Next.js config (minimal)
├── tsconfig.json             TypeScript config
├── next-env.d.ts             Next.js TS reference (do not edit)
├── .gitignore                standard ignores
├── pages/
│   ├── _app.tsx              app wrapper
│   ├── index.tsx             home page with health check display
│   └── api/
│       └── health.ts         /api/health endpoint
├── styles/
│   └── globals.css           minimal NZ-palette styling
└── README.md                 this file
```

10 files. That's the entire app.

## Deploy via iPad workflow

### 1. Get the files into a GitHub repo

In Working Copy:
- Create a fresh empty repo (or use a new branch of an existing one). Recommended name: `fip-backend`
- Add each file from this folder, preserving the folder structure exactly
- Critical paths:
  - `pages/index.tsx` (not `index.tsx` at root)
  - `pages/api/health.ts` (not `api/health.ts` at root)
  - `styles/globals.css`
- Commit with message `step 0 — minimal Next.js scaffold`
- Push to GitHub (set up the remote if it's not already)

### 2. Verify the structure on GitHub

Open the repo in Safari, navigate the folder tree, and confirm you can see:
- `pages/index.tsx` exists
- `pages/api/health.ts` exists
- `package.json` is at the root, not nested in a subfolder

If any file is in the wrong place, fix it before deploying — Vercel cannot guess.

### 3. Deploy to Vercel

- Go to vercel.com → "Add New Project"
- Import the `fip-backend` repo
- Framework Preset: should auto-detect as **Next.js**. If it doesn't, something is wrong with the repo structure — go back to step 2
- Build settings: leave defaults
- Environment variables: leave empty (we don't need any yet)
- Click Deploy

Build should complete in 1–2 minutes. You'll get a URL like `fip-backend-abc123.vercel.app`.

### 4. Verify it works

Open the deployment URL in iPad Safari. You should see:
- "Backend deployed." headline
- A Health Check card showing **OK** with service info
- A "What this proves" list

If the health check shows an error, the page rendered but the API route is broken — usually means `pages/api/health.ts` is in the wrong path. Check step 2.

If the page doesn't render at all, the build failed — check the Vercel deploy logs.

### 5. Confirm the deploy loop is reliable

Make a trivial change (e.g. edit the headline in `pages/index.tsx`), commit, push from Working Copy, watch Vercel redeploy automatically, refresh the URL, confirm the change appears.

If this works, **the pipeline is solid and we can build on it**. If something is flaky, we debug now, not later.

## What's next

Once step 0 is verified working:

- **Step 1:** Supabase setup — provision database, auth, schema for users/farms/recommendations
- **Step 2:** KB ingestion — export Dairy Brain project docs, chunk, embed, store in pgvector
- **Step 3:** Agent endpoint — `/api/chat` calling Anthropic API with RAG retrieval, system prompt, mode separation
- **Step 4:** Wire the FIP prototype UI to call `/api/chat` instead of using scripted responses

Each step builds on the previous. None of them work without step 0.

## Local development (if you ever want to)

Not required for deployment, but if you can run Node anywhere:

```
npm install
npm run dev
# open http://localhost:3000
```

For iPad-only workflow, skip this entirely — push and let Vercel build.
