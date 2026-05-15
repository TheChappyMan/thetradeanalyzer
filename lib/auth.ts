import { auth, currentUser } from '@clerk/nextjs/server'

export type UserTier = 'free' | 'tier1' | 'tier2' | 'tier3'

// ── Admin helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true if the given Clerk userId is in the ADMIN_USER_IDS env var.
 * Pure sync function — safe to call anywhere, including server components.
 * Never exposed to client-side code.
 */
export function isAdminId(userId: string): boolean {
  const adminIds = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return adminIds.includes(userId)
}

/**
 * Async wrapper that resolves the current user's ID then checks isAdminId.
 * Use in API routes and server components.
 */
export async function isAdmin(): Promise<boolean> {
  const { userId } = await auth()
  if (!userId) return false
  return isAdminId(userId)
}

// ── Tier helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the user's effective tier from Clerk publicMetadata.
 *
 * Admin override: if the current user is in ADMIN_USER_IDS they always
 * receive 'tier2' access regardless of their stored metadata.
 *
 * Tier sources (highest wins):
 *   ADMIN_USER_IDS (env)       — always tier2
 *   publicMetadata.tier        — personal subscription set by webhook
 *                                'free' | 'tier1' | 'tier2' | 'tier3'
 *   (Commissioner metadata)    — tier3 commissioners have tier='tier3'
 *   (Manager grant)            — managers receive tier='tier2' via Clerk metadata
 *
 * getUserTier() makes no Supabase calls; it's a fast Clerk-only read.
 */
export async function getUserTier(): Promise<UserTier> {
  const { userId } = await auth()
  if (!userId) return 'free'

  // Admins always get tier2 access
  if (isAdminId(userId)) return 'tier2'

  const user = await currentUser()
  const tier = user?.publicMetadata?.tier as string | undefined

  if (tier === 'tier3') return 'tier3'
  if (tier === 'tier2') return 'tier2'
  if (tier === 'tier1') return 'tier1'
  return 'free'
}

/** Returns true if the tier grants full Tier-2-level feature access (tier2 or tier3). */
export function isEffectivelyTier2(tier: UserTier): boolean {
  return tier === 'tier2' || tier === 'tier3'
}
