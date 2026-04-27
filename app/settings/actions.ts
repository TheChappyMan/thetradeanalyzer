'use server'

import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import type { League } from '@/lib/types'

export async function saveLeagueSettings(
  league: League
): Promise<{ success: boolean; error?: string }> {
  try {
    const { userId } = await auth()
    if (!userId) return { success: false, error: 'Not authenticated' }

    // Check for an existing NHL league for this user
    const { data: existing } = await supabase
      .from('leagues')
      .select('id')
      .eq('user_id', userId)
      .eq('sport', 'nhl')
      .maybeSingle()

    const leagueName = league.name.trim() || 'My NHL League'

    if (existing) {
      const { error } = await supabase
        .from('leagues')
        .update({ name: leagueName, settings: league })
        .eq('id', existing.id)
      if (error) return { success: false, error: error.message }
    } else {
      const { error } = await supabase
        .from('leagues')
        .insert({ user_id: userId, sport: 'nhl', name: leagueName, settings: league })
      if (error) return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}
