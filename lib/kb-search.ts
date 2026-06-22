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
): Promise<{ matches: KbChunkMatch[]; tokensUsed: number }> {
  // 1. Embed the query (input_type='query' so Voyage optimizes for retrieval)
  const { embedding, tokensUsed } = await embedText(query, 'query');

  // 2. Run the similarity-search RPC
  const { data, error } = await supabase.rpc('match_kb_chunks', {
    query_embedding: embedding,
    match_threshold: options.matchThreshold ?? 0.5,
    match_count: options.matchCount ?? 8,
    include_discontinued: options.includeDiscontinued ?? false,
    filter_source_type: options.filterSourceType ?? null,
  });

  if (error) {
    throw new Error(`match_kb_chunks failed: ${error.message}`);
  }

  return {
    matches: (data ?? []) as KbChunkMatch[],
    tokensUsed,
  };
}

/**
 * Format chunk matches as context to inject into a Claude system prompt.
 * Each chunk gets a citation label so Claude can reference it back to the user.
 */
export function formatChunksForPrompt(matches: KbChunkMatch[]): string {
  if (matches.length === 0) {
    return 'No relevant knowledge-base content found for this query.';
  }

  return matches
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
    .join('\n---\n');
}
