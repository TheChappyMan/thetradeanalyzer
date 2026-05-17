"use client";

/**
 * /payment-success
 *
 * Stripe redirects here after a successful Payment Link checkout.
 *
 * Configure your Stripe Payment Links' "After payment" success URL to:
 *   https://app.thetradeanalyzer.com/payment-success?session_id={CHECKOUT_SESSION_ID}
 * ({CHECKOUT_SESSION_ID} is filled automatically by Stripe.)
 *
 * The session_id query param is accepted but not required — the page renders
 * correctly whether or not it is present.
 *
 * ── Signed-out visitor (most common path) ────────────────────────────────
 * Payment succeeded but no Clerk account exists yet.  Prompt the user to
 * create an account with the same email they used at checkout.  The Clerk
 * user.created webhook will detect the pending tier assignment and apply
 * it automatically.
 *
 * ── Already signed-in visitor ────────────────────────────────────────────
 * The Stripe webhook found their account and assigned the tier directly.
 * Show the confirmation message and auto-redirect to the dashboard.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";

const DASHBOARD_URL  = "https://app.thetradeanalyzer.com";
const REDIRECT_SECS  = 3;
const LOGO_URL       = "https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Header-Logo-White.png";

// ── Shared layout shell ────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-8 text-center"
      style={{ background: "var(--color-surface)" }}
    >
      {/* Logo */}
      <a href={DASHBOARD_URL} className="mb-10 block">
        <img src={LOGO_URL} alt="The Trade Analyzer" className="h-10 mx-auto" />
      </a>

      {children}
    </div>
  );
}

// ── Check icon ─────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <div
      className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
      style={{ background: "var(--color-accent)" }}
    >
      <svg
        className="w-8 h-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-accent-text)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  );
}

// ── Signed-out state: prompt account creation ──────────────────────────────

function CreateAccountPrompt() {
  return (
    <Shell>
      <CheckIcon />

      <h1
        className="text-2xl font-semibold mb-3 tracking-tight"
        style={{ color: "var(--color-text)" }}
      >
        Payment successful.
      </h1>

      <p
        className="text-base mb-2 max-w-sm"
        style={{ color: "var(--color-muted)" }}
      >
        Create your account to activate your access.
      </p>

      <p
        className="text-sm mb-8 max-w-sm"
        style={{ color: "var(--color-muted)" }}
      >
        <strong style={{ color: "var(--color-text)" }}>Important:</strong>{" "}
        use the same email address you used at checkout — your plan will
        activate automatically the moment your account is created.
      </p>

      <Link
        href="/sign-up"
        className="rounded-lg px-6 py-2.5 font-semibold text-sm transition-opacity hover:opacity-90 whitespace-nowrap"
        style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
      >
        Create Your Account
      </Link>
    </Shell>
  );
}

// ── Signed-in state: already upgraded, auto-redirect ──────────────────────

function UpgradeConfirmation() {
  const [countdown, setCountdown] = useState(REDIRECT_SECS);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(interval);
          window.location.href = DASHBOARD_URL;
          return 0;
        }
        return n - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <Shell>
      <CheckIcon />

      <h1
        className="text-2xl font-semibold mb-3 tracking-tight"
        style={{ color: "var(--color-text)" }}
      >
        You&apos;re all set.
      </h1>

      <p
        className="text-base mb-8 max-w-sm"
        style={{ color: "var(--color-muted)" }}
      >
        Your account has been upgraded. Redirecting you to the dashboard in{" "}
        <span style={{ color: "var(--color-accent)", fontWeight: 600 }}>
          {countdown}
        </span>
        …
      </p>

      <a href={DASHBOARD_URL} className="btn-accent text-sm">
        Go to Dashboard
      </a>
    </Shell>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function PaymentSuccessPage() {
  const { user, isLoaded } = useUser();

  // While Clerk resolves, render the shell without content to avoid flash
  if (!isLoaded) {
    return (
      <div
        className="min-h-screen"
        style={{ background: "var(--color-surface)" }}
      />
    );
  }

  return user ? <UpgradeConfirmation /> : <CreateAccountPrompt />;
}
