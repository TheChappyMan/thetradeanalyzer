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
  'pro-annual':       4,
  'proplus-annual':   9,
  'commissioner':     40,
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
  console.log(`[referral] ensureReferralCode start — userId=${userId} displayName="${displayName}"`)

  // 1. Check if a code already exists
  const { data: existing, error: selectErr } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle()

  if (selectErr) {
    // Surface the real DB error (e.g. "relation does not exist" if migration not applied)
    console.error(`[referral] select failed — code=${selectErr.code} msg="${selectErr.message}"`)
    // Don't abort: fall through and attempt insert (handles edge cases)
  }

  if (existing?.code) {
    console.log(`[referral] existing code found: ${existing.code}`)
    return existing.code
  }

  console.log('[referral] no existing code — generating new one')

  // 2. Try to insert a new code (retry on collision up to 5 times)
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = buildCode(displayName)
    console.log(`[referral] attempt ${attempt + 1}/5 — trying code="${code}"`)

    const { data, error } = await supabase
      .from('referral_codes')
      .insert({ user_id: userId, code })
      .select('code')
      .single()

    if (!error && data?.code) {
      console.log(`[referral] insert succeeded — code=${data.code}`)
      return data.code
    }

    if (error) {
      console.error(`[referral] insert attempt ${attempt + 1} failed — code=${error.code} msg="${error.message}"`)
    }

    // Postgres unique-violation code is 23505.
    // Also catch the human-readable string for older driver versions.
    const isUniqueViolation =
      error?.code === '23505' ||
      (error?.message ?? '').toLowerCase().includes('unique')

    if (!isUniqueViolation) {
      // Non-retryable error (e.g. table missing, RLS, network)
      console.error('[referral] non-retryable error — aborting')
      return null
    }

    // Unique collision — try a different prefix
  }

  console.error('[referral] exhausted 5 attempts — giving up')
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
