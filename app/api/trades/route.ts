import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'

// ── Auth helpers ───────────────────────────────────────────────────────────

async function getUserId(): Promise<string | null> {
  const { userId } = await auth()
  return userId
}

async function getTier(): Promise<string | undefined> {
  const user = await currentUser()
  return user?.publicMetadata?.tier as string | undefined
}

// ── GET /api/trades ────────────────────────────────────────────────────────
// Returns trades for the current user, newest first.
// ?leagueId=uuid  → trades for a specific league
// ?sport=nhl      → all trades for that sport (across leagues)
// (no params)     → all trades for the user
// Response: { data: TradeRow[] }
export async function GET(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const leagueId = searchParams.get('leagueId')
  const sport    = searchParams.get('sport')

  let query = supabase
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (leagueId) query = query.eq('league_id', leagueId)
  else if (sport) query = query.eq('sport', sport)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}

// ── POST /api/trades ───────────────────────────────────────────────────────
// Body: HistoryEntry (the full trade snapshot from the analyzer)
// Inserts a new row in the trades table.
// Response: { data: TradeRow }  (201)
export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('trades')
    .insert({ user_id: userId, trade_data: body })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data }, { status: 201 })
}

// ── DELETE /api/trades ─────────────────────────────────────────────────────
// Tier 2 only. Deletes a single trade by id.
// Body: { id: string }
// Response: { success: true }  (200)
export async function DELETE(request: Request) {
  const userId = await getUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tier = await getTier()
  if (tier !== 'tier2') {
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
    .from('trades')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)   // prevent cross-user deletes

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
