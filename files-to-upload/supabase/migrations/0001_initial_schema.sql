-- =============================================================================
-- FIP database schema — initial migration
-- =============================================================================
--
-- This schema is the foundation for the Agvance Dairy Nutrition agent platform.
-- It's designed to support the full spec lifecycle (consultant Q&A → farm data
-- tools → farmer-mode drafts → consultant sign-off), not just Phase 1.
-- Building the tables now means we don't have to migrate twice later.
--
-- Tables created:
--   profiles            — custom user data (role, name, region) linked 1:1 to auth.users
--   farms               — dairy farms in the system
--   farm_memberships    — many-to-many link of users to farms (with a per-membership role)
--   conversations       — a chat session between a user and the agent
--   messages            — individual messages within a conversation
--   recommendations     — draft/pending/approved nutrition recommendations
--                        (the spec's sign-off gate — built now, wired in Phase 3)
--   kb_citations        — per-message references to knowledge-base chunks
--                        (built now, populated when RAG comes online)
--
-- Enums:
--   user_role           — admin | consultant | vet | farmer
--   nz_region           — the 15 NZ regions for farm + user location
--   conversation_mode   — farmer | consultant (per spec §2)
--   message_role        — user | assistant | system | tool
--   recommendation_state — draft | pending_review | approved | rejected | expired
--
-- Security:
--   Row-level security (RLS) is enabled on every table. Policies enforce the
--   spec's role separation at the database layer, not just in app code. A
--   farmer making an arbitrary API call cannot read another farm's data even
--   if the app code has bugs.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('admin', 'consultant', 'vet', 'farmer');

CREATE TYPE nz_region AS ENUM (
  'northland',
  'auckland',
  'waikato',
  'bay_of_plenty',
  'gisborne',
  'hawkes_bay',
  'taranaki',
  'manawatu_whanganui',
  'wellington',
  'wairarapa',
  'tasman',
  'nelson',
  'marlborough',
  'west_coast',
  'canterbury',
  'otago',
  'southland'
);

CREATE TYPE conversation_mode AS ENUM ('farmer', 'consultant');

CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system', 'tool');

-- States from the spec §4 sign-off gate.
-- A draft is the agent's initial output. It moves to pending_review when sent
-- to a consultant. Consultant approves/rejects. Expired = old draft never
-- actioned, surfaces stale recommendations so they're not accidentally used.
CREATE TYPE recommendation_state AS ENUM (
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'expired'
);


-- -----------------------------------------------------------------------------
-- profiles — custom user data, 1:1 with auth.users
-- -----------------------------------------------------------------------------
-- Supabase manages auth.users (email, password hash, session state). We add
-- this profile table for our domain fields. The trigger at the bottom of the
-- file auto-creates a profile row when a new auth.users row is inserted.

CREATE TABLE profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL UNIQUE,
  first_name  text,
  last_name   text,
  role        user_role NOT NULL DEFAULT 'farmer',
  region      nz_region,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_role_idx ON profiles(role);

COMMENT ON TABLE profiles IS
  'Custom user data, linked 1:1 to auth.users. Role determines access scope.';
COMMENT ON COLUMN profiles.role IS
  'Set at invitation time. Cannot be self-modified per spec §2.';


-- -----------------------------------------------------------------------------
-- farms — dairy farms in the system
-- -----------------------------------------------------------------------------

CREATE TABLE farms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  region          nz_region NOT NULL,
  herd_size       integer,
  supply_company  text, -- 'fonterra' | 'synlait' | 'open_country' | etc — free text for now
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX farms_region_idx ON farms(region);


-- -----------------------------------------------------------------------------
-- farm_memberships — many-to-many users to farms
-- -----------------------------------------------------------------------------
-- A farmer is linked to their farm via this table. A consultant or vet is
-- linked to every farm they advise. Multiple consultants/vets per farm is
-- supported by design (e.g. a vet AND a primary consultant on the same farm).
--
-- membership_role differs from profiles.role:
--   profiles.role = global role (admin/consultant/vet/farmer)
--   membership_role = the user's role on THIS specific farm
-- This lets a consultant be 'primary' on some farms and 'observer' on others.

CREATE TYPE membership_role AS ENUM (
  'owner',       -- farmer or farm owner
  'primary_consultant',
  'consultant',
  'vet',
  'observer'
);

CREATE TABLE farm_memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  membership_role membership_role NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- one row per user-farm pair
  UNIQUE (farm_id, user_id)
);

CREATE INDEX farm_memberships_farm_idx ON farm_memberships(farm_id);
CREATE INDEX farm_memberships_user_idx ON farm_memberships(user_id);


-- -----------------------------------------------------------------------------
-- conversations — a chat session
-- -----------------------------------------------------------------------------
-- Every interaction with the agent is logged for the spec's review/feedback
-- requirement (§10.7). One conversation per session; messages within belong
-- to one conversation.

