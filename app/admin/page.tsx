/**
 * /admin
 *
 * Admin panel — accessible only to users listed in ADMIN_USER_IDS.
 * Non-admin users are silently redirected to the dashboard; no 403 page.
 *
 * Sections:
 *   1. Manual tier assignment
 *   2. Pending referral payouts
 *   3. Paid referral history (collapsed)
 */

import { redirect }   from "next/navigation";
import { isAdmin }    from "@/lib/auth";
import { supabase }   from "@/lib/supabase";
import AdminClient    from "./AdminClient";

// ── Types ──────────────────────────────────────────────────────────────────

export type ReferralPayout = {
  id:               string;
  referrer_user_id: string;
  referred_email:   string;
  plan:             string;
  payout_amount:    number;
  status:           string;
  created_at:       string;
  paid_at:          string | null;
  // Supabase returns joined relations as an array even for single-row joins
  referral_codes: { etransfer_email: string | null }[] | null;
};

// ── Page ───────────────────────────────────────────────────────────────────

export default async function AdminPage() {
  // Silent redirect for non-admins
  if (!(await isAdmin())) redirect("/");

  // ── Fetch pending payouts ────────────────────────────────────────────
  const { data: pendingPayouts } = await supabase
    .from("referral_payouts")
    .select("id, referrer_user_id, referred_email, plan, payout_amount, status, created_at, paid_at, referral_codes(etransfer_email)")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  // ── Fetch paid payouts ────────────────────────────────────────────────
  const { data: paidPayouts } = await supabase
    .from("referral_payouts")
    .select("id, referrer_user_id, referred_email, plan, payout_amount, status, created_at, paid_at, referral_codes(etransfer_email)")
    .eq("status", "paid")
    .order("paid_at", { ascending: false })
    .limit(100);

  const totalPending = (pendingPayouts ?? []).reduce(
    (sum, r) => sum + Number(r.payout_amount),
    0,
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1
        className="text-2xl font-semibold mb-1 tracking-tight"
        style={{ color: "var(--color-text)" }}
      >
        Admin Panel
      </h1>
      <p className="text-xs mb-8" style={{ color: "var(--color-muted)" }}>
        Visible only to admin users. All actions are server-side verified.
      </p>

      <AdminClient
        pendingPayouts={(pendingPayouts ?? []) as ReferralPayout[]}
        paidPayouts={(paidPayouts ?? []) as ReferralPayout[]}
        totalPending={totalPending}
      />
    </div>
  );
}
