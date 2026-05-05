/**
 * GET /api/commissioner/trades
 *
 * Returns all trades saved by active members of the commissioner's group
 * (commissioner + all managers with status='active').
 *
 * Query params (all optional):
 *   memberId  — filter to one specific user_id
 *   sport     — 'nhl' | 'nfl' | 'mlb'
 *   dateFrom  — ISO date string (inclusive lower bound on created_at)
 *   dateTo    — ISO date string (inclusive upper bound on created_at)
 *
 * Auth: must be an active commissioner (tier3)
 *
 * Response: {
 *   data: Array<TradeRow & { memberEmail: string }>,
 *   members: Array<{ userId: string; email: string }>
 * }
 */

import { NextResponse } from 'next/server'
import { auth, currentUser, clerkClient } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getCommissionerGroup, getGroupSeats, getGroupMemberUserIds } from '@/lib/commissioner'

export async function GET(request: Request) {
  // ── Auth ────────────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const tier = user?.publicMetadata?.tier as string | undefined
  if (tier !== 'tier3') {
    return NextResponse.json({ error: 'Commissioner subscription required' }, { status: 403 })
  }

  // ── Load group ──────────────────────────────────────────────
  const group = await getCommissionerGroup(userId)
  if (!group) {
    return NextResponse.json({ error: 'No active commissioner group found' }, { status: 403 })
  }

  // ── Build member map ─────────────────────────────────────────
  // seat email is known; for the commissioner resolve via Clerk
  const seats       = await getGroupSeats(group.id)
  const memberIds   = await getGroupMemberUserIds(group)

  // email lookup for seats (invited_email maps to member_user_id)
  const emailByUserId: Record<string, string> = {}
  for (const seat of seats) {
    if (seat.member_user_id) emailByUserId[seat.member_user_id] = seat.invited_email
  }

  // Resolve commissioner's own email from Clerk
  try {
    const clerk      = await clerkClient()
    const commUser   = await clerk.users.getUser(userId)
    const commEmail  = commUser.emailAddresses[0]?.emailAddress ?? userId
    emailByUserId[userId] = commEmail
  } catch {
    emailByUserId[userId] = userId
  }

  // Build members list for the client-side dropdown filter
  const members = memberIds.map((uid) => ({
    userId: uid,
    email:  emailByUserId[uid] ?? uid,
  }))

  // ── Parse query params ──────────────────────────────────────
  const { searchParams } = new URL(request.url)
  const filterMember   = searchParams.get('memberId')
  const filterSport    = searchParams.get('sport')
  const filterDateFrom = searchParams.get('dateFrom')
  const filterDateTo   = searchParams.get('dateTo')

  // Target user IDs after optional member filter
  const targetIds = filterMember ? [filterMember] : memberIds

  if (targetIds.length === 0) {
    return NextResponse.json({ data: [], members })
  }

  // ── Query trades ─────────────────────────────────────────────
  let query = supabase
    .from('trades')
    .select('*')
    .in('user_id', targetIds)
    .order('created_at', { ascending: false })

  if (filterDateFrom) query = query.gte('created_at', filterDateFrom)
  if (filterDateTo)   query = query.lte('created_at', filterDateTo + 'T23:59:59Z')

  const { data: tradeRows, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // ── Filter by sport (stored in trade_data.sport) ─────────────
  let filtered = tradeRows ?? []
  if (filterSport) {
    filtered = filtered.filter((row) => {
      const td = row.trade_data as { sport?: string } | null
      return td?.sport === filterSport
    })
  }

  // Annotate each row with the member's email for display
  const data = filtered.map((row) => ({
    ...row,
    memberEmail: emailByUserId[row.user_id] ?? row.user_id,
  }))

  return NextResponse.json({ data, members })
}