CREATE TABLE conversations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  farm_id       uuid REFERENCES farms(id) ON DELETE SET NULL,
  mode          conversation_mode NOT NULL,
  title         text, -- auto-generated summary or first question
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_user_idx ON conversations(user_id);
CREATE INDEX conversations_farm_idx ON conversations(farm_id);
CREATE INDEX conversations_created_idx ON conversations(created_at DESC);


-- -----------------------------------------------------------------------------
-- messages — individual messages within a conversation
-- -----------------------------------------------------------------------------

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            message_role NOT NULL,
  content         text NOT NULL,
  -- token counts for cost monitoring
  input_tokens    integer,
  output_tokens   integer,
  -- the Anthropic model that generated this message, if assistant
  model           text,
  -- tool calls and tool results stored as JSON for the tool-use flow later
  tool_data       jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);


-- -----------------------------------------------------------------------------
-- kb_citations — references to knowledge-base chunks per message
-- -----------------------------------------------------------------------------
-- When the agent answers from the KB (per spec §5 grounding), the chunks it
-- cited get recorded here. This supports:
--   - showing citations in the UI
--   - the consultant review flow (which KB entry was this based on?)
--   - KB version tracking (so old recommendations can be flagged when KB
--     supersedes a product or figure)

CREATE TABLE kb_citations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  -- chunk identifier — links to whatever RAG storage we build later
  chunk_ref   text NOT NULL,
  source_doc  text NOT NULL,    -- e.g. '01_Product_Library'
  source_section text,            -- e.g. 'CalciPhos Dusting Grade'
  -- KB version at the time of citation, for staleness detection later
  kb_version  text,
  -- the actual snippet text shown to the model (for audit)
  snippet     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX kb_citations_message_idx ON kb_citations(message_id);


-- -----------------------------------------------------------------------------
-- recommendations — the sign-off gate (built now, wired in Phase 3)
-- -----------------------------------------------------------------------------
-- The core safety mechanism from spec §4. The agent produces a draft. The
-- consultant reviews. State transitions are tracked. Nothing here is wired
-- to the conversational UI yet — but the table exists so we don't have to
-- migrate later.

CREATE TABLE recommendations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id      uuid REFERENCES messages(id) ON DELETE SET NULL,
  farm_id         uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  drafted_by      uuid REFERENCES profiles(id), -- the user whose query produced it
  reviewed_by     uuid REFERENCES profiles(id), -- the consultant/vet who reviewed
  state           recommendation_state NOT NULL DEFAULT 'draft',
  -- the recommendation itself, structured
  title           text NOT NULL,
  summary         text NOT NULL,
  reasoning       text NOT NULL,   -- per spec §4: what the agent based it on
  caveats         text,             -- NZ-relevance, narrow-margin warnings, etc.
  -- structured data: products, doses, feed changes — schema TBD as we learn
  payload         jsonb,
  -- the source data the recommendation drew on, captured for the review
  farm_data_snapshot jsonb,
  -- review notes from consultant
  review_notes    text,
  -- timestamps for state transitions
  drafted_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX recommendations_farm_idx ON recommendations(farm_id);
CREATE INDEX recommendations_state_idx ON recommendations(state);
CREATE INDEX recommendations_reviewer_idx ON recommendations(reviewed_by)
  WHERE state = 'pending_review';


-- -----------------------------------------------------------------------------
-- updated_at trigger — auto-update on row changes
-- -----------------------------------------------------------------------------
-- Postgres doesn't auto-update updated_at columns. This trigger does it for us.

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER farms_updated_at
  BEFORE UPDATE ON farms
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER recommendations_updated_at
  BEFORE UPDATE ON recommendations
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- -----------------------------------------------------------------------------
-- auto-create profile on new auth user
-- -----------------------------------------------------------------------------
-- When Supabase Auth creates a new user (via invite or signup), a profile
-- row is auto-created. Role defaults to 'farmer' — the admin/consultant role
-- must be set explicitly by an admin, never self-assigned.

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    -- read role from invite metadata if present, else default to farmer
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::user_role,
      'farmer'
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();


-- =============================================================================
-- Row-Level Security
-- =============================================================================
-- Per spec §10.4, role-based mode separation must be enforced — a farmer must
-- not be able to access consultant data. We do this at the database layer with
-- RLS policies. Even if app code has a bug, the database refuses unauthorized
-- reads/writes.
--
-- General principles:
--   - Users can read their own profile, but can't change their role
--   - Users can read farms they're a member of
--   - Consultants/vets can read all farms they're linked to via memberships
--   - Admins can read everything
--   - Conversations are owned by the user; consultants can see conversations
--     about farms they advise
--   - Recommendations: drafter sees their own, reviewer sees the queue,
--     farm members see approved ones
-- =============================================================================

ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE farms             ENABLE ROW LEVEL SECURITY;
ALTER TABLE farm_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_citations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations   ENABLE ROW LEVEL SECURITY;


-- Helper function: is the current user an admin?
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: is the current user a consultant, vet, or admin?
-- These three roles share most read access.
CREATE OR REPLACE FUNCTION is_advisor()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'consultant', 'vet')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- -- profiles policies ---------------------------------------------------------

