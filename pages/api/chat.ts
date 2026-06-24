/**
 * POST /api/chat
 *
 * The heart of step 3. Handles a single chat turn:
 *   1. Authenticate the user
 *   2. Resolve or create the conversation
 *   3. Persist the user's message
 *   4. Embed the query, retrieve top-K KB chunks
 *   5. Build the system prompt with KB context + conversation history
 *   6. Stream the response from Claude back to the client (SSE)
 *   7. Persist the assistant's message + KB citations as the stream completes
 *
 * Stream format: Server-Sent Events. Each event is `data: <json>\n\n`.
 * Event types:
 *   { type: 'meta', conversation_id, message_id, citations: [...] }
 *   { type: 'token', text }
 *   { type: 'done', input_tokens, output_tokens }
 *   { type: 'error', message }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from '@/lib/supabase-server';
import { searchKb, formatChunksForPrompt, type KbChunkMatch } from '@/lib/kb-search';
import { MODEL_HAIKU } from '@/lib/anthropic';
import { buildConsultantPrompt } from '@/lib/prompts/consultant';

// Disable Next.js body size limit and let us stream
export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
    responseLimit: false,
  },
};

interface ChatRequestBody {
  message: string;
  conversation_id?: string;
}

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_HISTORY_TURNS = 10; // recent messages included in the prompt

/**
 * Send an SSE event to the client. Each event ends with a blank line.
 */
