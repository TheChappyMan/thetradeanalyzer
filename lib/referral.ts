/**
 * lib/referral.ts
 *
 * Helpers for generating and assigning referral codes.
 *
 * Code format: XXXX-NAME
 *   XXXX = 4 random uppercase alphanumeric characters
 *   NAME = first word of the user's display name, uppercase,
 *          alphanumeric only, max 8 characters
 *
 * Example: K9M2-JUSTIN
 */

import { supabase } from './supabase'

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

// ── Payout amounts ─────────────────────────────────────────────────────────

export const REFERRAL_PAYOUT: Record<string, number> = {
  'pro-annual':       10,
  'proplus-annual':   16,
  'commissioner':     50,
}

// ── Code generation ────────────────────────────────────────────────────────

function randomPrefix(): string {
  let s = ''
  for (let i = 0; i < 4; i++) {
    s += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return s
}

function nameSuffix(displayName: string): string {
  return (displayName || 'USER')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8) || 'USER'
}

function buildCode(displayName: string): string {
  return `${randomPrefix()}-${nameSuffix(displayName)}`
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Ensures a referral code exists for the given userId.
 * Creates one if it doesn't already exist.
 * Returns the code string, or null if an unexpected DB error occurs.
 *
 * @param userId      Clerk user ID
 * @param displayName Used for the NAME part of the code (e.g. "Justin Chapman")
 */
export async function ensureReferralCode(
  userId:      string,
  displayName: string,
): Promise<string | null> {
  // 1. Check if a code already exists
  const { data: existing } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing?.code) return existing.code

  // 2. Try to insert a new code (retry on collision up to 5 times)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = buildCode(displayName)
    const { data, error } = await supabase
      .from('referral_codes')
      .insert({ user_id: userId, code })
      .select('code')
      .single()

    if (!error && data?.code) return data.code

    // Only retry on unique-constraint violations
    if (error && !error.message.includes('unique')) {
      console.error('[referral] Failed to insert referral code:', error.message)
      return null
    }
  }

  console.error('[referral] Failed to generate unique referral code after 5 attempts')
  return null
}

/**
 * Looks up the referrer for a given referral code string.
 * Returns { id, user_id, etransfer_email } or null if not found.
 */
export async function getReferralByCode(code: string) {
  const { data } = await supabase
    .from('referral_codes')
    .select('id, user_id, etransfer_email')
    .eq('code', code.toUpperCase().trim())
    .maybeSingle()

  return data ?? null
}

/**
 * Records a completed referral payout row.
 * Only called for annual plans that qualify for a payout.
 */
export async function recordReferralPayout(opts: {
  referralCodeId:  string
  referrerUserId:  string
  referredEmail:   string
  referredUserId?: string
  plan:            string
  payoutAmount:    number
}) {
  const { error } = await supabase
    .from('referral_payouts')
    .insert({
      referral_code_id:  opts.referralCodeId,
      referrer_user_id:  opts.referrerUserId,
      referred_email:    opts.referredEmail,
      referred_user_id:  opts.referredUserId ?? null,
      plan:              opts.plan,
      payout_amount:     opts.payoutAmount,
      status:            'pending',
    })

  if (error) {
    console.error('[referral] Failed to insert referral_payouts row:', error.message)
  }
}
