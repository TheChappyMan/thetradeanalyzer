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

  if (tier !== 'tier1' && tier !== 'tier2' && tier !== 'tier3') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1
          className="text-2xl font-semibold mb-3 tracking-tight"
          style={{ color: 'var(--color-text)' }}
        >
          Trade History
        </h1>
        <div
          className="card text-center"
          style={{ color: 'var(--color-muted)' }}
        >
          <p className="text-sm">Trade history requires a Pro subscription.</p>
        </div>
      </div>
    )
  }

  // ── Tier 2 / Tier 3: fully client-side (sport tabs + league filter + delete) ───
  if (tier === 'tier2' || tier === 'tier3') {
    return (
      <>
        <ProNav tier={tier} />
        <div className="p-6 max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ color: 'var(--color-text)' }}
            >
              Trade History
            </h1>
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
        <ProNav tier={tier} />
        <div className="p-6 max-w-6xl mx-auto">
          <h1
            className="text-2xl font-semibold mb-4 tracking-tight"
            style={{ color: 'var(--color-text)' }}
          >
            Trade History
          </h1>
          <div
            className="card text-center text-sm"
            style={{ color: 'var(--color-danger)' }}
          >
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
      <ProNav tier={tier} />
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1
            className="text-2xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text)' }}
          >
            Trade History
          </h1>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {entries.length} trade{entries.length !== 1 ? 's' : ''}
          </span>
        </div>
        <HistoryList entries={entries} />
      </div>
    </>
  )
}

// ── ProNav ───────────────────────────────────────────────────────────────────

function ProNav({ tier }: { tier: string }) {
  const links = [
    { href: '/settings', label: 'Settings' },
    { href: '/history',  label: 'History'  },
    { href: '/nhl',      label: 'NHL'      },
    { href: '/nfl',      label: 'NFL'      },
    { href: '/mlb',      label: 'MLB'      },
    ...(tier === 'tier3' ? [{ href: '/commissioner', label: 'Commissioner' }] : []),
  ]
  return (
    <nav className="nav-bar">
      <Link href="/" className="nav-wordmark">
        thetradeanalyzer
      </Link>
      {links.map(({ href, label }) => (
        <Link key={href} href={href} className="nav-link">
          {label}
        </Link>
      ))}
    </nav>
  )
}
