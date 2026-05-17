"use client";

/**
 * /sign-up
 *
 * Plan-aware sign-up page.
 *
 * Query param ?plan= accepts:
 *   pro-monthly | pro-annual | proplus-monthly | proplus-annual | commissioner
 *
 * Flow:
 *   1. If signed-out  → show Clerk <SignUp>.  afterSignUpUrl loops back here
 *                       so the redirect to Stripe fires once Clerk resolves.
 *   2. If signed-in   → redirect to the Stripe Payment Link for the chosen
 *                       plan (email pre-filled via ?prefilled_email=…).
 *   3. No valid plan  → redirect to the dashboard (/).
 */

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useUser, SignUp } from "@clerk/nextjs";

// ── Stripe Payment Link URLs ───────────────────────────────────────────────
// Set each URL in your environment variables (no trailing slash).
// Stripe Payment Links support ?prefilled_email= to pre-fill the checkout form.

const PLAN_STRIPE_URLS: Record<string, string | undefined> = {
  "pro-monthly":      process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_URL,
  "pro-annual":       process.env.NEXT_PUBLIC_STRIPE_PRO_ANNUAL_URL,
  "proplus-monthly":  process.env.NEXT_PUBLIC_STRIPE_PROPLUS_MONTHLY_URL,
  "proplus-annual":   process.env.NEXT_PUBLIC_STRIPE_PROPLUS_ANNUAL_URL,
  "commissioner":     process.env.NEXT_PUBLIC_STRIPE_COMMISSIONER_URL,
};

// ── Inner component (needs useSearchParams — must be inside Suspense) ──────

function SignUpInner() {
  const searchParams   = useSearchParams();
  const plan           = searchParams.get("plan") ?? "";
  const stripeBaseUrl  = PLAN_STRIPE_URLS[plan];

  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!isLoaded) return;

    if (user) {
      if (stripeBaseUrl) {
        // Pre-fill email on the Stripe Payment Link checkout form
        const email = user.primaryEmailAddress?.emailAddress
          ?? user.emailAddresses?.[0]?.emailAddress
          ?? "";
        const checkoutUrl = email
          ? `${stripeBaseUrl}?prefilled_email=${encodeURIComponent(email)}`
          : stripeBaseUrl;
        window.location.href = checkoutUrl;
      } else {
        // No valid plan → go to dashboard
        window.location.href = "/";
      }
    }
  }, [isLoaded, user, stripeBaseUrl]);

  // Already signed in — the useEffect above will redirect; show nothing
  if (isLoaded && user) return null;

  // Signed-out — show Clerk SignUp.
  // afterSignUpUrl loops back to this same URL so the redirect fires once
  // Clerk resolves the newly-created session.
  const afterSignUpUrl = plan ? `/sign-up?plan=${plan}` : "/";

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--color-surface)" }}
    >
      {/* Brand header */}
      <a href="/" className="mb-8 block">
        <img
          src="https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Header-Logo-White.png"
          alt="The Trade Analyzer"
          className="h-10 mx-auto"
        />
      </a>

      {plan && stripeBaseUrl && (
        <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
          Create your free account, then complete your subscription checkout.
        </p>
      )}

      <SignUp
        afterSignUpUrl={afterSignUpUrl}
        afterSignInUrl={afterSignUpUrl}
        appearance={{
          elements: {
            rootBox: "w-full max-w-md",
            card: "rounded-2xl shadow-lg",
          },
        }}
      />
    </div>
  );
}

// ── Page export (Suspense boundary required for useSearchParams) ────────────

export default function SignUpPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: "var(--color-surface)" }}
        />
      }
    >
      <SignUpInner />
    </Suspense>
  );
}
