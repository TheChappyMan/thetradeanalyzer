"use client";

/**
 * /payment-success
 *
 * Stripe redirects here after a successful Payment Link checkout.
 *
 * Configure each Stripe Payment Link's "After payment" success URL to
 * (tier value must match the link's plan — see TIER_INFO below):
 *   https://app.thetradeanalyzer.com/payment-success?tier=pro_annual&order_id={CHECKOUT_SESSION_ID}
 * ({CHECKOUT_SESSION_ID} is filled automatically by Stripe.)
 *
 * When both tier and order_id are present, a GA4 "purchase" conversion event
 * fires once per order_id (deduplicated via sessionStorage). The page renders
 * correctly whether or not the params are present.
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
const LOGO_URL       = "/logo-white.png";

// ── GA4 purchase conversion ────────────────────────────────────────────────

const TIER_INFO: Record<string, { value: number; name: string }> = {
  pro_annual:      { value: 20,   name: "Pro Annual" },
  pro_monthly:     { value: 2.99, name: "Pro Monthly" },
  proplus_annual:  { value: 45,   name: "Pro Plus Annual" },
  proplus_monthly: { value: 6.99, name: "Pro Plus Monthly" },
  commissioner:    { value: 200,  name: "Commissioner Annual" },
};

const FIRED_KEY = "fta-ga4-purchase-fired"; // sessionStorage: JSON array of order_ids

function firePurchaseEvent() {
  const params  = new URLSearchParams(window.location.search);
  const tier    = params.get("tier");
  const orderId = params.get("order_id");
  if (!tier || !orderId) return;

  const info = TIER_INFO[tier];
  if (!info) return;

  // Dedupe: skip if this order_id already fired this session (page refresh)
  let fired: string[] = [];
  try { fired = JSON.parse(sessionStorage.getItem(FIRED_KEY) ?? "[]"); } catch {}
  if (fired.includes(orderId)) return;

  // The base gtag script loads afterInteractive and may not be ready when
  // this effect runs — poll briefly instead of firing into the void.
  let attempts = 0;
  const send = () => {
    if (typeof window.gtag === "function") {
      window.gtag("event", "purchase", {
        transaction_id: orderId,
        value: info.value,
        currency: "CAD",
        items: [{ item_id: tier, item_name: info.name, price: info.value, quantity: 1 }],
      });
      try { sessionStorage.setItem(FIRED_KEY, JSON.stringify([...fired, orderId])); } catch {}
      return;
    }
    if (attempts++ < 25) setTimeout(send, 200); // retry for up to ~5 s
  };
  send();
}

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

  // Fire the GA4 purchase conversion once on mount — independent of Clerk
  // state so it isn't lost if the user closes the tab before Clerk resolves.
  useEffect(() => {
    firePurchaseEvent();
  }, []);

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
