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
// EMAIL
// ============================================================

/**
 * Sends a commissioner group invite email.
 * Uses the Resend API if RESEND_API_KEY is set; logs to console otherwise.
 *
 * To wire up: install `resend` package and set RESEND_API_KEY env var.
 * The FROM address must be a verified sender in your Resend account.
 */
export async function sendInviteEmail(args: {
  to:         string
  inviteUrl:  string
  fromName?:  string
}): Promise<void> {
  const apiKey  = process.env.RESEND_API_KEY
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://thetradeanalyzer.com'
  const from    = process.env.RESEND_FROM_EMAIL    ?? 'noreply@thetradeanalyzer.com'

  const html = `
    <h2>You've been invited to join a Trade Analyzer league group</h2>
    <p>${args.fromName ? `<strong>${args.fromName}</strong> has invited you` : 'You have been invited'} to join a Fantasy Trade Analyzer commissioner group.</p>
    <p>Click the link below to accept your invitation and activate full Pro access:</p>
    <p><a href="${args.inviteUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Accept Invitation</a></p>
    <p style="color:#6b7280;font-size:12px;">If you did not expect this email, you can ignore it. The link expires after use.</p>
    <p style="color:#6b7280;font-size:12px;">${appUrl}</p>
  `

  if (!apiKey) {
    console.log(`[commissioner] Invite email (no RESEND_API_KEY set):\nTo: ${args.to}\nURL: ${args.inviteUrl}`)
    return
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to:      [args.to],
        subject: 'You\'ve been invited to a Trade Analyzer commissioner group',
        html,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('[commissioner] Resend error:', body)
    }
  } catch (err) {
    console.error('[commissioner] Failed to send invite email:', err)
  }
}
