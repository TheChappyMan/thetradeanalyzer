import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

// ── GET /api/leagues?sport=nhl ──────────────────────────────────────────────
// Returns the matching league row for the current user.
// With ?sport=<value>  → { data: LeagueRow | null }
// Without ?sport       → { data: LeagueRow[] }
export async function GET(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const sport = searchParams.get('sport')

  if (sport) {
    const { data, error } = await supabase
      .from('leagues')
      .select('*')
      .eq('user_id', userId)
      .eq('sport', sport)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  }

  const { data, error } = await supabase
    .from('leagues')
    .select('*')
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// ── POST /api/leagues ───────────────────────────────────────────────────────
// Body: { sport: string, name?: string, settings: object }
// Upserts by (user_id, sport) — inserts on first call, updates thereafter.
export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { sport?: string; name?: string; settings?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sport, name, settings } = body
  if (!sport || !settings) {
    return NextResponse.json({ error: 'sport and settings are required' }, { status: 400 })
  }

  const leagueName = (typeof name === 'string' && name.trim()) ? name.trim() : 'My League'

  // Check for existing row so we can update rather than insert
  const { data: existing } = await supabase
    .from('leagues')
    .select('id')
    .eq('user_id', userId)
    .eq('sport', sport)
    .maybeSingle()

  if (existing) {
    const { data, error } = await supabase
      .from('leagues')
      .update({ name: leagueName, settings })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  }

  const { data, error } = await supabase
    .from('leagues')
    .insert({ user_id: userId, sport, name: leagueName, settings })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}
