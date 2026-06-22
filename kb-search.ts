/**
 * Anthropic Claude API client.
 *
 * Used by step 3 (the chat endpoint). Built into step 2 so the foundation is
 * in place when we wire the agent.
 *
 * Defaults to Claude Haiku 4.5. To upgrade to Opus later, change the default
 * in `MODEL_HAIKU` or pass a different model to `callClaude`. The rest of
 * the codebase doesn't need to change.
 *
 * NOTE: the agent's system prompt lives in step 3, not here. This file is
 * just the transport layer.
 */

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

// Current model identifiers (verify in the Claude docs if pinning matters).
export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
export const MODEL_SONNET = 'claude-sonnet-4-6';
export const MODEL_OPUS = 'claude-opus-4-7';

export type ClaudeRole = 'user' | 'assistant';

export interface ClaudeMessage {
  role: ClaudeRole;
  content: string;
}

export interface ClaudeCallOptions {
  model?: string;
  system?: string;
  messages: ClaudeMessage[];
  max_tokens?: number;
  temperature?: number;
  apiKey?: string;
}

interface ClaudeResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  stopReason: string | null;
}

export async function callClaude(
  options: ClaudeCallOptions
): Promise<ClaudeResult> {
  const key = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to .env.local (local) or to ' +
        'Vercel environment variables (production).'
    );
  }

  const body: Record<string, unknown> = {
    model: options.model ?? MODEL_HAIKU,
    max_tokens: options.max_tokens ?? 1024,
    messages: options.messages,
  };
  if (options.system) body.system = options.system;
  if (options.temperature !== undefined) body.temperature = options.temperature;

  const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Anthropic API error ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as ClaudeResponse;

  // Concatenate all text blocks (Claude can return multiple)
  const text = data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return {
    text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    model: data.model,
    stopReason: data.stop_reason,
  };
}
