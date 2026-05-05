-- ============================================================
-- Tier 3 / Commissioner Groups schema
-- Run this migration in Supabase SQL Editor.
-- ============================================================

-- commissioner_groups
-- One row per active Tier 3 subscription.
-- The commissioner is the account that paid; they are NOT in commissioner_seats.
CREATE TABLE IF NOT EXISTS commissioner_groups (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  commissioner_user_id text        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  -- Set when renewal lapses; managers retain access until grace_until, then revert.
  grace_until          timestamptz
);

CREATE INDEX IF NOT EXISTS commissioner_groups_user_idx
  ON commissioner_groups (commissioner_user_id);

-- commissioner_seats
-- Up to 11 manager seats per group (plus the commissioner = 12 total).
CREATE TABLE IF NOT EXISTS commissioner_seats (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid        NOT NULL REFERENCES commissioner_groups(id) ON DELETE CASCADE,
  invited_email    text        NOT NULL,
  -- Populated when the invite is accepted (Clerk userId of the manager).
  member_user_id   text,
  -- pending → active (on accept) → removed (by commissioner)
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'active', 'removed')),
  invited_at       timestamptz NOT NULL DEFAULT now(),
  joined_at        timestamptz,
  -- UUID token embedded in the invite link; single-use.
  invite_token     text        UNIQUE NOT NULL DEFAULT gen_random_uuid()::text
);

CREATE INDEX IF NOT EXISTS commissioner_seats_group_idx
  ON commissioner_seats (group_id);

CREATE INDEX IF NOT EXISTS commissioner_seats_member_idx
  ON commissioner_seats (member_user_id);

CREATE INDEX IF NOT EXISTS commissioner_seats_token_idx
  ON commissioner_seats (invite_token);

-- ── Tier resolution notes ────────────────────────────────────────────────────
-- Personal tier lives in Clerk publicMetadata.tier ('free'|'tier1'|'tier2'|'tier3').
-- Commissioners: publicMetadata.tier = 'tier3'
-- Group managers (on join): publicMetadata.tier is upgraded to 'tier2';
--   original value saved to publicMetadata._personalTier.
-- Group managers (on remove / grace expiry): publicMetadata.tier is restored
--   from publicMetadata._personalTier (or 'free' if absent).
-- Grace period enforcement is handled by the Stripe subscription webhook:
--   it sets grace_until = now + 7 days, then revokes at expiry.
