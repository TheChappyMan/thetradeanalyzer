import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getUserTier, isEffectivelyTier2 } from '@/lib/auth'

// ── Auth helpers ───────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const { userId } = await auth()
  return userId
}

// ── GET /api/leagues ───────────────────────────────────────────────────────
// ?id=uuid     → { data: LeagueRow }           one specific league
// ?sport=nhl   → { data: LeagueRow[] }         all leagues for that sport
// (no params)  → { data: LeagueRow[] }         all leagues for the user
export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id    = searchParams.get('id')
  const sport = searchParams.get('sport')

  // Single league by id
  if (id) {
    const { data, error } = await supabase
      .from('leagues')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)   // prevent cross-user access
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found' },  { status: 404 })
    return NextResponse.json({ data })
  }

  // All leagues for a specific sport
  if (sport) {
    const { data, error } = await supabase
      .from('leagues')
      .select('*')
      .eq('user_id', userId)
      .eq('sport', sport)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  }

  // All leagues for the user
  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// ── POST /api/leagues ──────────────────────────────────────────────────────
// Creates a new league row.
// Tier gate (the UI hides "+ New League" from tier1, but the API must
// enforce it too — UI-only gating let tier1 accounts create extra leagues):
//   free          → 403 (saved leagues are a paid feature)
//   tier1         → one league per sport; 403 if one already exists
//   tier2 / tier3 → unlimited
// Body: { sport: string, name?: string, settings: object }
// Returns: { data: LeagueRow }  (201)
export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // getUserTier() includes the admin override and treats tier3 as ≥ tier2
  const tier = await getUserTier()
  if (tier === 'free') {
    return NextResponse.json(
      { error: 'Paid subscription required' },
      { status: 403 }
    )
  }

  let body: { sport?: string; name?: string; settings?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sport, name, settings } = body
  if (!sport || !settings) {
    return NextResponse.json(
      { error: 'sport and settings are required' },
      { status: 400 }
    )
  }

  // Tier 1: single saved league per sport
  if (!isEffectivelyTier2(tier)) {
    const { count, error: countError } = await supabase
      .from('leagues')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('sport', sport)

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 })
    }
    if ((count ?? 0) >= 1) {
      return NextResponse.json(
        { error: 'Tier 2 subscription required for multiple leagues' },
        { status: 403 }
      )
    }
  }

  const leagueName =
    typeof name === 'string' && name.trim() ? name.trim() : 'My League'

  const { data, error } = await supabase
    .from('leagues')
    .insert({ user_id: userId, sport, name: leagueName, settings })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}

// ── PUT /api/leagues ───────────────────────────────────────────────────────
// Updates an existing league by id.
// Body: { id: string, name?: string, settings?: object }
// Returns: { data: LeagueRow }
export async function PUT(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { id?: string; name?: string; settings?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id, name, settings } = body
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }
  if (name === undefined && settings === undefined) {
    return NextResponse.json(
      { error: 'At least one of name or settings must be provided' },
      { status: 400 }
    )
  }

  const patch: Record<string, unknown> = {}
  if (typeof name === 'string') patch.name = name.trim()
  if (settings !== undefined)   patch.settings = settings

  const { data, error } = await supabase
    .from('leagues')
    .update(patch)
    .eq('id', id)
    .eq('user_id', userId)   // prevent cross-user writes
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'Not found' },  { status: 404 })
  return NextResponse.json({ data })
}

// ── DELETE /api/leagues ────────────────────────────────────────────────────
// Tier 2 only. Deletes a league by id.
// Body: { id: string }
// Returns: { success: true }  (200)
export async function DELETE(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // getUserTier() includes the admin override and treats tier3 as ≥ tier2
  const tier = await getUserTier()
  if (!isEffectivelyTier2(tier)) {
    return NextResponse.json(
      { error: 'Tier 2 subscription required' },
      { status: 403 }
    )
  }

  let body: { id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id } = body
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('leagues')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)   // prevent cross-user deletes

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
