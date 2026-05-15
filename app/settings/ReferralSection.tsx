"use client";

/**
 * ReferralSection
 *
 * Shown inside the Settings page for paid users (tier1/tier2/tier3).
 * - Displays the user's referral code with a copy button
 * - Allows updating the e-transfer email for payouts
 * - Shows payout rates
 */

import { useState } from "react";

type Props = {
  code:           string;
  etransferEmail: string | null;
  userId:         string;
};

export default function ReferralSection({ code, etransferEmail: initialEmail, userId }: Props) {
  const [email,   setEmail]   = useState(initialEmail ?? "");
  const [copied,  setCopied]  = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [saveErr, setSaveErr] = useState("");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the text
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setSaveErr("");
    try {
      const res = await fetch("/api/settings/referral", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ etransferEmail: email.trim() }),
      });
      const json = await res.json();
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setSaveErr(json.error ?? "Failed to save");
      }
    } catch {
      setSaveErr("Request failed");
    } finally {
      setSaving(false);
    }
  }

  // Suppress unused-variable lint warning for userId (may be used later)
  void userId;

  return (
    <div
      className="p-6 max-w-6xl mx-auto border-t mt-2"
      style={{ borderColor: "var(--color-border)" }}
    >
      <h2
        className="text-lg font-semibold mb-1 tracking-tight"
        style={{ color: "var(--color-text)" }}
      >
        Referral Program
      </h2>
      <p className="text-sm mb-6" style={{ color: "var(--color-muted)" }}>
        Share your referral code with friends. When they complete an annual
        subscription you&apos;ll receive a payout via e-transfer.
      </p>

      {/* Referral code */}
      <div className="mb-6">
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-muted)" }}
        >
          Your Referral Code
        </label>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={code}
            className="border rounded-lg px-3 py-1.5 text-sm font-mono w-36 select-all"
            style={{
              borderColor: "var(--color-border)",
              background:  "var(--color-input-bg)",
              color:       "var(--color-text)",
            }}
          />
          <button
            onClick={handleCopy}
            className="rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ background: "var(--color-accent)", color: "var(--color-accent-text)" }}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      {/* Payout rates */}
      <div className="mb-6">
        <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
          Payout Rates (annual subscriptions only)
        </p>
        <ul className="text-sm space-y-1" style={{ color: "var(--color-text)" }}>
          <li>Pro Annual referral — <strong>$10</strong></li>
          <li>Pro Plus Annual referral — <strong>$16</strong></li>
          <li>Commissioner referral — <strong>$50</strong></li>
        </ul>
        <p className="text-xs mt-3" style={{ color: "var(--color-muted)" }}>
          Payouts are sent manually via e-transfer after a referred user
          completes an annual subscription.
        </p>
      </div>

      {/* E-transfer email */}
      <form onSubmit={handleSave} className="max-w-sm">
        <label
          className="block text-xs font-medium mb-1"
          style={{ color: "var(--color-muted)" }}
        >
          E-Transfer Email for Payouts
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="border rounded-lg px-3 py-1.5 text-sm w-full mb-2"
          style={{
            borderColor: "var(--color-border)",
            background:  "var(--color-input-bg)",
            color:       "var(--color-text)",
          }}
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "var(--color-primary)", color: "#fff" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span className="ml-3 text-sm" style={{ color: "var(--color-primary)" }}>
            Saved ✓
          </span>
        )}
        {saveErr && (
          <span className="ml-3 text-sm" style={{ color: "var(--color-danger)" }}>
            {saveErr}
          </span>
        )}
      </form>
    </div>
  );
}
