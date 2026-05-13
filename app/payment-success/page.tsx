"use client";

/**
 * /payment-success
 *
 * Shown by Helcim after a successful subscription checkout.
 * Displays a brief confirmation, then redirects to the app dashboard
 * after 3 seconds so the user can start using their new tier.
 *
 * Configure your Helcim plan's "Success URL" to:
 *   https://app.thetradeanalyzer.com/payment-success
 */

import { useEffect, useState } from "react";

const REDIRECT_URL  = "https://app.thetradeanalyzer.com";
const REDIRECT_SECS = 3;

export default function PaymentSuccessPage() {
  const [countdown, setCountdown] = useState(REDIRECT_SECS);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(interval);
          window.location.href = REDIRECT_URL;
          return 0;
        }
        return n - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-8 text-center"
      style={{ background: "var(--color-surface)" }}
    >
      {/* Logo */}
      <a href={REDIRECT_URL} className="mb-10 block">
        <img
          src="https://thetradeanalyzer.com/wp-content/uploads/2026/05/The-Trade-Analyzer-Header-Logo-White.png"
          alt="The Trade Analyzer"
          className="h-10 mx-auto"
        />
      </a>

      {/* Check icon */}
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

      {/* Heading */}
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

      {/* Manual link in case redirect is slow */}
      <a
        href={REDIRECT_URL}
        className="btn-accent text-sm"
      >
        Go to Dashboard
      </a>
    </div>
  );
}
