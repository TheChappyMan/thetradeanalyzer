/**
 * DELETE /api/commissioner/seats/[id]
 *
 * Commissioner removes a manager seat.
 * Sets seat status to 'removed' and reverts the manager's Clerk metadata tier.
 *
 * Auth: must be the commissioner of the group that owns the seat
 * Returns: { success: true }  200
 */

import { NextResponse } from 'next/server'
import { auth, currentUser, clerkClient } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getCommissionerGroup } from '@/lib/commissioner'

export async function DELETE(
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

  // ── Verify the seat belongs to this commissioner's group ────
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
  if (seat.status === 'removed') {
    return NextResponse.json({ error: 'Seat is already removed' }, { status: 409 })
  }

  // ── Mark seat as removed ────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('commissioner_seats')
    .update({ status: 'removed' })
    .eq('id', seatId)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  // ── Revert manager's Clerk tier ─────────────────────────────
  // Restore their original personal tier that was saved as _personalTier,
  // or 'free' if they had no prior subscription.
  if (seat.member_user_id) {
    try {
      const clerk     = await clerkClient()
      const memberUser = await clerk.users.getUser(seat.member_user_id)
      const meta      = memberUser.publicMetadata as Record<string, unknown>
      const personal  = (meta._personalTier as string | undefined) ?? 'free'

      await clerk.users.updateUserMetadata(seat.member_user_id, {
        publicMetadata: {
          tier:          personal,
          _personalTier: null,   // clear the saved field
        },
      })
    } catch (err) {
      // Log but don't fail the request — the seat is already removed in Supabase
      console.error('[commissioner] Failed to revert member tier in Clerk:', err)
    }
  }

  return NextResponse.json({ success: true })
}
