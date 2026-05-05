/**
 * /commissioner/accept-invite/[token]
 *
 * Server component that handles group-invite acceptance.
 *
 * Flow:
 *  1. Look up the seat by invite_token.
 *  2. If not signed in → redirect to Clerk sign-in with this page as afterSignInUrl.
 *  3. If signed in but email doesn't match invited_email → show mismatch message.
 *  4. If already active → show "already accepted" message.
 *  5. Otherwise → activate the seat, upgrade Clerk tier, redirect to dashboard.
 */

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth, currentUser, clerkClient } from '@clerk/nextjs/server'
import { supabase } from '@/lib/supabase'
import { getSeatByToken, isGroupActive } from '@/lib/commissioner'

// ── Helpers ────────────────────────────────────────────────────────────────

function MessagePage({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full border rounded-2xl p-8 text-center">
        <h1 className="text-xl font-semibold mb-3">{title}</h1>
        <p className="text-gray-600 text-sm mb-6">{body}</p>
        <Link
          href="/"
          className="inline-block bg-blue-600 text-white rounded-lg px-5 py-2 text-sm hover:bg-blue-700 transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // ── Look up the seat ──────────────────────────────────────────
  const seatData = await getSeatByToken(token)

  if (!seatData) {
    return (
      <MessagePage
        title="Invalid invite link"
        body="This invite link is invalid or has expired. Please ask your commissioner to send a new one."
      />
    )
  }

  if (seatData.status === 'removed') {
    return (
      <MessagePage
        title="Invite cancelled"
        body="This invitation has been cancelled. Please contact your commissioner."
      />
    )
  }

  if (!isGroupActive(seatData.group)) {
    return (
      <MessagePage
        title="Subscription expired"
        body="The commissioner's subscription has expired. Please ask them to renew before accepting."
      />
    )
  }

  if (seatData.status === 'active') {
    return (
      <MessagePage
        title="Already accepted"
        body="This invite has already been accepted. Sign in to access your account."
      />
    )
  }

  // ── Auth check ────────────────────────────────────────────────
  const { userId } = await auth()

  if (!userId) {
    // Send the user to sign-in/sign-up; after auth they'll land back here.
    const returnUrl = encodeURIComponent(`/commissioner/accept-invite/${token}`)
    redirect(`/sign-in?redirect_url=${returnUrl}`)
  }

  // ── Email match check ──────────────────────────────────────────
  const user        = await currentUser()
  const userEmails  = (user?.emailAddresses ?? []).map((e) => e.emailAddress.toLowerCase())
  const targetEmail = seatData.invited_email.toLowerCase()

  if (!userEmails.includes(targetEmail)) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full border rounded-2xl p-8 text-center">
          <h1 className="text-xl font-semibold mb-3">Wrong account</h1>
          <p className="text-gray-600 text-sm mb-2">
            This invite was sent to <strong>{seatData.invited_email}</strong>.
          </p>
          <p className="text-gray-600 text-sm mb-6">
            Please sign out and sign in (or create an account) with that email address, then
            return to this link.
          </p>
          <a
            href={`/sign-in?redirect_url=${encodeURIComponent(`/commissioner/accept-invite/${token}`)}`}
            className="inline-block bg-blue-600 text-white rounded-lg px-5 py-2 text-sm hover:bg-blue-700 transition-colors"
          >
            Sign in with correct account
          </a>
        </div>
      </div>
    )
  }

  // ── Activate the seat ──────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from('commissioner_seats')
    .update({
      member_user_id: userId,
      joined_at:      new Date().toISOString(),
      status:         'active',
    })
    .eq('id', seatData.id)
    .eq('status', 'pending')   // guard against double-accept race

  if (updateErr) {
    return (
      <MessagePage
        title="Something went wrong"
        body={`Could not activate your seat: ${updateErr.message}. Please try again or contact support.`}
      />
    )
  }

  // ── Upgrade Clerk tier to tier2 ────────────────────────────────
  // Save existing tier as _personalTier so we can restore it on removal.
  try {
    const clerk        = await clerkClient()
    const currentTierRaw = (user?.publicMetadata?.tier as string | undefined) ?? 'free'
    const tierRank     = { free: 0, tier1: 1, tier2: 2, tier3: 3 }
    const currentRank  = tierRank[currentTierRaw as keyof typeof tierRank] ?? 0

    if (currentRank < 2) {
      // Upgrade to tier2; save original so we can restore on removal
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: {
          tier:          'tier2',
          _personalTier: currentTierRaw,
        },
      })
    }
    // If they already have tier2 or tier3, don't downgrade — save _personalTier anyway
    // so the remove handler knows what to restore.
    if (currentRank >= 2) {
      await clerk.users.updateUserMetadata(userId, {
        publicMetadata: { _personalTier: currentTierRaw },
      })
    }
  } catch (err) {
    // Tier upgrade is best-effort; the seat is already activated.
    console.error('[accept-invite] Failed to upgrade Clerk tier:', err)
  }

  // ── Success — redirect to dashboard ───────────────────────────
  redirect('/')
}
