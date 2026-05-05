/**
 * /commissioner
 *
 * Commissioner dashboard — accessible only to tier3 commissioners.
 * Shows seat management and league-wide trade history.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { getCommissionerGroup, getGroupSeats } from '@/lib/commissioner'
import type { CommissionerSeat } from '@/lib/commissioner'
import { SeatPanel, CommissionerTradeHistory } from './CommissionerClient'

// ── ProNav ────────────────────────────────────────────────────────────────

function ProNav() {
  const links = [
    { href: '/settings',      label: 'Settings'     },
    { href: '/history',       label: 'History'      },
    { href: '/nhl',           label: 'NHL'          },
    { href: '/nfl',           label: 'NFL'          },
    { href: '/mlb',           label: 'MLB'          },
    { href: '/commissioner',  label: 'Commissioner' },
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

// ── Page ──────────────────────────────────────────────────────────────────

export default async function CommissionerPage() {
  // ── Auth check ────────────────────────────────────────────────
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await currentUser()
  const tier = (user?.publicMetadata?.tier as string | undefined) ?? 'free'

  if (tier !== 'tier3') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-3">Commissioner Dashboard</h1>
        <div className="border rounded-2xl p-6 text-center text-gray-600">
          <p className="text-sm">The Commissioner Dashboard requires a Tier 3 Group subscription.</p>
        </div>
      </div>
    )
  }

  // ── Load group ────────────────────────────────────────────────
  const group = await getCommissionerGroup(userId)

  if (!group) {
    return (
      <>
        <ProNav />
        <div className="p-6 max-w-2xl mx-auto">
          <h1 className="text-2xl font-semibold mb-3">Commissioner Dashboard</h1>
          <div className="border rounded-2xl p-6 text-center text-gray-600">
            <p className="text-sm">
              No active commissioner group found. Please contact support if you believe this is an error.
            </p>
          </div>
        </div>
      </>
    )
  }

  // ── Load seats ────────────────────────────────────────────────
  const allSeats = await getGroupSeats(group.id)

  // Strip invite_token before sending to client
  const safeSeats: Omit<CommissionerSeat, 'invite_token'>[] = allSeats.map(
    ({ invite_token: _tok, ...rest }) => rest
  )

  const filledCount = allSeats.filter((s) => s.status === 'active').length

  const expiryLabel = new Date(group.expires_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <>
      <ProNav />
      <div className="p-6 max-w-6xl mx-auto">

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Commissioner Dashboard</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Group subscription · renews {expiryLabel}
            </p>
          </div>
          <a href="/" className="text-xs text-blue-600 hover:underline">
            ← Dashboard
          </a>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Seat management */}
          <SeatPanel
            initialSeats={safeSeats as Parameters<typeof SeatPanel>[0]['initialSeats']}
            groupId={group.id}
            groupExpiresAt={group.expires_at}
            filledCount={filledCount}
          />

          {/* Trade history (client-side, fetches on mount) */}
          <CommissionerTradeHistory />

        </div>
      </div>
    </>
  )
}
