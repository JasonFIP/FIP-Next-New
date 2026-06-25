/**
 * KB ingestion script — runs locally on Windows, not on Vercel.
 *
 * What it does:
 *   1. Reads .md files from a local directory (default: ./kb-source)
 *   2. Chunks each at markdown section boundaries (## and ### headings)
 *   3. Extracts metadata (version status, source_type, discontinued flag, NZ caveat)
 *   4. Embeds each chunk with Voyage 3.5
 *   5. Writes everything to Supabase via service_role (bypasses RLS)
 *
 * Idempotent: if a source file's content hasn't changed, the script skips it.
 * To force re-ingestion, pass --force or delete the kb_documents row.
 *
 * Usage:
 *   npm run ingest                  # ingest all .md files in ./kb-source
 *   npm run ingest -- --force       # force re-ingestion of unchanged files
 *   npm run ingest -- --dir ./path  # ingest from a different directory
 *
 * Environment variables required (read from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (bypasses RLS — handle with care)
 *   VOYAGE_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { embedTexts, VOYAGE_EMBEDDING_DIMS } from '../lib/voyage';

/** Pause helper. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Embed with exponential backoff on rate-limit errors. Voyage's free tier is
 * throttled (~3 req/min); without this, a 429 throws and the document's chunks
 * are silently lost. With it, a throttle just pauses the run and retries.
 */
async function embedTextsWithRetry(
  texts: string[],
  maxRetries = 6
): Promise<{ embeddings: number[][]; tokensUsed: number }> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await embedTexts(texts, 'document');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit = /\b429\b|rate.?limit|too many requests/i.test(msg);
      if (!isRateLimit || attempt >= maxRetries) throw err;
      attempt += 1;
      const waitMs = Math.min(60000, 2000 * 2 ** (attempt - 1)); // 2,4,8,16,32,60s
      console.warn(
        `    ⏳ Voyage rate-limited; backing off ${Math.round(
          waitMs / 1000
        )}s (retry ${attempt}/${maxRetries})…`
      );
      await sleep(waitMs);
    }
  }
}

