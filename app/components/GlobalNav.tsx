"use client";

import Link from "next/link";
import { useUser, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";

/**
 * Global top navigation — always rendered for every visitor.
 *
 * Visibility rules:
 *   NHL / NFL / MLB       → everyone (signed-out, free, pro)
 *   Settings / History    → tier1, tier2, tier3
 *   Commissioner          → tier3 only
 *   UserButton            → signed-in users
 *   Sign In / Sign Up     → signed-out visitors
 */
export default function GlobalNav() {
  const { user, isLoaded } = useUser();

  const tier = (user?.publicMetadata?.tier as string | undefined) ?? "free";
  const isSignedIn = isLoaded && !!user;
  const hasPro   = tier === "tier1" || tier === "tier2" || tier === "tier3";
  const isTier3  = tier === "tier3";

  return (
    <nav className="nav-bar">
      {/* Logo */}
      <Link href="/" className="nav-wordmark">
        <img
          src="https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Header-Logo-White.png"
          alt="The Trade Analyzer"
        />
      </Link>

      {/* Sport links — always visible */}
      <Link href="/nhl" className="nav-link">NHL</Link>
      <Link href="/nfl" className="nav-link">NFL</Link>
      <Link href="/mlb" className="nav-link">MLB</Link>

      {/* Pro links — tier1 / tier2 / tier3 only */}
      {hasPro && (
        <>
          <Link href="/settings" className="nav-link">Settings</Link>
          <Link href="/history"  className="nav-link">History</Link>
        </>
      )}

      {/* Commissioner — tier3 only */}
      {isTier3 && (
        <Link href="/commissioner" className="nav-link">Commissioner</Link>
      )}

      {/* Push auth controls to the right */}
      <div className="flex-1" />

      {/* Auth controls */}
      {isSignedIn ? (
        <UserButton
          appearance={{ elements: { avatarBox: "w-7 h-7" } }}
        />
      ) : (
        <div className="flex items-center gap-3">
          <SignInButton mode="modal">
            <button className="btn-secondary text-white border-white/40 hover:bg-white/10">
              Sign In
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button
              className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
            >
              Sign Up Free
            </button>
          </SignUpButton>
        </div>
      )}
    </nav>
  );
}
