import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { League } from '@/lib/types'
import NhlSettingsForm from './NhlSettingsForm'

export default async function SettingsPage() {
  // ── Auth check ──────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // ── Tier gate ────────────────────────────────────────────────
  const user = await currentUser()
  const tier = user?.publicMetadata?.tier as string | undefined

  if (tier !== 'tier1' && tier !== 'tier2') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-3">Settings</h1>
        <div className="border rounded-2xl p-6 text-center text-gray-600">
          <p className="text-sm">This feature requires a Pro subscription.</p>
        </div>
      </div>
    )
  }

  // ── Fetch existing NHL league ────────────────────────────────
  const { data } = await supabase
    .from('leagues')
    .select('settings')
    .eq('user_id', userId)
    .eq('sport', 'nhl')
    .maybeSingle()

  const initialLeague = (data?.settings ?? null) as League | null

  return <NhlSettingsForm initialLeague={initialLeague} />
}