// Load .env.local if present
loadEnv({ path: '.env.local' });
loadEnv(); // also load .env as fallback

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !VOYAGE_KEY) {
  console.error('Missing required env vars. Need:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL');
  console.error('  SUPABASE_SERVICE_ROLE_KEY');
  console.error('  VOYAGE_API_KEY');
  console.error('Add these to .env.local in the project root.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const force = args.includes('--force');
const dirArgIdx = args.indexOf('--dir');
const sourceDir = resolve(
  dirArgIdx >= 0 && args[dirArgIdx + 1] ? args[dirArgIdx + 1] : './kb-source'
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Chunk {
  heading: string;
  headingLevel: number;
  position: number;
  citationPath: string[]; // e.g. ['§ 5 CalSea Powder Advance']
  content: string;
  tokenCount: number;
}

interface DocumentMeta {
  sourceName: string;
  title: string;
  version: string | null;
  sourceType: 'agvance' | 'evidence' | 'spec' | 'reference';
}

// ---------------------------------------------------------------------------
// Helpers — metadata extraction
// ---------------------------------------------------------------------------

/**
 * Classify a source file by its filename. The naming convention in the KB
 * is consistent enough to make this reliable:
 *   01_Product_Library, 02_Rumen_Health, 03_Seasonal_FE, 05_Premix → agvance
 *   04_Evidence_Notes*                                              → evidence
 *   06_Feed_Reference_Tables                                        → reference
 *   07_Agent_Behaviour_Spec                                         → spec
 */
function classifySource(filename: string): DocumentMeta['sourceType'] {
  if (filename.startsWith('04_Evidence_Notes')) return 'evidence';
  if (filename.startsWith('06_Feed_Reference')) return 'reference';
  if (filename.startsWith('07_Agent_Behaviour')) return 'spec';
  return 'agvance';
}

/**
 * Pull the first H1 heading from the markdown as a friendly title.
 * If absent, fall back to the cleaned filename.
 */
function extractTitle(content: string, filename: string): string {
  const h1Match = content.match(/^#\s+(.+?)$/m);
  if (h1Match) {
    return h1Match[1]
      .replace(/\(v\d+\)/i, '')
      .trim();
  }
  return filename.replace(/\.md$/, '').replace(/_/g, ' ');
}

/**
 * Pull a version tag like "(v1)" or "(v3)" from the first H1.
 */
function extractVersion(content: string): string | null {
  const versionMatch = content.match(/^#\s+.+?\(v(\d+)\)/m);
  return versionMatch ? `v${versionMatch[1]}` : null;
}

/**
 * Detect the version status of a chunk from KB conventions.
 * Returns the short code: 'green' | 'yellow' | 'red' | 'black' | null
 *
 * The KB uses:
 *   ✅ = complete/verified  → 'green'
 *   🟡 = field incomplete   → 'yellow'
 *   🔴 = gap, needs source  → 'red'
 *   ⬛ = discontinued       → 'black'
 *
 * If a section explicitly mentions "discontinued" or "no longer stocked",
 * we also flag is_discontinued=true regardless of icon.
 */
function detectStatus(content: string): {
  statusCode: string | null;
  isDiscontinued: boolean;
} {
  // Check for status icons. Skip if the chunk is a legend explaining what
  // the icons mean (the v3 changes header in 01_Product_Library, for example).
  const isLegendChunk =
    /✅\s*=/.test(content) ||
    /🟡\s*=/.test(content) ||
    /🔴\s*=/.test(content) ||
    /⬛\s*=/.test(content);

  let statusCode: string | null = null;
  if (!isLegendChunk) {
    // For the chunk's *own* status, look at the heading line specifically.
    // A status icon in the heading applies to the whole chunk; one in the
    // body might just be flagging a sub-item.
    const headingLine = content.split('\n')[0] ?? '';
    if (headingLine.includes('⬛')) statusCode = 'black';
    else if (headingLine.includes('🔴')) statusCode = 'red';
    else if (headingLine.includes('🟡')) statusCode = 'yellow';
    else if (headingLine.includes('✅')) statusCode = 'green';
    // Fall back to scanning the rest only if no heading-level icon
    else if (content.includes('⬛')) statusCode = 'black';
    else if (content.includes('🔴')) statusCode = 'red';
    else if (content.includes('🟡')) statusCode = 'yellow';
    else if (content.includes('✅')) statusCode = 'green';
  }

  // Discontinued detection — MUCH more conservative than before.
  //
  // We only flag a chunk as discontinued if it's clearly ABOUT a discontinued
  // product, not just mentioning one. The strongest signal is the heading
  // itself: if the chunk's heading says "Discontinued" or carries ⬛, it's
  // the discontinued register or a discontinued product entry. Mentions of
  // discontinued products inside another product's section, or in the
  // grounding rules, etc., are not flagged.
  //
  // False positives matter here: flagging the wrong chunk means the agent
  // can't recommend a valid product. So we err toward letting some
  // discontinued chunks through (the agent's system prompt in step 3 also
  // tells it never to recommend specific named discontinued products).
  const headingLine = content.split('\n')[0] ?? '';
  const isDiscontinued =
    // The heading itself says "Discontinued"
    /^#+\s+.*\bdiscontinued\b/i.test(headingLine) ||
    // The heading carries the ⬛ icon
    headingLine.includes('⬛');

  return { statusCode, isDiscontinued };
}

/**
 * Detect whether a chunk carries an NZ-context caveat. These need to be
 * surfaced when cited, so the agent flags them in its responses.
 *
 * Markers we look for:
 *   "NZ-relevance gate"
 *   "NZ-context caution"
 *   "NZ-context note"
 *   "in NZ specifically"
 *   "in a NZ context"
 */
function detectNzCaveat(content: string): boolean {
  return (
    /NZ-relevance\s+gate/i.test(content) ||
    /NZ-context\s+(caution|note|flag)/i.test(content) ||
    /\bin NZ specifically\b/i.test(content) ||
    /\bin a NZ context\b/i.test(content)
  );
}

/**
 * Rough token count — chars / 4. Good enough for monitoring; we don't use it
 * for any hard limit because Voyage's window is huge.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * SHA-256 hash of source content. Used to skip re-ingestion when the file
 * hasn't changed.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/**
 * Split a markdown document into chunks at heading boundaries.
 *
 * Strategy:
 *   - Each chunk starts at an H2 (`## `) or H3 (`### `) heading
 *   - The chunk includes the heading line + all content up to the next
 *     same-or-higher-level heading
 *   - H1 headings are document-level and create one "preamble" chunk
 *     containing everything before the first H2
 *   - For each chunk, the citation path includes the parent H2 when the
 *     chunk is an H3
 *
 * Why not split further: section-level coherence is what makes this KB work.
 * The phosphate-vs-P rule, the discontinued register, the hierarchy rule —
 * all of these are statements that must travel with their section header
 * and surrounding context, or retrieval loses the meaning.
 */
function chunkMarkdown(content: string, sourceName: string): Chunk[] {
  const lines = content.split('\n');
  const chunks: Chunk[] = [];

  // Track the current heading at each level so child chunks inherit
  // the right citation path. When a higher-level heading is hit, lower-level
  // entries are cleared.
  let currentH1: string | null = null;
  let currentH2: string | null = null;

  // Buffer for the current chunk
  let currentChunk: {
    heading: string;
    headingLevel: number;
    citationPath: string[];
    lines: string[];
  } | null = null;

  // Position counter (1-indexed)
  let position = 0;

  const flushChunk = () => {
    if (!currentChunk) return;
    const text = currentChunk.lines.join('\n').trim();
    if (text.length === 0) {
      currentChunk = null;
      return;
    }
    position += 1;
    chunks.push({
      heading: currentChunk.heading,
      headingLevel: currentChunk.headingLevel,
      position,
      citationPath: currentChunk.citationPath,
      content: text,
      tokenCount: estimateTokens(text),
    });
    currentChunk = null;
  };

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);

    if (h1Match) {
      flushChunk();
      const h1 = h1Match[1].trim();
      currentH1 = h1;
      // Reset H2 — a new H1 means we're in a new top-level section
      currentH2 = null;
      currentChunk = {
        heading: h1,
        headingLevel: 1,
        citationPath: [h1],
        lines: [line],
      };
    } else if (h2Match) {
      flushChunk();
      const h2 = h2Match[1].trim();
      currentH2 = h2;
      // Build the citation path with H1 parent if there is one
      const path = currentH1 ? [currentH1, h2] : [h2];
      currentChunk = {
        heading: h2,
        headingLevel: 2,
        citationPath: path,
        lines: [line],
      };
    } else if (h3Match) {
      flushChunk();
      const h3 = h3Match[1].trim();
      // Build the citation path with all available parents
      const path: string[] = [];
      if (currentH1) path.push(currentH1);
      if (currentH2) path.push(currentH2);
      path.push(h3);
      currentChunk = {
        heading: h3,
        headingLevel: 3,
        citationPath: path,
        lines: [line],
      };
    } else {
      // Body line — append to current chunk
      if (currentChunk) {
        currentChunk.lines.push(line);
      }
    }
  }

  // Flush the last chunk
  flushChunk();

  return chunks;
}

// ---------------------------------------------------------------------------
// Main ingestion routine
// ---------------------------------------------------------------------------

interface IngestStats {
  filesProcessed: number;
  filesSkipped: number;
  chunksWritten: number;
  totalTokensEmbedded: number;
}

async function ingest(): Promise<IngestStats> {
  const stats: IngestStats = {
    filesProcessed: 0,
    filesSkipped: 0,
    chunksWritten: 0,
    totalTokensEmbedded: 0,
  };

  console.log(`Reading from: ${sourceDir}`);

  // Read all .md files from the source directory
  let filenames: string[];
  try {
    filenames = (await readdir(sourceDir))
      .filter((n) => n.endsWith('.md'))
      .sort();
  } catch (err) {
    console.error(`Failed to read directory ${sourceDir}:`, err);
    console.error('Make sure the kb-source folder exists with your .md files.');
    process.exit(1);
  }

  if (filenames.length === 0) {
    console.error('No .md files found in source directory.');
    process.exit(1);
  }

  console.log(`Found ${filenames.length} markdown files`);

  for (const filename of filenames) {
    const filepath = join(sourceDir, filename);
    const content = await readFile(filepath, 'utf8');
    const hash = hashContent(content);

    const sourceName = filename;
    const title = extractTitle(content, filename);
    const version = extractVersion(content);
    const sourceType = classifySource(filename);

    console.log(`\n${filename}`);
    console.log(`  Title: ${title}`);
    console.log(`  Version: ${version ?? '(none)'}`);
    console.log(`  Type: ${sourceType}`);

    // Check if we've already ingested this exact version
    const { data: existingDoc, error: lookupError } = await supabase
      .from('kb_documents')
      .select('id, content_hash, chunk_count')
      .eq('source_name', sourceName)
      .maybeSingle();

    if (lookupError) {
      console.error(`  Lookup error: ${lookupError.message}`);
      continue;
    }

    // Self-healing skip: skip only if the file is unchanged AND its chunks
    // actually landed in the DB. A doc row with 0 chunks (e.g. a past
    // rate-limited run that recorded a count but never inserted) is always
    // re-ingested, even when the source file is unchanged.
    let existingChunkCount = 0;
    if (existingDoc) {
      const { count } = await supabase
        .from('kb_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('document_id', existingDoc.id);
      existingChunkCount = count ?? 0;
    }

    if (
      existingDoc &&
      existingDoc.content_hash === hash &&
      existingChunkCount > 0 &&
      !force
    ) {
      console.log(`  ✓ Unchanged (${existingChunkCount} chunks). Skipping.`);
      stats.filesSkipped += 1;
      continue;
    }
    if (existingDoc && existingChunkCount === 0) {
      console.log(
        `  ⚠ Document row exists but has 0 chunks — re-ingesting to repair.`
      );
    }

    // Chunk it
    const chunks = chunkMarkdown(content, sourceName);
    console.log(`  Chunks: ${chunks.length}`);

    if (chunks.length === 0) {
      console.warn(`  ⚠ No chunks produced. Skipping.`);
      continue;
    }

    // Upsert document row
    const { data: docRow, error: upsertError } = await supabase
      .from('kb_documents')
      .upsert(
        {
          ...(existingDoc ? { id: existingDoc.id } : {}),
          source_name: sourceName,
          title,
          version,
          content_hash: hash,
          source_length: content.length,
          chunk_count: chunks.length,
          ingested_at: new Date().toISOString(),
        },
        { onConflict: 'source_name' }
      )
      .select('id')
      .single();

    if (upsertError || !docRow) {
      console.error(`  Failed to upsert document: ${upsertError?.message}`);
      continue;
    }

    const documentId = docRow.id;

    // Delete old chunks if we're re-ingesting this document
    if (existingDoc) {
      const { error: deleteError } = await supabase
        .from('kb_chunks')
        .delete()
        .eq('document_id', documentId);
      if (deleteError) {
        console.error(`  Failed to delete old chunks: ${deleteError.message}`);
        continue;
      }
    }

    // Embed chunks in batches of 64
    const BATCH_SIZE = 64;
    let chunksInsertedForDoc = 0;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => c.content);

      console.log(
        `  Embedding batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)} (${batch.length} chunks)...`
      );

      const { embeddings, tokensUsed } = await embedTextsWithRetry(texts);
      stats.totalTokensEmbedded += tokensUsed;

      // Build the insert rows
      const rows = batch.map((chunk, idx) => {
        const { statusCode, isDiscontinued } = detectStatus(chunk.content);
        const hasNzCaveat = detectNzCaveat(chunk.content);
        const citationLabel = `${sourceName} > ${chunk.citationPath.join(' > ')}`;

        return {
          document_id: documentId,
          citation_label: citationLabel,
          heading: chunk.heading,
          heading_level: chunk.headingLevel,
          position: chunk.position,
          content: chunk.content,
          embedding: embeddings[idx] as unknown as string,
          source_name: sourceName,
          status_code: statusCode,
          source_type: sourceType,
          is_discontinued: isDiscontinued,
          has_nz_caveat: hasNzCaveat,
          metadata: {
            citation_path: chunk.citationPath,
            doc_version: version,
            doc_title: title,
          },
          token_count: chunk.tokenCount,
        };
      });

      const { error: insertError } = await supabase
        .from('kb_chunks')
        .insert(rows);

      if (insertError) {
        console.error(`  Failed to insert chunks: ${insertError.message}`);
        break;
      }
      chunksInsertedForDoc += batch.length;
      await sleep(1000); // smooth out bursts under the free-tier rate limit
    }

    if (chunksInsertedForDoc < chunks.length) {
      // Didn't complete. Record the true count so the row doesn't masquerade
      // as done — the self-healing skip above will re-ingest it on the next run.
      await supabase
        .from('kb_documents')
        .update({ chunk_count: chunksInsertedForDoc })
        .eq('id', documentId);
      console.error(
        `  ✗ Incomplete: wrote ${chunksInsertedForDoc}/${chunks.length} chunks. Re-run to repair.`
      );
    } else {
      console.log(`  ✓ Wrote ${chunksInsertedForDoc} chunks.`);
    }
    stats.filesProcessed += 1;
    stats.chunksWritten += chunksInsertedForDoc;
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

ingest()
  .then((stats) => {
    console.log('\n=== Ingestion complete ===');
    console.log(`  Files processed:   ${stats.filesProcessed}`);
    console.log(`  Files skipped:     ${stats.filesSkipped}`);
    console.log(`  Chunks written:    ${stats.chunksWritten}`);
    console.log(`  Tokens embedded:   ${stats.totalTokensEmbedded.toLocaleString()}`);
    console.log(
      `  Voyage 3.5 free tier: 200,000,000 tokens — used ${((stats.totalTokensEmbedded / 200_000_000) * 100).toFixed(4)}% of it.`
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error('Ingestion failed:', err);
    process.exit(1);
  });
