/**
 * POST /api/commissioner/seats/[id]/resend
 *
 * Resends the invite email for a pending seat.
 *
 * Auth: must be the commissioner of the group that owns the seat
 * Returns: { success: true }  200
 */

import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getCommissionerGroup } from '@/lib/commissioner'
import { sendReinviteEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rate-limit'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // ── Auth ────────────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const tier = user?.publicMetadata?.tier as string | undefined
  if (tier !== 'tier3') {
    return NextResponse.json({ error: 'Commissioner subscription required' }, { status: 403 })
  }

  const { id: seatId } = await params

  // ── Rate limits ─────────────────────────────────────────────
  // 1 resend per seat per 5 minutes, and 10 resends per user per hour.
  // In-memory (per server instance) — enough to stop inbox flooding.
  if (
    !rateLimit(`resend:seat:${seatId}`, 1, 5 * 60 * 1000) ||
    !rateLimit(`resend:user:${userId}`, 10, 60 * 60 * 1000)
  ) {
    return NextResponse.json(
      { error: 'Too many resend requests — please wait a few minutes' },
      { status: 429 }
    )
  }

  // ── Verify seat ownership ───────────────────────────────────
  const group = await getCommissionerGroup(userId)
  if (!group) {
    return NextResponse.json({ error: 'No active commissioner group found' }, { status: 403 })
  }

  const { data: seat } = await supabase
    .from('commissioner_seats')
    .select('*')
    .eq('id', seatId)
    .eq('group_id', group.id)
    .maybeSingle()

  if (!seat) {
    return NextResponse.json({ error: 'Seat not found' }, { status: 404 })
  }
  if (seat.status !== 'pending') {
    return NextResponse.json(
      { error: 'Can only resend invites for pending seats' },
      { status: 409 }
    )
  }

  // ── Resend email ────────────────────────────────────────────
  const commissionerEmail = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? ''

  await sendReinviteEmail(seat.invited_email, seat.invite_token, commissionerEmail)

  return NextResponse.json({ success: true })
}
