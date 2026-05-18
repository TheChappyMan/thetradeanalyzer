-- ── insert_pending_tier_assignment RPC ────────────────────────────────────────
--
-- Provides an RPC path for the Stripe webhook handler to write pending tier
-- assignments without going through the PostgREST schema cache.
--
-- Background: the table API (.from('pending_tier_assignments')) requires
-- PostgREST to have the table in its schema cache.  If the cache was built
-- before the table was created it returns "Could not find the table in the
-- schema cache" even though the table exists.  Calling a named function via
-- supabase.rpc() routes through a different code path that does not depend
-- on the schema cache, so it works regardless of cache state.
--
-- security definer  — runs with the privileges of the function owner
--                     (superuser in Supabase) so RLS is bypassed and the
--                     insert always succeeds from the service-role client.
-- set search_path   — prevents search_path injection attacks.
--
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query).

create or replace function public.insert_pending_tier_assignment(
  p_email text,
  p_tier  text,
  p_plan  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pending_tier_assignments (email, tier, plan)
  values (p_email, p_tier, p_plan);
end;
$$;