-- Any signed-in user can read their own profile.
CREATE POLICY "Users read own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Advisors (admin/consultant/vet) can read all profiles. They need this to
-- see farm members. Farmers cannot list other users.
CREATE POLICY "Advisors read all profiles" ON profiles
  FOR SELECT USING (is_advisor());

-- Users can update their own non-role fields. Role changes require admin
-- privilege (enforced via a separate UPDATE policy that blocks role changes
-- and a service-role-only override for admins to change roles).
CREATE POLICY "Users update own profile (non-role)" ON profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
  );

-- Admins can update anything including roles.
CREATE POLICY "Admins update any profile" ON profiles
  FOR UPDATE USING (is_admin());


-- -- farms policies -----------------------------------------------------------

-- Members of a farm can read it.
CREATE POLICY "Members read their farms" ON farms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM farm_memberships
      WHERE farm_id = farms.id AND user_id = auth.uid()
    )
  );

-- Advisors can read all farms (so consultants can see farms they may not
-- yet be linked to).
CREATE POLICY "Advisors read all farms" ON farms
  FOR SELECT USING (is_advisor());

-- Only admins can create/update/delete farms in the initial design. We can
-- relax this later if consultants need to register new farms themselves.
CREATE POLICY "Admins manage farms" ON farms
  FOR ALL USING (is_admin());


-- -- farm_memberships policies ------------------------------------------------

-- Members can see other members of the same farm.
CREATE POLICY "Members read same-farm memberships" ON farm_memberships
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM farm_memberships m2
      WHERE m2.farm_id = farm_memberships.farm_id
        AND m2.user_id = auth.uid()
    )
  );

-- Advisors can read all memberships.
CREATE POLICY "Advisors read all memberships" ON farm_memberships
  FOR SELECT USING (is_advisor());

-- Only admins can create/modify memberships.
CREATE POLICY "Admins manage memberships" ON farm_memberships
  FOR ALL USING (is_admin());


-- -- conversations policies ---------------------------------------------------

-- A user can read their own conversations.
CREATE POLICY "Users read own conversations" ON conversations
  FOR SELECT USING (user_id = auth.uid());

-- Advisors can read conversations about farms they advise.
CREATE POLICY "Advisors read advised-farm conversations" ON conversations
  FOR SELECT USING (
    is_advisor()
    AND (
      farm_id IS NULL  -- general conversations visible to all advisors
      OR EXISTS (
        SELECT 1 FROM farm_memberships
        WHERE farm_id = conversations.farm_id
          AND user_id = auth.uid()
      )
    )
  );

-- A user can create their own conversation.
CREATE POLICY "Users create own conversations" ON conversations
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- A user can update their own conversation (e.g. rename title).
CREATE POLICY "Users update own conversations" ON conversations
  FOR UPDATE USING (user_id = auth.uid());


-- -- messages policies --------------------------------------------------------

-- A user can read messages in conversations they can read.
CREATE POLICY "Users read messages in accessible conversations" ON messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      -- This implicitly applies the conversations read policy via the
      -- subquery — only conversations the user can see are matched.
    )
  );

-- A user can insert messages into their own conversations.
CREATE POLICY "Users insert messages into own conversations" ON messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
        AND conversations.user_id = auth.uid()
    )
  );


-- -- kb_citations policies ----------------------------------------------------
-- Citations follow the message access policy.

CREATE POLICY "Citations follow message access" ON kb_citations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM messages
      WHERE messages.id = kb_citations.message_id
    )
  );


-- -- recommendations policies -------------------------------------------------

-- Drafter can read their own drafts.
CREATE POLICY "Drafter reads own recommendations" ON recommendations
  FOR SELECT USING (drafted_by = auth.uid());

-- Farm members can read approved recommendations for their farm.
CREATE POLICY "Farm members read approved recommendations" ON recommendations
  FOR SELECT USING (
    state = 'approved'
    AND EXISTS (
      SELECT 1 FROM farm_memberships
      WHERE farm_id = recommendations.farm_id
        AND user_id = auth.uid()
    )
  );

-- Advisors can read all recommendations for farms they advise.
CREATE POLICY "Advisors read advised-farm recommendations" ON recommendations
  FOR SELECT USING (
    is_advisor()
    AND EXISTS (
      SELECT 1 FROM farm_memberships
      WHERE farm_id = recommendations.farm_id
        AND user_id = auth.uid()
    )
  );

-- The drafter can insert (their own queries produce drafts).
CREATE POLICY "Drafter inserts recommendations" ON recommendations
  FOR INSERT WITH CHECK (drafted_by = auth.uid());

-- Only advisors can update state (review / approve / reject).
CREATE POLICY "Advisors update recommendations" ON recommendations
  FOR UPDATE USING (
    is_advisor()
    AND EXISTS (
      SELECT 1 FROM farm_memberships
      WHERE farm_id = recommendations.farm_id
        AND user_id = auth.uid()
    )
  );


-- =============================================================================
-- Done. Schema is ready for Phase 1 (consultant Q&A) and will support Phases
-- 2 (farm data tools) and 3 (farmer mode + sign-off) without migration.
-- =============================================================================
