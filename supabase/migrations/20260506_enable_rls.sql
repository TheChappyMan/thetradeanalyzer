-- =============================================================================
-- 20260506_enable_rls.sql — Enable Row Level Security on all tables
-- =============================================================================
--
-- IMPORTANT — two layers of access control in this app:
--
--   PRIMARY:  All database operations go through server-side API routes that
--             use the Supabase SERVICE ROLE key.  The service role has the
--             BYPASSRLS privilege in Postgres, so RLS policies never execute
--             for any normal app request.  Clerk user-ID filtering is enforced
--             in the API route handlers themselves.
--
--   SAFETY NET (this file):  Enabling RLS ensures that if the anon/public key
--             were ever used or exposed, every table is locked down by default.
--             No rows are readable without an authenticated JWT.
--
-- NOTE ON auth.uid():
--   auth.uid() resolves from the Supabase Auth JWT claim "sub".  For these
--   policies to match Clerk user IDs (beyond simply blocking all anon access),
--   Clerk must be configured as a custom JWT provider for your Supabase project:
--     Supabase Dashboard → Settings → API → JWT Settings → Custom JWT secret
--     (paste the Clerk PEM public key or JWKS URL).
--   Without that integration, enabling RLS still achieves the primary goal:
--   blocking all unauthenticated direct access to the database.
--
-- Run this file in the Supabase SQL Editor (or via `supabase db push`).
-- =============================================================================


-- ── leagues ──────────────────────────────────────────────────────────────────
-- Schema: id, user_id (Clerk), sport, name, settings, created_at
-- Access: users manage only their own rows.

ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;

-- Full self-service: read, insert, update, delete own rows only.
CREATE POLICY "leagues: owner full access"
  ON leagues
  FOR ALL
  USING     (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);


-- ── trades ───────────────────────────────────────────────────────────────────
-- Schema: id, user_id (Clerk), league_id, trade_data (jsonb), created_at
-- Access: users manage their own trades; commissioners can read all trades
--         belonging to active members of their group.

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

-- Users can read, insert, and delete their own trade rows.
CREATE POLICY "trades: owner access"
  ON trades
  FOR ALL
  USING     (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- Commissioners can read trades from all active members of their group,
-- including their own trades (via the UNION branch).
CREATE POLICY "trades: commissioner read group trades"
  ON trades
  FOR SELECT
  USING (
    user_id IN (
      -- Active managers seated in the commissioner's group
      SELECT cs.member_user_id
      FROM   commissioner_seats  cs
      JOIN   commissioner_groups cg ON cg.id = cs.group_id
      WHERE  cg.commissioner_user_id = auth.uid()::text
        AND  cs.status             = 'active'
        AND  cs.member_user_id    IS NOT NULL

      UNION ALL

      -- The commissioner's own user ID
      SELECT cg.commissioner_user_id
      FROM   commissioner_groups cg
      WHERE  cg.commissioner_user_id = auth.uid()::text
    )
  );


-- ── commissioner_groups ──────────────────────────────────────────────────────
-- Schema: id, commissioner_user_id (Clerk), created_at, expires_at, grace_until
-- Access: commissioners read their own group row only.
--         All writes happen via service role (Stripe webhook, invite flow).

ALTER TABLE commissioner_groups ENABLE ROW LEVEL SECURITY;

-- Commissioners can read their own group row.
CREATE POLICY "commissioner_groups: owner read"
  ON commissioner_groups
  FOR SELECT
  USING (commissioner_user_id = auth.uid()::text);


-- ── commissioner_seats ───────────────────────────────────────────────────────
-- Schema: id, group_id, invited_email, member_user_id, status,
--         invited_at, joined_at, invite_token
-- Access: commissioners manage all seats in their group;
--         members can read their own seat row.

ALTER TABLE commissioner_seats ENABLE ROW LEVEL SECURITY;

-- Commissioners have full access to every seat in their group.
CREATE POLICY "commissioner_seats: commissioner full access"
  ON commissioner_seats
  FOR ALL
  USING (
    group_id IN (
      SELECT id
      FROM   commissioner_groups
      WHERE  commissioner_user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT id
      FROM   commissioner_groups
      WHERE  commissioner_user_id = auth.uid()::text
    )
  );

-- Members can read their own seat row (e.g., to verify active status).
CREATE POLICY "commissioner_seats: member read own seat"
  ON commissioner_seats
  FOR SELECT
  USING (member_user_id = auth.uid()::text);
