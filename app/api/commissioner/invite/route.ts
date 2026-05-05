/**
 * POST /api/commissioner/invite
 *
 * Commissioner adds a manager by email.
 * Creates a commissioner_seats row (status='pending') and sends the invite email.
 *
 * Body: { email: string }
 * Auth: must be an active commissioner (tier3)
 * Returns: { data: CommissionerSeat }  201
 */

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getCommissionerGroup, getGroupSeats, sendInviteEmail } from '@/lib/commissioner'

const MAX_SEATS = 11  // commissioner + 11 managers = 12 total

export async function POST(request: Request) {
  // ── Auth ────────────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const tier = user?.publicMetadata?.tier as string | undefined
  if (tier !== 'tier3') {
    return NextResponse.json({ error: 'Commissioner subscription required' }, { status: 403 })
  }

  // ── Parse body ──────────────────────────────────────────────
  let body: { email?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const email = (body.email ?? '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
  }

  // ── Verify commissioner group ────────────────────────────────
  const group = await getCommissionerGroup(userId)
  if (!group) {
    return NextResponse.json(
      { error: 'No active commissioner group found — please contact support' },
      { status: 403 }
    )
  }

  // ── Seat-count gate ─────────────────────────────────────────
  const existingSeats = await getGroupSeats(group.id)
  if (existingSeats.length >= MAX_SEATS) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_SEATS} manager seats reached` },
      { status: 400 }
    )
  }

  // ── Prevent duplicate invites ────────────────────────────────
  const duplicate = existingSeats.find(
    (s) => s.invited_email === email && s.status !== 'removed'
  )
  if (duplicate) {
    return NextResponse.json(
      { error: 'This email already has a pending or active seat' },
      { status: 409 }
    )
  }

  // ── Create seat row ─────────────────────────────────────────
  const { data: seat, error: insertErr } = await supabase
    .from('commissioner_seats')
    .insert({ group_id: group.id, invited_email: email })
    .select()
    .single()

  if (insertErr || !seat) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'Failed to create seat' },
      { status: 500 }
    )
  }

  // ── Send invite email ───────────────────────────────────────
  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://thetradeanalyzer.com'
  const inviteUrl = `${appUrl}/commissioner/accept-invite/${seat.invite_token}`
  const fromName  = user?.fullName ?? user?.firstName ?? undefined

  await sendInviteEmail({ to: email, inviteUrl, fromName })

  return NextResponse.json({ data: seat }, { status: 201 })
}
