-- ── feedback ─────────────────────────────────────────────────────────────────
--
-- Accuracy ratings (1-10) with optional free-text comments, submitted from
-- the bottom of each analyzer page. Anonymous submissions allowed — user_id
-- is set when the visitor is signed in.
--
-- All reads/writes go through the service role client (API route + admin
-- page); RLS is enabled with no user-facing policies.

create table if not exists public.feedback (
  id         uuid        primary key default gen_random_uuid(),
  user_id    text,                                       -- Clerk ID; null = anonymous
  sport      text        not null,                       -- 'nhl' | 'nfl' | 'mlb'
  rating     int         not null check (rating between 1 and 10),
  comments   text,                                       -- optional, max enforced in API
  created_at timestamptz not null default now()
);

create index if not exists feedback_sport_idx      on public.feedback (sport);
create index if not exists feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

-- No user-facing policies — all access is via the service role key.
