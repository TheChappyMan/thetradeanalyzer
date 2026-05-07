import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { League, LeagueRow } from '@/lib/types'
import type { NflLeague } from '@/lib/nfl-types'
import type { MlbLeague } from '@/lib/mlb-types'
import NhlSettingsForm from './NhlSettingsForm'

export default async function SettingsPage() {
  // ── Auth check ──────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // ── Tier gate ────────────────────────────────────────────────
  const user = await currentUser()
  const tier = (user?.publicMetadata?.tier as string | undefined) ?? 'free'

  if (tier !== 'tier1' && tier !== 'tier2' && tier !== 'tier3') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Settings</h1>
        <div className="card text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="text-sm">This feature requires a Pro subscription.</p>
        </div>
      </div>
    )
  }

  if (tier === 'tier2' || tier === 'tier3') {
    // ── Tier 2: fetch ALL leagues for each sport ──────────────
    const [nhlResult, nflResult, mlbResult] = await Promise.all([
      supabase
        .from('leagues')
        .select('id, name, sport, settings, created_at')
        .eq('user_id', userId)
        .eq('sport', 'nhl')
        .order('created_at', { ascending: false }),
      supabase
        .from('leagues')
        .select('id, name, sport, settings, created_at')
        .eq('user_id', userId)
        .eq('sport', 'nfl')
        .order('created_at', { ascending: false }),
      supabase
        .from('leagues')
        .select('id, name, sport, settings, created_at')
        .eq('user_id', userId)
        .eq('sport', 'mlb')
        .order('created_at', { ascending: false }),
    ])

    const allNhlLeagues = (nhlResult.data ?? []) as LeagueRow[]
    const allNflLeagues = (nflResult.data ?? []) as LeagueRow[]
    const allMlbLeagues = (mlbResult.data ?? []) as LeagueRow[]

    return (
      <NhlSettingsForm
        initialLeague={(allNhlLeagues[0]?.settings ?? null) as League | null}
        initialNflLeague={(allNflLeagues[0]?.settings ?? null) as NflLeague | null}
        initialMlbLeague={(allMlbLeagues[0]?.settings ?? null) as MlbLeague | null}
        tier={tier}
        allNhlLeagues={allNhlLeagues}
        allNflLeagues={allNflLeagues}
        allMlbLeagues={allMlbLeagues}
      />
    )
  }

  // ── Tier 1: single league per sport (existing behaviour) ─────
  const [nhlResult, nflResult, mlbResult] = await Promise.all([
    supabase
      .from('leagues')
      .select('settings')
      .eq('user_id', userId)
      .eq('sport', 'nhl')
      .maybeSingle(),
    supabase
      .from('leagues')
      .select('settings')
      .eq('user_id', userId)
      .eq('sport', 'nfl')
      .maybeSingle(),
    supabase
      .from('leagues')
      .select('settings')
      .eq('user_id', userId)
      .eq('sport', 'mlb')
      .maybeSingle(),
  ])

  const initialLeague    = (nhlResult.data?.settings ?? null) as League    | null
  const initialNflLeague = (nflResult.data?.settings ?? null) as NflLeague | null
  const initialMlbLeague = (mlbResult.data?.settings ?? null) as MlbLeague | null

  return (
    <NhlSettingsForm
      initialLeague={initialLeague}
      initialNflLeague={initialNflLeague}
      initialMlbLeague={initialMlbLeague}
      tier={tier}
      allNhlLeagues={[]}
      allNflLeagues={[]}
      allMlbLeagues={[]}
    />
  )
}
