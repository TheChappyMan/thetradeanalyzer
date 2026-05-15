import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { getUserTier } from '@/lib/auth'
import { ensureReferralCode } from '@/lib/referral'
import type { League, LeagueRow } from '@/lib/types'
import type { NflLeague } from '@/lib/nfl-types'
import type { MlbLeague } from '@/lib/mlb-types'
import NhlSettingsForm from './NhlSettingsForm'
import ReferralSection from './ReferralSection'

export default async function SettingsPage() {
  // ── Auth check ──────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // ── Tier gate — uses getUserTier() so admin override is respected ────────
  // (raw publicMetadata read would give 'free' for admin users with no
  //  stored tier, bypassing the ADMIN_USER_IDS override in getUserTier)
  const tier = await getUserTier()

  if (tier === 'free') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Settings</h1>
        <div className="card text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="text-sm">This feature requires a Pro subscription.</p>
        </div>
      </div>
    )
  }

  // ── Referral code — fetch or generate on demand ──────────────────────────
  // ensureReferralCode is a no-op if a code already exists. This backfills
  // existing paid users who were assigned a tier before the referral system
  // was built and therefore have no row in referral_codes yet.
  const user = await currentUser()
  const displayName =
    user?.firstName ?? user?.username ?? userId

  const { data: existingCode } = await supabase
    .from('referral_codes')
    .select('code, etransfer_email')
    .eq('user_id', userId)
    .maybeSingle()

  let referralCode  = existingCode?.code            ?? null
  let etransferEmail = existingCode?.etransfer_email ?? null

  if (!referralCode) {
    // No code yet — generate one now (idempotent, handles race conditions)
    const generated = await ensureReferralCode(userId, displayName)
    if (generated) {
      referralCode  = generated
      etransferEmail = null
    }
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
      <>
        <NhlSettingsForm
          initialLeague={(allNhlLeagues[0]?.settings ?? null) as League | null}
          initialNflLeague={(allNflLeagues[0]?.settings ?? null) as NflLeague | null}
          initialMlbLeague={(allMlbLeagues[0]?.settings ?? null) as MlbLeague | null}
          tier={tier}
          allNhlLeagues={allNhlLeagues}
          allNflLeagues={allNflLeagues}
          allMlbLeagues={allMlbLeagues}
        />
        {referralCode && (
          <ReferralSection
            code={referralCode}
            etransferEmail={etransferEmail}
            userId={userId}
          />
        )}
      </>
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
    <>
      <NhlSettingsForm
        initialLeague={initialLeague}
        initialNflLeague={initialNflLeague}
        initialMlbLeague={initialMlbLeague}
        tier={tier}
        allNhlLeagues={[]}
        allNflLeagues={[]}
        allMlbLeagues={[]}
      />
      {referralCode && (
        <ReferralSection
          code={referralCode}
          etransferEmail={etransferEmail}
          userId={userId}
        />
      )}
    </>
  )
}
