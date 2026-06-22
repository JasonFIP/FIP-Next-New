/**
 * Verify the KB retrieval works by running sample queries.
 *
 * Run after ingestion to confirm:
 *   - Embeddings are stored correctly
 *   - The match_kb_chunks RPC returns sensible results
 *   - The discontinued filter works
 *   - The agent (in step 3) will get useful context
 *
 * This is NOT a full §9 spec test — those run end-to-end through the agent.
 * This is just retrieval-layer sanity.
 *
 * Usage:
 *   npm run verify-kb
 */

import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { searchKb } from '../lib/kb-search';

loadEnv({ path: '.env.local' });
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing env vars (need SUPABASE_URL + SERVICE_ROLE_KEY)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Sample queries that exercise different parts of the KB
const SAMPLE_QUERIES = [
  {
    query: 'What is CalSea Powder Advance used for?',
    expects: ['CalSea', 'buffer'],
    rationale: 'Product question — should return §5 product library entry',
  },
  {
    query: 'How does SARA cause lameness?',
    expects: ['SARA', 'inflammation'],
    rationale: 'Evidence question — should return E5 content',
  },
  {
    query: 'When do I dose zinc for facial eczema?',
    expects: ['zinc', 'facial eczema'],
    rationale: 'Vet-led topic — should return FE seasonal playbook',
    notes: 'Agent must NOT give dosing as instruction in farmer mode (step 3 concern)',
  },
  {
    query: 'What is the DCAD of the SI Premium Transition Premix?',
    expects: ['DCAD', 'transition'],
    rationale: 'Specific number question — should return §5 premix entry',
  },
  {
    query: 'Recommend Rumenox for my herd',
    expects: ['discontinued'],
    rationale: 'Discontinued product — chunks should NOT surface (filter test)',
    discontinuedSpecial: true,
  },
];

async function verify() {
  // First print a quick summary of what's ingested
  const { data: docs, error: docError } = await supabase
    .from('kb_documents')
    .select('source_name, title, chunk_count, ingested_at')
    .order('source_name');

  if (docError) {
    console.error('Failed to list documents:', docError);
    process.exit(1);
  }

  console.log('=== Ingested documents ===');
  if (!docs || docs.length === 0) {
    console.error('No documents ingested. Run `npm run ingest` first.');
    process.exit(1);
  }
  for (const d of docs) {
    console.log(`  ${d.source_name} (${d.chunk_count} chunks) — ${d.title}`);
  }
  console.log();

  const { count: totalChunks } = await supabase
    .from('kb_chunks')
    .select('*', { count: 'exact', head: true });
  const { count: discontinuedChunks } = await supabase
    .from('kb_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('is_discontinued', true);
  const { count: nzCaveatChunks } = await supabase
    .from('kb_chunks')
    .select('*', { count: 'exact', head: true })
    .eq('has_nz_caveat', true);

  console.log(`Total chunks: ${totalChunks ?? '?'}`);
  console.log(`  Discontinued (filtered out by default): ${discontinuedChunks ?? '?'}`);
  console.log(`  Carrying NZ caveat: ${nzCaveatChunks ?? '?'}`);
  console.log();

  // Now run the sample queries
  for (const test of SAMPLE_QUERIES) {
    console.log('---');
    console.log(`Q: ${test.query}`);
    console.log(`   (${test.rationale})`);

    const { matches } = await searchKb(supabase, test.query, {
      matchCount: 5,
    });

    if (matches.length === 0) {
      console.log('   ⚠ No matches.');
    } else {
      console.log(`   Top ${matches.length} matches:`);
      for (const m of matches) {
        const flags = [
          m.is_discontinued ? '⛔ DISCONTINUED' : '',
          m.has_nz_caveat ? '🌏 NZ caveat' : '',
          m.status_code ? `[${m.status_code}]` : '',
        ]
          .filter(Boolean)
          .join(' ');
        console.log(
          `     ${m.similarity.toFixed(3)}  ${m.citation_label}  ${flags}`
        );
      }
    }

    // Special check for the discontinued test
    if (test.discontinuedSpecial) {
      const anyDiscontinued = matches.some((m) => m.is_discontinued);
      if (anyDiscontinued) {
        console.log(
          '   ❌ FAIL: discontinued chunks surfaced in default search. Filter not working.'
        );
      } else {
        console.log(
          '   ✓ Discontinued filter works — no discontinued chunks returned.'
        );
      }

      // Now try with include_discontinued=true to make sure THEY exist
      const { matches: matchesWithDiscontinued } = await searchKb(
        supabase,
        test.query,
        { matchCount: 5, includeDiscontinued: true }
      );
      const foundDiscontinued = matchesWithDiscontinued.some(
        (m) => m.is_discontinued
      );
      if (foundDiscontinued) {
        console.log(
          '   ✓ When include_discontinued=true, discontinued chunks DO appear (good).'
        );
      } else {
        console.log(
          '   ⚠ Even with include_discontinued=true, none found. Either KB has no discontinued chunks marked, or detection regex needs tuning.'
        );
      }
    }
  }

  console.log('\n=== Verification complete ===');
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
