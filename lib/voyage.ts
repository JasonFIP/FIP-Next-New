/**
 * Voyage AI embeddings client.
 *
 * Used by:
 *   - The ingestion script (scripts/ingest-kb.ts) — batch-embeds KB chunks
 *   - The retrieval layer (step 3) — embeds user queries before similarity search
 *
 * Model: voyage-3.5 (general-purpose, best retrieval quality for technical content)
 * Dimensions: 1024 (matches the vector(1024) column in kb_chunks)
 * Input type: 'document' when embedding KB chunks, 'query' when embedding user
 * queries — Voyage prepends different prompts to optimize each case.
 *
 * Voyage's free tier covers 200M tokens, more than enough for this project.
 */

const VOYAGE_API_BASE = 'https://api.voyageai.com/v1';
const VOYAGE_MODEL = 'voyage-3.5';
const VOYAGE_DIMENSIONS = 1024;

export type VoyageInputType = 'document' | 'query';

interface VoyageEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * Embed a batch of texts. Voyage accepts up to 128 inputs per call (check
 * current docs if uncertain). We cap at 64 for safety.
 *
 * Returns embeddings in the same order as the input texts.
 */
export async function embedTexts(
  texts: string[],
  inputType: VoyageInputType,
  apiKey?: string
): Promise<{ embeddings: number[][]; tokensUsed: number }> {
  const key = apiKey ?? process.env.VOYAGE_API_KEY;
  if (!key) {
    throw new Error(
      'VOYAGE_API_KEY is not set. Add it to .env.local (local) or to ' +
        'Vercel environment variables (production).'
    );
  }

  if (texts.length === 0) {
    return { embeddings: [], tokensUsed: 0 };
  }
  if (texts.length > 64) {
    throw new Error(
      `embedTexts received ${texts.length} texts in one call; batch to 64 or fewer.`
    );
  }

  const response = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: inputType,
      output_dimension: VOYAGE_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Voyage API error ${response.status}: ${errorText}`
    );
  }

  const data = (await response.json()) as VoyageEmbeddingResponse;

  // Sort by index to ensure consistent ordering
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  const embeddings = sorted.map((d) => d.embedding);

  // Sanity check: did we get the right dimension?
  if (embeddings.length > 0 && embeddings[0].length !== VOYAGE_DIMENSIONS) {
    throw new Error(
      `Voyage returned ${embeddings[0].length}-dim embeddings, expected ${VOYAGE_DIMENSIONS}`
    );
  }

  return {
    embeddings,
    tokensUsed: data.usage.total_tokens,
  };
}

/**
 * Embed a single text. Convenience wrapper around embedTexts.
 */
export async function embedText(
  text: string,
  inputType: VoyageInputType,
  apiKey?: string
): Promise<{ embedding: number[]; tokensUsed: number }> {
  const { embeddings, tokensUsed } = await embedTexts([text], inputType, apiKey);
  return { embedding: embeddings[0], tokensUsed };
}

export const VOYAGE_MODEL_NAME = VOYAGE_MODEL;
export const VOYAGE_EMBEDDING_DIMS = VOYAGE_DIMENSIONS;
