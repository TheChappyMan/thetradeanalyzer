import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import HistoryList from './HistoryList'
import HistoryClientPage from './HistoryClientPage'
import type { HistoryEntry } from './HistoryList'

// ── Server component ─────────────────────────────────────────────────────────

export default async function HistoryPage() {
  // ── Auth check ───────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // ── Tier gate ────────────────────────────────────────────────
  const user = await currentUser()
  const tier = (user?.publicMetadata?.tier as string | undefined) ?? 'free'

  if (tier !== 'tier1' && tier !== 'tier2') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-3">Trade History</h1>
        <div className="border rounded-2xl p-6 text-center text-gray-600">
          <p className="text-sm">Trade history requires a Pro subscription.</p>
        </div>
      </div>
    )
  }

  // ── Tier 2: fully client-side (sport tabs + league filter + delete) ───
  if (tier === 'tier2') {
    return (
      <>
        <ProNav />
        <div className="p-6 max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-semibold">Trade History</h1>
          </div>
          <HistoryClientPage />
        </div>
      </>
    )
  }

  // ── Tier 1: server-side fetch, read-only list ─────────────────────────
  const { data: rows, error } = await supabase
    .from('trades')
    .select('id, trade_data, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <>
        <ProNav />
        <div className="p-6 max-w-6xl mx-auto">
          <h1 className="text-2xl font-semibold mb-4">Trade History</h1>
          <div className="border rounded-2xl p-6 text-center text-red-600 text-sm">
            Failed to load trade history: {error.message}
          </div>
        </div>
      </>
    )
  }

  const entries: HistoryEntry[] = (rows ?? []).map((row) => {
    const td = row.trade_data as Partial<HistoryEntry> | null
    return {
      id:              td?.id              ?? row.created_at,
      dbId:            row.id,
      savedAt:         row.created_at,
      leagueName:      td?.leagueName      ?? '',
      sendPlayerNames: td?.sendPlayerNames ?? [],
      recvPlayerNames: td?.recvPlayerNames ?? [],
      sendPicks:       td?.sendPicks       ?? '',
      recvPicks:       td?.recvPicks       ?? '',
      sendValue:       td?.sendValue       ?? 0,
      recvValue:       td?.recvValue       ?? 0,
      score:           td?.score           ?? 50,
      verdict:         td?.verdict         ?? '',
    }
  })

  return (
    <>
      <ProNav />
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Trade History</h1>
          <span className="text-xs text-gray-500">
            {entries.length} trade{entries.length !== 1 ? 's' : ''}
          </span>
        </div>
        <HistoryList entries={entries} />
      </div>
    </>
  )
}

// ── ProNav ───────────────────────────────────────────────────────────────────

function ProNav() {
  const links = [
    { href: '/settings', label: 'Settings' },
    { href: '/history',  label: 'History'  },
    { href: '/nhl',      label: 'NHL'      },
    { href: '/nfl',      label: 'NFL'      },
  ]
  return (
    <nav className="bg-gray-900 text-white px-6 py-2.5 flex items-center gap-6 text-sm">
      <span className="font-semibold text-gray-400 text-xs tracking-widest uppercase mr-2">
        Trade Analyzer
      </span>
      {links.map(({ href, label }) => (
        <Link key={href} href={href} className="text-gray-200 hover:text-white transition-colors">
          {label}
        </Link>
      ))}
    </nav>
  )
}
