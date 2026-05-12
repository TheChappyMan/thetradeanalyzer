/**
 * Server-side helpers for commissioner groups and seat management.
 * All functions require the Supabase service-role client and should only
 * be called from API routes or server components — never from the browser.
 */

import { supabase } from './supabase'

// ============================================================
// TYPES
// ============================================================

export type CommissionerGroup = {
  id:                   string
  commissioner_user_id: string
  created_at:           string
  expires_at:           string
  grace_until:          string | null
}

export type CommissionerSeat = {
  id:              string
  group_id:        string
  invited_email:   string
  member_user_id:  string | null
  status:          'pending' | 'active' | 'removed'
  invited_at:      string
  joined_at:       string | null
  invite_token:    string
}

// ============================================================
// HELPERS
// ============================================================

/** Is the group currently within its active window or grace period? */
export function isGroupActive(group: CommissionerGroup): boolean {
  const now     = Date.now()
  const expires = new Date(group.expires_at).getTime()
  const grace   = group.grace_until ? new Date(group.grace_until).getTime() : null
  return now < expires || (grace !== null && now < grace)
}

// ============================================================
// QUERIES
// ============================================================

/**
 * Returns the most-recent active commissioner group for a user,
 * or null if the user is not an active commissioner.
 */
export async function getCommissionerGroup(
  userId: string
): Promise<CommissionerGroup | null> {
  const { data, error } = await supabase
    .from('commissioner_groups')
    .select('*')
    .eq('commissioner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  const group = data as CommissionerGroup
  return isGroupActive(group) ? group : null
}

/**
 * Returns all seats for a group.
 * By default excludes removed seats; pass includeRemoved=true to include them.
 */
export async function getGroupSeats(
  groupId: string,
  includeRemoved = false
): Promise<CommissionerSeat[]> {
  let query = supabase
    .from('commissioner_seats')
    .select('*')
    .eq('group_id', groupId)
    .order('invited_at', { ascending: true })

  if (!includeRemoved) {
    query = query.neq('status', 'removed')
  }

  const { data } = await query
  return (data ?? []) as CommissionerSeat[]
}

/**
 * Returns the seat for a given invite token, or null if not found / already used.
 */
export async function getSeatByToken(
  token: string
): Promise<(CommissionerSeat & { group: CommissionerGroup }) | null> {
  const { data } = await supabase
    .from('commissioner_seats')
    .select('*, group:commissioner_groups(*)')
    .eq('invite_token', token)
    .maybeSingle()

  if (!data) return null
  return data as CommissionerSeat & { group: CommissionerGroup }
}

/**
 * Returns user IDs of all active members in the same group as the commissioner.
 * Includes the commissioner's own userId.
 */
export async function getGroupMemberUserIds(
  group: CommissionerGroup
): Promise<string[]> {
  const { data: seats } = await supabase
    .from('commissioner_seats')
    .select('member_user_id')
    .eq('group_id', group.id)
    .eq('status', 'active')

  const memberIds = (seats ?? [])
    .map((s: { member_user_id: string | null }) => s.member_user_id)
    .filter((id): id is string => id !== null)

  return [group.commissioner_user_id, ...memberIds]
}

// ============================================================
// EMAIL  (implemented in lib/email.ts)
// ============================================================

export { sendInviteEmail, sendReinviteEmail } from './email'