function sendEvent(res: NextApiResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Build the SSE response and stream Claude's reply.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // -- Authenticate --
  const supabase = createSupabaseServerClient(req, res);
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  // Get profile to check role and get display name
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, role')
    .eq('id', authUser.id)
    .single();

  if (profileError || !profile) {
    return res.status(403).json({ error: 'No profile found' });
  }

  // Step 3 = consultant mode only. Allow admin and consultant/vet roles.
  // Farmers are blocked until step 4 adds farmer mode.
  if (!['admin', 'consultant', 'vet'].includes(profile.role)) {
    return res.status(403).json({
      error: 'Chat is currently available to consultants and vets. Farmer mode is coming soon.',
    });
  }

  // -- Parse request --
  const body = req.body as Partial<ChatRequestBody>;
  if (!body.message || typeof body.message !== 'string') {
    return res.status(400).json({ error: 'message is required' });
  }
  const userMessage = body.message.trim();
  if (userMessage.length === 0) {
    return res.status(400).json({ error: 'message is empty' });
  }
  if (userMessage.length > 8000) {
    return res.status(400).json({ error: 'message too long (max 8000 chars)' });
  }

  // -- Resolve or create conversation --
  let conversationId: string;
  if (body.conversation_id) {
    // Verify the conversation belongs to this user (RLS will enforce this too)
    const { data: existing, error: convError } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', body.conversation_id)
      .eq('user_id', profile.id)
      .single();
    if (convError || !existing) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    conversationId = existing.id;
  } else {
    // Create a new conversation. Title gets auto-set later from first message.
    const { data: created, error: createError } = await supabase
      .from('conversations')
      .insert({
        user_id: profile.id,
        mode: 'consultant',
        title: userMessage.slice(0, 80),
      })
      .select('id')
      .single();
    if (createError || !created) {
      return res.status(500).json({
        error: `Failed to create conversation: ${createError?.message}`,
      });
    }
    conversationId = created.id;
  }

  // -- Persist the user message --
  const { data: userMsgRow, error: userMsgError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content: userMessage,
    })
    .select('id')
    .single();

  if (userMsgError || !userMsgRow) {
    return res.status(500).json({
      error: `Failed to save user message: ${userMsgError?.message}`,
    });
  }

  // -- Load recent conversation history (excluding the message we just added) --
  const { data: historyRows } = await supabase
    .from('messages')
    .select('role, content, created_at')
    .eq('conversation_id', conversationId)
    .neq('id', userMsgRow.id)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY_TURNS * 2); // user+assistant pairs

  const history = (historyRows ?? [])
    .reverse() // oldest first for the API
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  // -- Set up SSE headers --
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });

  // -- Retrieve KB chunks --
  // Use the service client for retrieval so RLS doesn't get in the way of
  // matching; the rows are public-read for signed-in users anyway.
  let matches: KbChunkMatch[] = [];
  try {
    const serviceClient = createSupabaseServiceClient();
    const searchResult = await searchKb(serviceClient, userMessage, {
      matchCount: 8,
      matchThreshold: 0.45,
    });
    matches = searchResult.matches;
  } catch (err) {
    sendEvent(res, {
      type: 'error',
      message: `Knowledge base search failed: ${
        err instanceof Error ? err.message : 'unknown'
      }`,
    });
    res.end();
    return;
  }

  const kbContext = formatChunksForPrompt(matches);

  // -- Build the system prompt --
  const displayName =
    [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() ||
    null;
  const systemPrompt = buildConsultantPrompt({
    userName: displayName,
    kbContext,
  });

  // -- Compose API messages --
  const apiMessages = [...history, { role: 'user' as const, content: userMessage }];

  // -- Send the meta event with citations so the UI can render them --
  sendEvent(res, {
    type: 'meta',
    conversation_id: conversationId,
    user_message_id: userMsgRow.id,
    citations: matches.map((m, i) => ({
      index: i + 1,
      citation_label: m.citation_label,
      source_name: m.source_name,
      heading: m.heading,
      source_type: m.source_type,
      similarity: m.similarity,
      has_nz_caveat: m.has_nz_caveat,
    })),
  });

  // -- Stream from Anthropic --
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    sendEvent(res, { type: 'error', message: 'ANTHROPIC_API_KEY not set' });
    res.end();
    return;
  }

  let assistantContent = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let modelUsed = MODEL_HAIKU;
  let stopReason: string | null = null;

  try {
    const upstream = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL_HAIKU,
        max_tokens: 2048,
        system: systemPrompt,
        messages: apiMessages,
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errorText = await upstream.text();
      sendEvent(res, {
        type: 'error',
        message: `Anthropic API error ${upstream.status}: ${errorText.slice(0, 500)}`,
      });
      res.end();
      return;
    }

    // Parse the Anthropic SSE stream and forward token events to the client
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;

        try {
          const evt = JSON.parse(payload);

          if (evt.type === 'message_start') {
            inputTokens = evt.message?.usage?.input_tokens ?? 0;
            modelUsed = evt.message?.model ?? MODEL_HAIKU;
          } else if (evt.type === 'content_block_delta') {
            const text = evt.delta?.text ?? '';
            if (text) {
              assistantContent += text;
              sendEvent(res, { type: 'token', text });
            }
          } else if (evt.type === 'message_delta') {
            outputTokens = evt.usage?.output_tokens ?? outputTokens;
            stopReason = evt.delta?.stop_reason ?? stopReason;
          } else if (evt.type === 'message_stop') {
            // Final event from Anthropic; our cleanup happens below
          }
        } catch {
          // Ignore unparseable lines (heartbeats, comments)
        }
      }
    }
  } catch (err) {
    sendEvent(res, {
      type: 'error',
      message: `Stream failed: ${err instanceof Error ? err.message : 'unknown'}`,
    });
    // Fall through to persistence so partial responses are saved
  }

  // -- Persist the assistant message + citations --
  // We use service-role client here for two reasons:
  //   (1) the auth.uid() in the response context can be flaky after streaming
  //   (2) we want to persist even if the stream errored partway
  let assistantMessageId: string | null = null;
  try {
    const serviceClient = createSupabaseServiceClient();
    const { data: assistantRow, error: assistantError } = await serviceClient
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: assistantContent || '(no response generated)',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        model: modelUsed,
      })
      .select('id')
      .single();

    if (assistantError || !assistantRow) {
      console.error('Failed to save assistant message:', assistantError);
    } else {
      assistantMessageId = assistantRow.id;

      // Persist citations
      if (matches.length > 0) {
        const citationRows = matches.map((m) => ({
          message_id: assistantRow.id,
          chunk_ref: m.id,
          source_doc: m.source_name,
          source_section: m.heading,
          snippet: m.content.slice(0, 500),
        }));
        const { error: citationError } = await serviceClient
          .from('kb_citations')
          .insert(citationRows);
        if (citationError) {
          console.error('Failed to save citations:', citationError);
        }
      }
    }
  } catch (err) {
    console.error('Persistence error:', err);
  }

  // -- Final event with metadata --
  sendEvent(res, {
    type: 'done',
    assistant_message_id: assistantMessageId,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    model: modelUsed,
    stop_reason: stopReason,
  });

  res.end();
}
