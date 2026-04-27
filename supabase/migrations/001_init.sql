-- =============================================================================
-- 001_init.sql — Initial schema for The Trade Analyzer
-- =============================================================================
-- NOTE ON ROW LEVEL SECURITY (RLS):
--   This app uses Clerk for authentication, not Supabase Auth.
--   Supabase RLS policies rely on auth.uid() which is only populated when
--   requests go through Supabase Auth JWTs.  Since we're using the service
--   role key in server-side API routes, auth.uid() is always NULL, which
--   means any policy "WHERE user_id = auth.uid()" would deny all rows.
--
--   Access control is therefore enforced in API route handlers by:
--     1. Retrieving the signed-in Clerk user ID via auth() from @clerk/nextjs/server
--     2. Passing that user_id explicitly in all queries (SELECT / INSERT / UPDATE)
--
--   RLS is left DISABLED for now.  If you later want to integrate Supabase Auth
--   alongside Clerk (or switch to Supabase Auth), re-enable RLS and update the
--   policies to match the chosen JWT claim.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- leagues
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leagues (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL,           -- Clerk user ID (e.g. "user_abc123")
  sport       TEXT        NOT NULL,           -- "nhl" | "nfl"
  name        TEXT        NOT NULL,
  settings    JSONB,                          -- arbitrary league configuration
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS is disabled — access control handled in API routes via Clerk user_id
ALTER TABLE leagues DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS leagues_user_id_idx ON leagues (user_id);

-- ---------------------------------------------------------------------------
-- trades
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     TEXT        NOT NULL,           -- Clerk user ID
  league_id   UUID        REFERENCES leagues (id) ON DELETE SET NULL,
  trade_data  JSONB       NOT NULL,           -- full trade snapshot at evaluation time
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS is disabled — access control handled in API routes via Clerk user_id
ALTER TABLE trades DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS trades_user_id_idx    ON trades (user_id);
CREATE INDEX IF NOT EXISTS trades_league_id_idx  ON trades (league_id);
