# FIP Backend — step 3

This is step 3 of the Agvance Dairy Nutrition agent rollout. Wires the
actual chat agent: a streaming Claude-powered conversation backed by
the Dairy Brain knowledge base, with citations, feedback capture, and
conversation persistence.

If steps 0-2 deployed (KB ingested, retrieval verified), this is what
you've been building toward.

## What changed since step 2

**New backend (API):**
- POST /api/chat — streaming chat endpoint with RAG retrieval and conversation persistence
- GET /api/conversations — list user's conversations
- POST /api/conversations — create new conversation
- GET /api/conversations/[id] — get conversation with messages + citations + feedback
- DELETE /api/conversations/[id] — delete a conversation
- POST /api/messages/[id]/feedback — thumbs-up/down + structured rejection reasons

**New frontend:**
- /chat — the consultant chat UI (southern-sky palette, glassmorphic input, citation chips, feedback popup)
- Updated home page with "Open chat" call-to-action

**New system prompt:**
- lib/prompts/consultant.ts — the keystone document that encodes the spec into the agent's behavior

**New test runner:**
- scripts/test-spec.ts — runs the §9 adversarial test set against the live agent

**Updated:**
- package.json — bumped to v0.4.0, adds test-spec script
- pages/api/health.ts — reports version 0.4.0
- pages/index.tsx — home page now showcases the chat product
- styles/globals.css — adds the chat UI styles (sidebar, messages, citations, input bar, feedback popup)

## What this build does

Once deployed:

1. Sign in as an admin/consultant/vet user (created via the admin invite flow from step 1).
2. Visit /chat — see the welcome screen with suggested starter questions.
3. Ask a question about Agvance products, rumen health, transition, FE, etc.
4. Watch the response stream in with the southern-sky aesthetic.
5. Click "X sources" under each assistant message to expand the citations panel.
6. Click thumbs up/down to leave feedback. Thumbs-down opens a popup with structured reasons.
7. Switch between conversations via the left sidebar.

## What this build does NOT do

- No farmer mode yet. Farmers signing in are redirected to /dashboard. Farmer mode + sign-off gate come in step 4.
- No constellation visual / farm-data overview. Step 5.
- No image upload / file attachment. Step 6+.
- Plain text rendering. Markdown rendering is a step 4 enhancement.

## Prerequisites

Before deploying step 3:

### 1. Have steps 0-2 deployed and working

Specifically:
- Sign-in works (step 1)
- /api/health shows supabase, anthropic, and voyage all configured true
- /api/health/kb shows 10 documents, ~141 chunks
- You've successfully run npm run verify-kb

### 2. No new env vars needed

Step 3 uses the same six environment variables already in Vercel.

### 3. No new SQL migration needed

The message_feedback table was already created in step 2's 0002_kb_ingestion.sql migration.

## Deployment

Same flow as steps 1 and 2. Upload the code to GitHub via the two zips:

- fip-backend-step3-UPDATE-OVERWRITE.zip — files that already exist and get replaced
- fip-backend-step3-NEW-UPLOAD.zip — brand-new files

After Vercel auto-redeploys, check:

1. /api/health shows version 0.4.0
2. Sign in at /signin
3. Visit /chat — you should see the chat UI
4. Send a test message like "What is CalSea Powder Advance?"

## Voyage rate limit reminder

As of step 2 wrap-up, you were still on Voyage's free tier (3 RPM / 10K TPM).
Each user query embeds the question via Voyage. Under the free tier you can
ask roughly one question every 20 seconds before throttling.

For solo testing this is fine. For bringing pilot consultants online, add a
payment method to Voyage. The 200M-tokens-free still applies.

## Running the §9 spec test set

After deployment, validate against the spec:

1. Sign in to the deployed app
2. Open browser devtools - Application - Cookies - copy the Supabase auth cookie
3. Open Command Prompt in your project folder
4. Run:

   set FIP_BASE_URL=https://fip-next-new.vercel.app
   set FIP_TEST_COOKIE=sb-...-auth-token=...
   npm run test-spec

The runner sends 9 adversarial prompts and grades each response using Claude.
Output shows pass/fail per test with rationale. Full run takes about 4 minutes
due to the Voyage rate cap pause.

## Troubleshooting

Chat returns "Sign in required" even though I'm signed in: cookie isn't being
sent. Check the deployment is on the same domain as your sign-in.

Chat returns "Chat is currently available to consultants and vets": your
profile has role=farmer. Either update via Supabase SQL editor, or wait for
step 4.

Streaming response stops mid-sentence: look at Vercel logs. Common causes:
Voyage rate cap, Anthropic API error, browser disconnection. Partial
responses still get persisted.

Chat UI looks broken / unstyled: make sure styles/globals.css uploaded
correctly. The chat-specific styles are at the bottom of the file.

The system prompt feels wrong: edit lib/prompts/consultant.ts, redeploy,
re-run npm run test-spec.
