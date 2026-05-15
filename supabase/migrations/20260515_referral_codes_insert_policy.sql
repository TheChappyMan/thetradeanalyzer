-- ── referral_codes: add INSERT policy ────────────────────────────────────────
--
-- The service_role Postgres role has BYPASSRLS, so a correctly configured
-- service-role client never evaluates RLS policies at all. This INSERT policy
-- is belt-and-suspenders for environments where the service_role key is not
-- functioning as expected (e.g. wrong key in env vars during initial setup).
--
-- Run this migration in the Supabase SQL Editor.

create policy "referral_codes: service_role insert"
  on public.referral_codes
  for insert
  to service_role
  with check (true);
