-- ── referral_codes ───────────────────────────────────────────────────────────
--
-- One row per paid user. Generated automatically when a tier is assigned.
-- Format: XXXX-NAME  (e.g. K9M2-JUSTIN)
--
-- RLS: users can read and update their own row (e-transfer email).
--      Writes (insert) happen server-side via service role.

create table if not exists public.referral_codes (
  id               uuid        primary key default gen_random_uuid(),
  user_id          text        not null,
  code             text        not null unique,
  etransfer_email  text,
  created_at       timestamptz not null default now()
);

create unique index if not exists referral_codes_user_id_idx
  on public.referral_codes (user_id);

create unique index if not exists referral_codes_code_idx
  on public.referral_codes (code);

alter table public.referral_codes enable row level security;

-- Owners can read their own row
create policy "referral_codes: owner read"
  on public.referral_codes for select
  using ( user_id = auth.uid()::text );

-- Owners can update their own row (e-transfer email only in practice)
create policy "referral_codes: owner update"
  on public.referral_codes for update
  using ( user_id = auth.uid()::text );


-- ── referral_payouts ──────────────────────────────────────────────────────────
--
-- One row per completed referral. Written by the payment webhook.
-- Admin manages these rows via the service role client.
--
-- RLS: service role only (admins use service role; no user-level access).

create table if not exists public.referral_payouts (
  id                  uuid        primary key default gen_random_uuid(),
  referral_code_id    uuid        references public.referral_codes(id),
  referrer_user_id    text,
  referred_email      text,
  referred_user_id    text,
  plan                text,
  payout_amount       numeric     not null,
  status              text        not null default 'pending',
  created_at          timestamptz not null default now(),
  paid_at             timestamptz
);

create index if not exists referral_payouts_status_idx
  on public.referral_payouts (status);

create index if not exists referral_payouts_referrer_idx
  on public.referral_payouts (referrer_user_id);

alter table public.referral_payouts enable row level security;

-- No user-facing policies — all access via service role key.
