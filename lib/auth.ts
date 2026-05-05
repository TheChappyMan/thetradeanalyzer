import { auth, currentUser } from '@clerk/nextjs/server'

export type UserTier = 'free' | 'tier1' | 'tier2' | 'tier3'

/**
 * Returns the user's effective tier from Clerk publicMetadata.
 *
 * Tier sources (highest wins):
 *   publicMetadata.tier       — personal subscription set by Stripe webhook
 *                                'free' | 'tier1' | 'tier2' | 'tier3'
 *   (Commissioner metadata)   — tier3 commissioners have tier='tier3'
 *   (Manager grant)           — when a manager joins a commissioner group their
 *                                tier is upgraded to 'tier2' in Clerk metadata
 *                                and restored on removal; no separate field needed.
 *
 * Grace-period enforcement for expired commissioner groups is handled by the
 * Stripe subscription webhook — it reverts member metadata after grace_until.
 * getUserTier() itself makes no Supabase calls; it's a fast Clerk-only read.
 */
export async function getUserTier(): Promise<UserTier> {
  const { userId } = await auth()
  if (!userId) return 'free'

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
