-- =============================================================================
-- FIP database schema — step 2 migration
-- =============================================================================
--
-- Adds the knowledge-base ingestion + retrieval layer on top of the step 1
-- foundation. New tables:
--   kb_documents      — one row per source markdown file
--   kb_chunks         — one row per section-level chunk with embedding
--   message_feedback  — per-message feedback (thumbs/correction) — supports
--                       Option A continuous learning (logged + human-curated)
--
-- New extension:
--   pgvector          — vector similarity search inside Postgres
--
-- New RPC function:
--   match_kb_chunks   — cosine-similarity search with filters baked in
--                       (excludes discontinued products by default, can
--                       filter by source doc, by version status, etc.)
--
-- Security:
--   All new tables get RLS. Only advisors can write; everyone signed-in can
--   read (because everyone needs to query the KB for chat). Service-role
--   client (used by the ingestion script) bypasses RLS.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- pgvector extension
-- -----------------------------------------------------------------------------
-- This adds the `vector` type and operators for similarity search.
-- Supabase has pgvector available; this just enables it for this database.

CREATE EXTENSION IF NOT EXISTS vector;


-- -----------------------------------------------------------------------------
-- kb_documents — one row per source markdown file
-- -----------------------------------------------------------------------------
-- Tracks which source files have been ingested, when, at what version, and
-- with what status. Lets the ingestion script know what to re-ingest and
-- gives the agent's citation layer something to point to.

CREATE TABLE kb_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The source filename, e.g. '01_Product_Library.md'. Unique.
  source_name     text NOT NULL UNIQUE,
  -- A human-friendly title pulled from the first H1 of the file.
  title           text NOT NULL,
  -- Version tag if present in the doc, e.g. 'v1', 'v2', 'v3'
  version         text,
  -- Hash of the source content. If the source file hasn't changed, we skip
  -- re-ingestion.
  content_hash    text NOT NULL,
  -- Length of source in chars (helpful for monitoring).
  source_length   integer NOT NULL,
  -- Number of chunks this document produced.
  chunk_count     integer NOT NULL DEFAULT 0,
  -- Timestamps
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX kb_documents_source_idx ON kb_documents(source_name);

COMMENT ON TABLE kb_documents IS
  'Source markdown files for the knowledge base. One row per file.';


-- -----------------------------------------------------------------------------
-- kb_chunks — section-level chunks with embeddings + metadata
-- -----------------------------------------------------------------------------
-- The retrieval-ready content. Each row is one chunk: a section of a source
-- document with its embedding and the metadata the agent needs at query time.
--
-- Embedding dimension: 1024 (Voyage 3.5 default). If we ever switch embedding
-- models, this migration would need to be rerun with a different dimension.

