-- ── pending_tier_assignments ─────────────────────────────────────────────────
--
-- Stores tier grants for users who paid before creating a Clerk account.
-- The Helcim webhook writes a row here when no matching Clerk user exists.
-- The Clerk user.created webhook reads this table and assigns the tier
-- immediately after the account is created.
--
-- RLS is enabled; all access goes through the service role client only
-- (no user-level policies needed).

create table if not exists public.pending_tier_assignments (
  id                   uuid        primary key default gen_random_uuid(),
  email                text        not null,
  tier                 text        not null,           -- 'tier1' | 'tier2' | 'tier3'
  plan                 text,                           -- e.g. 'pro-monthly', 'commissioner'
  created_at           timestamptz not null default now(),
  assigned_at          timestamptz,                    -- set when tier is applied
  assigned_to_user_id  text                            -- Clerk user ID once matched
);

-- Index for fast email lookups on sign-up
create index if not exists pending_tier_assignments_email_idx
  on public.pending_tier_assignments (email)
  where assigned_at is null;

-- Enable Row Level Security
alter table public.pending_tier_assignments enable row level security;

-- No user-facing policies — all access is via the service role key which
-- bypasses RLS. If you ever need a non-service-role policy, add it below.
