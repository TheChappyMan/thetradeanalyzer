"use client";

import { useState } from "react";
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
 *   Sign In / Sign Up     → signed-out visitors (always fully visible)
 *
 * Mobile: nav links collapse into a hamburger drawer.
 *         Auth buttons stay pinned in the header bar.
 * Desktop: single-row layout, unchanged.
 */
export default function GlobalNav() {
  const { user, isLoaded } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);

  const tier      = (user?.publicMetadata?.tier as string | undefined) ?? "free";
  const isSignedIn = isLoaded && !!user;
  const hasPro    = tier === "tier1" || tier === "tier2" || tier === "tier3";
  const isTier3   = tier === "tier3";

  const navLinks = [
    { href: "/nhl",          label: "NHL"          },
    { href: "/nfl",          label: "NFL"          },
    { href: "/mlb",          label: "MLB"          },
    ...(hasPro ? [
      { href: "/settings",   label: "Settings"     },
      { href: "/history",    label: "History"      },
    ] : []),
    ...(isTier3 ? [
      { href: "/commissioner", label: "Commissioner" },
    ] : []),
  ];

  return (
    <>
      {/* ── Main bar ───────────────────────────────────────────── */}
      <nav className="nav-bar">

        {/* Logo */}
        <Link href="/" className="nav-wordmark" onClick={() => setMenuOpen(false)}>
          <img
            src="https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Header-Logo-White.png"
            alt="The Trade Analyzer"
          />
        </Link>

        {/* Desktop nav links — hidden on mobile */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map(({ href, label }) => (
            <Link key={href} href={href} className="nav-link">{label}</Link>
          ))}
        </div>

        {/* Push auth controls right */}
        <div className="flex-1" />

        {/* Auth controls — always visible on all screen sizes */}
        {isSignedIn ? (
          <UserButton appearance={{ elements: { avatarBox: "w-7 h-7" } }} />
        ) : (
          <div className="flex items-center gap-2">
            <SignInButton mode="modal">
              <button className="btn-secondary text-white border-white/40 hover:bg-white/10">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button
                className="rounded-lg px-3 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 whitespace-nowrap"
                style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
              >
                Sign Up Free
              </button>
            </SignUpButton>
          </div>
        )}

        {/* Hamburger button — mobile only */}
        <button
          className="md:hidden ml-3 flex flex-col justify-center items-center w-8 h-8 gap-1.5 shrink-0"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          <span
            className="block w-5 h-0.5 bg-white transition-transform duration-200 origin-center"
            style={{ transform: menuOpen ? "translateY(8px) rotate(45deg)" : "none" }}
          />
          <span
            className="block w-5 h-0.5 bg-white transition-opacity duration-200"
            style={{ opacity: menuOpen ? 0 : 1 }}
          />
          <span
            className="block w-5 h-0.5 bg-white transition-transform duration-200 origin-center"
            style={{ transform: menuOpen ? "translateY(-8px) rotate(-45deg)" : "none" }}
          />
        </button>

      </nav>

      {/* ── Mobile drawer ──────────────────────────────────────── */}
      {menuOpen && (
        <div
          className="md:hidden flex flex-col px-6 py-3"
          style={{ background: "var(--color-primary)" }}
        >
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="nav-link py-3"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
