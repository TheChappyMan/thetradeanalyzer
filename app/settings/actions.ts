'use server'

import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import type { League } from '@/lib/types'
import type { NflLeague } from '@/lib/nfl-types'
import type { MlbLeague } from '@/lib/mlb-types'

type ActionResult = { success: boolean; error?: string; id?: string }

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
    const { data: existing } = await supabase
      .from('leagues')
      .select('id')
      .eq('user_id', userId)
      .eq('sport', 'nhl')
      .maybeSingle()

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

/** Create a brand-new NHL league (Tier 2). */
export async function createNhlLeague(
  name: string,
  settings: League
): Promise<ActionResult> {
  try {
    const { userId } = await auth()
    if (!userId) return { success: false, error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('leagues')
      .insert({ user_id: userId, sport: 'nhl', name: name.trim() || 'New League', settings })
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

    const { data: existing } = await supabase
      .from('leagues')
      .select('id')
      .eq('user_id', userId)
      .eq('sport', 'nfl')
      .maybeSingle()

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

/** Create a brand-new NFL league (Tier 2). */
export async function createNflLeague(
  name: string,
  settings: NflLeague
): Promise<ActionResult> {
  try {
    const { userId } = await auth()
    if (!userId) return { success: false, error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('leagues')
      .insert({ user_id: userId, sport: 'nfl', name: name.trim() || 'New League', settings })
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

    const { data: existing } = await supabase
      .from('leagues')
      .select('id')
      .eq('user_id', userId)
      .eq('sport', 'mlb')
      .maybeSingle()

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

/** Create a brand-new MLB league (Tier 2). */
export async function createMlbLeague(
  name: string,
  settings: MlbLeague
): Promise<ActionResult> {
  try {
    const { userId } = await auth()
    if (!userId) return { success: false, error: 'Not authenticated' }

    const { data, error } = await supabase
      .from('leagues')
      .insert({ user_id: userId, sport: 'mlb', name: name.trim() || 'New League', settings })
      .select('id')
      .single()
    if (error) return { success: false, error: error.message }
    return { success: true, id: data?.id }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
