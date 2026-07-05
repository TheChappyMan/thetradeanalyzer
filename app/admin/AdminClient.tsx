"use client";

/**
 * AdminClient.tsx
 *
 * Client-side interactive portions of the admin panel.
 * Receives pre-fetched data from the server component.
 */

import { useState, useTransition } from "react";
import type { ReferralPayout, FeedbackRow, FeedbackStats } from "./page";

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function planLabel(plan: string) {
  const MAP: Record<string, string> = {
    "pro-annual":      "Pro Annual",
    "proplus-annual":  "Pro Plus Annual",
    "commissioner":    "Commissioner",
  };
  return MAP[plan] ?? plan;
}

// ── Section 1 — Tier assignment ────────────────────────────────────────────

function TierAssignmentSection() {
  const [email,   setEmail]   = useState("");
  const [tier,    setTier]    = useState("tier1");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/set-tier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), tier }),
        });
        const json = await res.json();
        if (res.ok) {
          setMessage({ text: `✓ Tier set to ${tier} for ${email} (${json.userId})`, ok: true });
          setEmail("");
        } else {
          setMessage({ text: `✗ ${json.error}`, ok: false });
        }
      } catch {
        setMessage({ text: "✗ Request failed", ok: false });
      }
    });
  }

  return (
    <section className="card mb-6">
      <h2 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>
        Manual Tier Assignment
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>
            User Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            required
            className="border rounded-lg px-3 py-1.5 text-sm w-64"
            style={{ borderColor: "var(--color-border)", background: "var(--color-input-bg)", color: "var(--color-text)" }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>
            Tier
          </label>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--color-border)", background: "var(--color-input-bg)", color: "var(--color-text)" }}
          >
            <option value="free">free</option>
            <option value="tier1">tier1 — Pro</option>
            <option value="tier2">tier2 — Pro Plus</option>
            <option value="tier3">tier3 — Commissioner</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
        >
          {pending ? "Assigning…" : "Assign"}
        </button>
      </form>
      {message && (
        <p
          className="mt-3 text-sm"
          style={{ color: message.ok ? "var(--color-primary)" : "var(--color-danger)" }}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

// ── Payout table ───────────────────────────────────────────────────────────

function PayoutRow({
  payout,
  showMarkPaid,
  onMarkPaid,
}: {
  payout:      ReferralPayout;
  showMarkPaid: boolean;
  onMarkPaid?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleMarkPaid() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/referral-payouts/${payout.id}`, { method: "PATCH" });
      if (res.ok) onMarkPaid?.(payout.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
      <td className="py-2 pr-4 text-xs" style={{ color: "var(--color-muted)" }}>
        {payout.referrer_user_id.slice(0, 16)}…
      </td>
      <td className="py-2 pr-4 text-xs" style={{ color: "var(--color-text)" }}>
        {payout.referral_codes?.[0]?.etransfer_email ?? <span style={{ color: "var(--color-muted)" }}>—</span>}
      </td>
      <td className="py-2 pr-4 text-xs" style={{ color: "var(--color-text)" }}>
        {payout.referred_email}
      </td>
      <td className="py-2 pr-4 text-xs" style={{ color: "var(--color-text)" }}>
        {planLabel(payout.plan)}
      </td>
      <td className="py-2 pr-4 text-xs font-semibold" style={{ color: "var(--color-text)" }}>
        ${Number(payout.payout_amount).toFixed(2)}
      </td>
      <td className="py-2 pr-4 text-xs" style={{ color: "var(--color-muted)" }}>
        {fmt(payout.created_at)}
      </td>
      {showMarkPaid && (
        <td className="py-2">
          <button
            onClick={handleMarkPaid}
            disabled={busy}
            className="text-xs rounded px-2 py-1 transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: "var(--color-primary)", color: "#fff" }}
          >
            {busy ? "…" : "Mark Paid"}
          </button>
        </td>
      )}
      {!showMarkPaid && (
        <td className="py-2 text-xs" style={{ color: "var(--color-muted)" }}>
          {fmt(payout.paid_at)}
        </td>
      )}
    </tr>
  );
}

function PayoutTable({
  payouts,
  showMarkPaid,
  onMarkPaid,
}: {
  payouts:     ReferralPayout[];
  showMarkPaid: boolean;
  onMarkPaid?: (id: string) => void;
}) {
  if (payouts.length === 0) {
    return <p className="text-sm" style={{ color: "var(--color-muted)" }}>None.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
            {["Referrer ID", "E-Transfer Email", "Referred User", "Plan", "Amount", showMarkPaid ? "Date" : "Date", showMarkPaid ? "Action" : "Paid"].map((h) => (
              <th key={h} className="pb-2 pr-4 text-xs font-semibold" style={{ color: "var(--color-muted)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payouts.map((p) => (
            <PayoutRow
              key={p.id}
              payout={p}
              showMarkPaid={showMarkPaid}
              onMarkPaid={onMarkPaid}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section 4 — Accuracy feedback ──────────────────────────────────────────

const SPORT_LABELS: Record<string, string> = {
  nhl: "NHL", nfl: "NFL", mlb: "MLB", overall: "Overall",
};

function ratingColor(avg: number): string {
  if (avg >= 7.5) return "var(--color-primary)";
  if (avg >= 5)   return "var(--color-accent)";
  return "var(--color-danger)";
}

function FeedbackSection({
  feedback,
  stats,
}: {
  feedback: FeedbackRow[];
  stats:    FeedbackStats[];
}) {
  const [sportFilter, setSportFilter] = useState<string>("all");

  const filtered = sportFilter === "all"
    ? feedback
    : feedback.filter((f) => f.sport === sportFilter);

  // Keep a stable card order: sports first, overall last
  const orderedStats = [...stats].sort((a, b) => {
    if (a.sport === "overall") return 1;
    if (b.sport === "overall") return -1;
    return a.sport.localeCompare(b.sport);
  });

  return (
    <section className="card mt-6">
      <h2 className="text-base font-semibold mb-4" style={{ color: "var(--color-text)" }}>
        Accuracy Feedback
      </h2>

      {feedback.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          No feedback submitted yet.
        </p>
      ) : (
        <>
          {/* Average score cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {orderedStats.map((s) => (
              <div
                key={s.sport}
                className="rounded-xl border p-3 text-center"
                style={{ borderColor: "var(--color-border)" }}
              >
                <div className="text-xs mb-1" style={{ color: "var(--color-muted)" }}>
                  {SPORT_LABELS[s.sport] ?? s.sport.toUpperCase()}
                </div>
                <div className="text-2xl font-semibold" style={{ color: ratingColor(s.average) }}>
                  {s.average.toFixed(1)}
                </div>
                <div className="text-[10px]" style={{ color: "var(--color-muted)" }}>
                  {s.count} rating{s.count === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>

          {/* Sport filter */}
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs" style={{ color: "var(--color-muted)" }}>Filter:</label>
            <select
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value)}
              className="border rounded-lg px-2 py-1 text-xs"
              style={{ borderColor: "var(--color-border)", background: "var(--color-input-bg)", color: "var(--color-text)" }}
            >
              <option value="all">All sports</option>
              <option value="nhl">NHL</option>
              <option value="nfl">NFL</option>
              <option value="mlb">MLB</option>
            </select>
            <span className="text-xs" style={{ color: "var(--color-muted)" }}>
              {filtered.length} submission{filtered.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Individual submissions */}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                  {["Date", "Sport", "Rating", "Comments", "User"].map((h) => (
                    <th key={h} className="pb-2 pr-4 text-xs font-semibold" style={{ color: "var(--color-muted)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => (
                  <tr key={f.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td className="py-2 pr-4 text-xs whitespace-nowrap" style={{ color: "var(--color-muted)" }}>
                      {fmt(f.created_at)}
                    </td>
                    <td className="py-2 pr-4 text-xs" style={{ color: "var(--color-text)" }}>
                      {SPORT_LABELS[f.sport] ?? f.sport.toUpperCase()}
                    </td>
                    <td className="py-2 pr-4 text-xs font-semibold whitespace-nowrap" style={{ color: ratingColor(f.rating) }}>
                      {f.rating} / 10
                    </td>
                    <td className="py-2 pr-4 text-xs max-w-md" style={{ color: "var(--color-text)" }}>
                      {f.comments ?? <span style={{ color: "var(--color-muted)" }}>—</span>}
                    </td>
                    <td className="py-2 text-xs" style={{ color: "var(--color-muted)" }}>
                      {f.user_id ? `${f.user_id.slice(0, 16)}…` : "Anonymous"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

// ── Main export ────────────────────────────────────────────────────────────

export default function AdminClient({
  pendingPayouts: initialPending,
  paidPayouts,
  totalPending,
  feedback,
  feedbackStats,
}: {
  pendingPayouts: ReferralPayout[];
  paidPayouts:    ReferralPayout[];
  totalPending:   number;
  feedback:       FeedbackRow[];
  feedbackStats:  FeedbackStats[];
}) {
  const [pending, setPending] = useState(initialPending);
  const [historyOpen, setHistoryOpen] = useState(false);

  function handleMarkPaid(id: string) {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  const currentTotal = pending.reduce((s, r) => s + Number(r.payout_amount), 0);

  return (
    <>
      {/* ── Section 1 ─────────────────────────────────────────────── */}
      <TierAssignmentSection />

      {/* ── Section 2 ─────────────────────────────────────────────── */}
      <section className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
            Pending Referral Payouts
          </h2>
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--color-accent)" }}
          >
            Total: ${currentTotal.toFixed(2)}
          </span>
        </div>
        <PayoutTable
          payouts={pending}
          showMarkPaid
          onMarkPaid={handleMarkPaid}
        />
      </section>

      {/* ── Section 3 ─────────────────────────────────────────────── */}
      <section className="card">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
            Paid Referral History
          </h2>
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>
            {historyOpen ? "▲ Collapse" : "▼ Expand"}
          </span>
        </button>

        {historyOpen && (
          <div className="mt-4">
            <PayoutTable payouts={paidPayouts} showMarkPaid={false} />
          </div>
        )}
      </section>

      {/* ── Section 4 ─────────────────────────────────────────────── */}
      <FeedbackSection feedback={feedback} stats={feedbackStats} />
    </>
  );
}
