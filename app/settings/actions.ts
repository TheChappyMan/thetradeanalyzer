'use server'

import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getUserTier } from '@/lib/auth'
import type { League } from '@/lib/types'
import type { NflLeague } from '@/lib/nfl-types'
import type { MlbLeague } from '@/lib/mlb-types'

type ActionResult = { success: boolean; error?: string; id?: string }

/**
 * Finds the tier-1 target row for (user, sport): the NEWEST league row.
 * Newest matches what GET /api/leagues and the tier-2 selector default to.
 *
 * Deliberately NOT `.maybeSingle()` — that errors when more than one row
 * exists, which (with the error ignored) read as "no existing league" and
 * inserted another duplicate on every tier-1 save. Ordering + limit(1)
 * keeps saves deterministic and self-healing even if duplicates exist.
 */
async function findTier1Row(
  userId: string,
  sport: 'nhl' | 'nfl' | 'mlb'
): Promise<{ id: string } | null | { error: string }> {
  const { data, error } = await supabase
    .from('leagues')
    .select('id')
    .eq('user_id', userId)
    .eq('sport', sport)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) return { error: error.message }
  return data?.[0] ?? null
}

// ── NHL ───────────────────────────────────────────────────────────────────────

/**
 * Save NHL league settings.
 * - Tier 2: pass leagueId to update a specific row by ID.
 * - Tier 1: omit leagueId — upserts by (user_id, sport) as before.
 */
export async function saveLeagueSettings(
  league: League,
  leagueId?: string
): Promise<ActionResult> {
  try {
    const { userId } = await auth()
    if (!userId) return { success: false, error: 'Not authenticated' }

    // Saved leagues are a paid feature — enforce server-side, not just in UI
    const tier = await getUserTier()
    if (tier === 'free') return { success: false, error: 'Paid subscription required' }

    const leagueName = league.name.trim() || 'My NHL League'

    if (leagueId) {
      // Tier 2: update the specific league row
      const { error } = await supabase
        .from('leagues')
        .update({ name: leagueName, settings: league })
        .eq('id', leagueId)
        .eq('user_id', userId)
      if (error) return { success: false, error: error.message }
      return { success: true, id: leagueId }
    }

    // Tier 1: upsert by (user_id, sport)
    const existing = await findTier1Row(userId, 'nhl')
    if (existing && 'error' in existing) return { success: false, error: existing.error }

    if (existing) {
      const { error } = await supabase
        .from('leagues')
        .update({ name: leagueName, settings: league })
        .eq('id', existing.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: existing.id }
    }

    const { data, error } = await supabase
      .from('leagues')
      .insert({ user_id: userId, sport: 'nhl', name: leagueName, settings: league })
      .select('id')
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: data?.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ── NFL ───────────────────────────────────────────────────────────────────────

/**
 * Save NFL league settings.
 * - Tier 2: pass leagueId to update a specific row by ID.
 * - Tier 1: omit leagueId — upserts by (user_id, sport) as before.
 */
export async function saveNflLeagueSettings(
  league: NflLeague,
  leagueId?: string
): Promise<ActionResult> {
  try {
    const { userId } = await auth()
    if (!userId) return { success: false, error: 'Not authenticated' }

    // Saved leagues are a paid feature — enforce server-side, not just in UI
    const tier = await getUserTier()
    if (tier === 'free') return { success: false, error: 'Paid subscription required' }

    const leagueName = league.name.trim() || 'My NFL League'

    if (leagueId) {
      const { error } = await supabase
        .from('leagues')
        .update({ name: leagueName, settings: league })
        .eq('id', leagueId)
        .eq('user_id', userId)
      if (error) return { success: false, error: error.message }
      return { success: true, id: leagueId }
    }

    const existing = await findTier1Row(userId, 'nfl')
    if (existing && 'error' in existing) return { success: false, error: existing.error }

    if (existing) {
      const { error } = await supabase
        .from('leagues')
        .update({ name: leagueName, settings: league })
        .eq('id', existing.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: existing.id }
    }

    const { data, error } = await supabase
      .from('leagues')
      .insert({ user_id: userId, sport: 'nfl', name: leagueName, settings: league })
      .select('id')
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: data?.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ── MLB ───────────────────────────────────────────────────────────────────────

/**
 * Save MLB league settings.
 * - Tier 2: pass leagueId to update a specific row by ID.
 * - Tier 1: omit leagueId — upserts by (user_id, sport) as before.
 */
export async function saveMlbLeagueSettings(
  league: MlbLeague,
  leagueId?: string
): Promise<ActionResult> {
  try {
    const { userId } = await auth()
    if (!userId) return { success: false, error: 'Not authenticated' }

    // Saved leagues are a paid feature — enforce server-side, not just in UI
    const tier = await getUserTier()
    if (tier === 'free') return { success: false, error: 'Paid subscription required' }

    const leagueName = league.name.trim() || 'My MLB League'

    if (leagueId) {
      const { error } = await supabase
        .from('leagues')
        .update({ name: leagueName, settings: league })
        .eq('id', leagueId)
        .eq('user_id', userId)
      if (error) return { success: false, error: error.message }
      return { success: true, id: leagueId }
    }

    const existing = await findTier1Row(userId, 'mlb')
    if (existing && 'error' in existing) return { success: false, error: existing.error }

    if (existing) {
      const { error } = await supabase
        .from('leagues')
        .update({ name: leagueName, settings: league })
        .eq('id', existing.id)
      if (error) return { success: false, error: error.message }
      return { success: true, id: existing.id }
    }

    const { data, error } = await supabase
      .from('leagues')
      .insert({ user_id: userId, sport: 'mlb', name: leagueName, settings: league })
      .select('id')
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: data?.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
