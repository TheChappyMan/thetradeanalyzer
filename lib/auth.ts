import { auth, currentUser } from '@clerk/nextjs/server'

export type UserTier = 'free' | 'tier1' | 'tier2'

export async function getUserTier(): Promise<UserTier> {
  const { userId } = await auth()
  if (!userId) return 'free'

  const user = await currentUser()
  const tier = user?.publicMetadata?.tier

  if (tier === 'tier1' || tier === 'tier2') return tier
  return 'free'
}
