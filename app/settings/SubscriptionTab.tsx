import React from "react";

/** Manage Subscription tab — the only tab free users see. */
export default function SubscriptionTab({
  tier, isPaid, referralSection,
}: {
  tier: string;
  isPaid: boolean;
  /** Referral program card (paid users only). */
  referralSection?: React.ReactNode;
}) {
  return (
    <>
      {referralSection}

      <div className="card">
        <h2
          className="text-lg font-semibold mb-1 tracking-tight"
          style={{ color: "var(--color-text)" }}
        >
          Subscription
        </h2>
        {isPaid ? (
          <>
            <p className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>
              Current plan:{" "}
              <strong style={{ color: "var(--color-text)" }}>
                {tier === "tier3" ? "Commissioner" : tier === "tier2" ? "Pro Plus" : "Pro"}
              </strong>
            </p>
            <a
              href="https://billing.stripe.com/p/login/6oU28qcbNdno2nG7HQ3Nm00"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: "var(--color-primary)", color: "#fff" }}
            >
              Manage Subscription
            </a>
            <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
              Update your payment method, view invoices, or cancel through the
              Stripe billing portal. Sign in with the email you used at checkout.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm mb-2" style={{ color: "var(--color-muted)" }}>
              You are currently on the Free plan.
            </p>
            <p className="text-sm mb-4">
              🎉 Use code <span className="font-bold">BIG50</span> before December 31, 2026
              and get 50% off forever: no price changes as long as you&apos;re subscribed.
            </p>
            <a
              href="https://thetradeanalyzer.com/pricing"
              className="btn-accent inline-block"
            >
              Upgrade Your Plan
            </a>
          </>
        )}
      </div>
    </>
  );
}