CREATE TABLE kb_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  -- Source identifier for citations: doc + section path
  -- e.g. '01_Product_Library.md > § 5 CalSea Powder Advance'
  citation_label  text NOT NULL,
  -- The chunk's heading text (just the heading itself, not the path)
  heading         text NOT NULL,
  -- Heading level (1=#, 2=##, 3=###, etc.)
  heading_level   integer NOT NULL,
  -- Ordering: where this chunk sits in the source document (1-indexed)
  position        integer NOT NULL,
  -- The actual chunk text (heading + body, ready for embedding/citation)
  content         text NOT NULL,
  -- The embedding vector
  embedding       vector(1024),
  -- Source name redundant with documents.source_name but cheap to denormalize
  -- (and saves a join on every search)
  source_name     text NOT NULL,
  -- Version status from the doc: '✅' | '🟡' | '🔴' | '⬛' | NULL
  -- Mapped to text codes for indexability:
  --   'green'        = ✅ complete/verified
  --   'yellow'       = 🟡 field incomplete
  --   'red'          = 🔴 gap, needs source
  --   'black'        = ⬛ discontinued / superseded
  --   NULL           = no marker
  status_code     text,
  -- Whether this chunk is Agvance source (product guidance, brochures) or
  -- evidence source (peer-reviewed assessment). Agent uses this to apply
  -- the hierarchy rule (Agvance stands; evidence assesses, never overrides).
  --   'agvance'   = Agvance product/seasonal/premix content
  --   'evidence'  = peer-reviewed evidence notes (E1-E7)
  --   'spec'      = the agent behaviour spec itself
  --   'reference' = neutral reference tables (feed comp etc)
  source_type     text NOT NULL,
  -- Discontinued flag — chunks describing discontinued products are filtered
  -- out by default in match_kb_chunks so they can't be recommended.
  is_discontinued boolean NOT NULL DEFAULT false,
  -- NZ-context relevance: chunks that explicitly carry NZ caveats are
  -- flagged so the agent can surface those in citations.
  has_nz_caveat   boolean NOT NULL DEFAULT false,
  -- Free-form metadata for things we discover we need later (cross-refs etc).
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Token count for cost monitoring + chunk-size sanity checks
  token_count     integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- HNSW index for fast cosine-similarity search.
-- The 'vector_cosine_ops' is the operator class for cosine distance.
-- HNSW (Hierarchical Navigable Small World) gives sub-millisecond ANN search.
CREATE INDEX kb_chunks_embedding_idx ON kb_chunks
  USING hnsw (embedding vector_cosine_ops);

-- Other helpful indexes
CREATE INDEX kb_chunks_document_idx ON kb_chunks(document_id);
CREATE INDEX kb_chunks_source_type_idx ON kb_chunks(source_type);
CREATE INDEX kb_chunks_discontinued_idx ON kb_chunks(is_discontinued)
  WHERE is_discontinued = true;
CREATE INDEX kb_chunks_position_idx ON kb_chunks(document_id, position);

COMMENT ON TABLE kb_chunks IS
  'Section-level chunks of KB content with embeddings. Used for similarity search.';
COMMENT ON COLUMN kb_chunks.is_discontinued IS
  'Filtered out by default in match_kb_chunks. Prevents agent from recommending discontinued products.';


-- -----------------------------------------------------------------------------
-- message_feedback — per-message feedback for continuous learning
-- -----------------------------------------------------------------------------
-- Captures thumbs-up/down on individual messages, plus structured feedback
-- when a consultant rejects a recommendation. This is the data behind the
-- Option A continuous-learning loop: failures get reviewed, KB gets edited,
-- re-ingestion improves performance.

CREATE TYPE feedback_kind AS ENUM (
  'thumbs_up',
  'thumbs_down',
  'correction',         -- consultant edited the response
  'rejected',           -- consultant rejected the recommendation
  'flag'                -- user flagged something problematic
);

CREATE TYPE feedback_reason AS ENUM (
  'stale_figure',           -- KB had old data
  'wrong_product',          -- discontinued / wrong recommendation
  'nz_context_missed',      -- overseas figure presented as NZ fact
  'phosphate_p_confusion',  -- elemental P vs phosphate basis error
  'narrow_safety_margin',   -- shouldn't have given a final dose
  'diagnosis_creep',        -- crossed into vet territory
  'hierarchy_violated',     -- evidence overrode Agvance guidance
  'hallucination',          -- fabricated a fact
  'other'                   -- free-text reason
);

CREATE TABLE message_feedback (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind            feedback_kind NOT NULL,
  reason          feedback_reason,
  notes           text,
  -- For corrections: what the user changed it to.
  corrected_text  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX message_feedback_message_idx ON message_feedback(message_id);
CREATE INDEX message_feedback_user_idx ON message_feedback(user_id);
CREATE INDEX message_feedback_kind_idx ON message_feedback(kind);
-- Compound index for the review queue: "show me all rejections with reasons this week"
CREATE INDEX message_feedback_recent_idx ON message_feedback(created_at DESC)
  WHERE kind IN ('thumbs_down', 'rejected', 'correction');


-- -----------------------------------------------------------------------------
-- updated_at trigger for kb_documents
-- -----------------------------------------------------------------------------

CREATE TRIGGER kb_documents_updated_at
  BEFORE UPDATE ON kb_documents
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- =============================================================================
-- match_kb_chunks — the similarity-search RPC
-- =============================================================================
-- Returns the top-K most-similar chunks to a query embedding, with filters
-- to enforce the spec's safety rules at the database layer.
--
-- Parameters:
--   query_embedding     — the embedded query (1024 dims, from Voyage)
--   match_threshold     — minimum cosine similarity to include (0..1)
--   match_count         — how many to return (typical: 5-10)
--   include_discontinued — if true, allow discontinued chunks (defaults to FALSE)
--   filter_source_type   — restrict to one source_type ('agvance' | 'evidence' | etc)
--                          or NULL for all
--
-- Returns: chunks ordered by similarity desc.
--
-- Why a function rather than building this in app code: the discontinued
-- filter MUST be enforced at the database level. If app code skips it
-- (bug, refactor mistake), the function still excludes discontinued chunks.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.match_kb_chunks(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.5,
  match_count integer DEFAULT 8,
  include_discontinued boolean DEFAULT false,
  filter_source_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  citation_label text,
  heading text,
  content text,
  source_name text,
  source_type text,
  status_code text,
  is_discontinued boolean,
  has_nz_caveat boolean,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    c.id,
    c.document_id,
    c.citation_label,
    c.heading,
    c.content,
    c.source_name,
    c.source_type,
    c.status_code,
    c.is_discontinued,
    c.has_nz_caveat,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM kb_chunks c
  WHERE
    c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) >= match_threshold
    AND (include_discontinued OR NOT c.is_discontinued)
    AND (filter_source_type IS NULL OR c.source_type = filter_source_type)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMENT ON FUNCTION match_kb_chunks IS
  'Semantic search over kb_chunks with safety filters. Discontinued chunks excluded by default.';


-- =============================================================================
-- Row-Level Security on the new tables
-- =============================================================================

ALTER TABLE kb_documents     ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_chunks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_feedback ENABLE ROW LEVEL SECURITY;


-- -- kb_documents policies -----------------------------------------------------
-- All signed-in users can read (everyone needs to query KB).
-- Only admins can write (ingestion uses service_role, bypasses RLS).

CREATE POLICY "Signed-in users read kb_documents" ON kb_documents
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage kb_documents" ON kb_documents
  FOR ALL USING (is_admin());


-- -- kb_chunks policies --------------------------------------------------------

CREATE POLICY "Signed-in users read kb_chunks" ON kb_chunks
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins manage kb_chunks" ON kb_chunks
  FOR ALL USING (is_admin());


-- -- message_feedback policies -------------------------------------------------
-- Users can write feedback on messages they can see, and read their own.
-- Advisors can read all feedback (to surface failures for KB curation).

CREATE POLICY "Users read own feedback" ON message_feedback
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Advisors read all feedback" ON message_feedback
  FOR SELECT USING (is_advisor());

CREATE POLICY "Users write own feedback" ON message_feedback
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM messages
      WHERE messages.id = message_feedback.message_id
      -- The messages RLS policy implicitly enforces that the user can see
      -- the message before they can feedback on it.
    )
  );

CREATE POLICY "Users update own feedback" ON message_feedback
  FOR UPDATE USING (user_id = auth.uid());


-- =============================================================================
-- Done. The KB ingestion script (scripts/ingest-kb.ts) can now populate
-- kb_documents and kb_chunks. The match_kb_chunks RPC is ready for step 3.
-- =============================================================================
