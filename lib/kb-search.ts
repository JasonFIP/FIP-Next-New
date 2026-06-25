/**
 * KB search — embed a query and find the most-similar KB chunks.
 *
 * The "retrieval" in RAG. Used by step 3's chat endpoint before calling
 * Claude, so Claude sees the relevant KB content as context.
 *
 * Safety filters baked into the underlying RPC (match_kb_chunks):
 *   - Discontinued chunks excluded by default
 *   - Can restrict by source_type (e.g. 'agvance' only)
 *
 * Returns chunks ordered by cosine similarity, highest first.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { embedText } from './voyage';

export interface KbChunkMatch {
  id: string;
  document_id: string;
  citation_label: string;
  heading: string;
  content: string;
  source_name: string;
  source_type: 'agvance' | 'evidence' | 'spec' | 'reference';
  status_code: 'green' | 'yellow' | 'red' | 'black' | null;
  is_discontinued: boolean;
  has_nz_caveat: boolean;
  similarity: number;
}

export interface KbSearchOptions {
  matchThreshold?: number; // 0..1 cosine similarity, default 0.5
  matchCount?: number;      // default 8
  includeDiscontinued?: boolean; // default false
  filterSourceType?: 'agvance' | 'evidence' | 'spec' | 'reference' | null;
}

/**
 * Search the KB by natural-language query.
 *
 * @param supabase A Supabase client (server or service-role).
 * @param query   The user's question text.
 * @param options Search options.
 */
export async function searchKb(
  supabase: SupabaseClient,
  query: string,
  options: KbSearchOptions = {}
): Promise<{ matches: KbChunkMatch[]; tokensUsed: number; lowConfidence: boolean }> {
  // 1. Embed the query (input_type='query' so Voyage optimizes for retrieval)
  const { embedding, tokensUsed } = await embedText(query, 'query');

  const matchCount = options.matchCount ?? 8;
  const includeDiscontinued = options.includeDiscontinued ?? false;
  const filterSourceType = options.filterSourceType ?? null;
  // Confidence floor. Sparse / proper-noun queries ("what is calsea") can
  // embed weakly, so 0.5 was filtering real matches out entirely. 0.35 lets
  // those through while still ranking by similarity.
  const primaryThreshold = options.matchThreshold ?? 0.35;

  const runMatch = async (threshold: number) => {
    const { data, error } = await supabase.rpc('match_kb_chunks', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: matchCount,
      include_discontinued: includeDiscontinued,
      filter_source_type: filterSourceType,
    });
    if (error) {
      throw new Error(`match_kb_chunks failed: ${error.message}`);
    }
    return (data ?? []) as KbChunkMatch[];
  };

  // 2. Primary search at the confidence floor.
  let matches = await runMatch(primaryThreshold);
  let lowConfidence = false;

  // 3. Fallback: if nothing cleared the floor, take the best available chunks
  //    (no threshold) so the model sees the closest content instead of an
  //    empty context it would answer from general knowledge. Flag it so the
  //    prompt hedges. This is the fix for zero-recall on sparse queries.
  if (matches.length === 0) {
    matches = await runMatch(0);
    lowConfidence = matches.length > 0;
  }

  return { matches, tokensUsed, lowConfidence };
}

/**
 * Format chunk matches as context to inject into a Claude system prompt.
 * Each chunk gets a citation label so Claude can reference it back to the user.
 */
export function formatChunksForPrompt(
  matches: KbChunkMatch[],
  lowConfidence = false
): string {
  if (matches.length === 0) {
    return 'No relevant knowledge-base content found for this query.';
  }

  const header = lowConfidence
    ? '⚠ LOW-CONFIDENCE RETRIEVAL: nothing in the knowledge base strongly matched this query. The chunks below are the closest available but may not be relevant. If they do not directly answer the question, tell the user the topic is not covered in your knowledge base. Do NOT answer from general knowledge, and do NOT cite a chunk unless it genuinely supports what you are saying.\n\n'
    : '';

  return (
    header +
    matches
      .map((m, i) => {
      const statusBadge =
        m.status_code === 'green'
          ? ' [verified]'
          : m.status_code === 'yellow'
            ? ' [partial — figures incomplete]'
            : m.status_code === 'red'
              ? ' [gap — needs source]'
              : '';

      const sourceTypeNote =
        m.source_type === 'evidence'
          ? ' (Evidence source — assesses but does not override Agvance guidance)'
          : '';

      const nzNote = m.has_nz_caveat
        ? '\n  ⚠ This entry carries an NZ-context caveat. Always flag when quoting.'
        : '';

        return [
          `[${i + 1}] ${m.citation_label}${statusBadge}${sourceTypeNote}${nzNote}`,
          m.content,
          '',
        ].join('\n');
      })
      .join('\n---\n')
  );
}
