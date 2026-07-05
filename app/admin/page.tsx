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
 *   4. Accuracy feedback (averages + individual submissions)
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

export type FeedbackRow = {
  id:         string;
  user_id:    string | null;
  sport:      string;
  rating:     number;
  comments:   string | null;
  created_at: string;
};

export type FeedbackStats = {
  sport:   string;
  count:   number;
  average: number;
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

  // ── Fetch accuracy feedback ───────────────────────────────────────────
  const { data: feedbackRows } = await supabase
    .from("feedback")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  const feedback = (feedbackRows ?? []) as FeedbackRow[];

  // Average + count per sport, plus an overall line
  const bySport = new Map<string, number[]>();
  for (const row of feedback) {
    const list = bySport.get(row.sport) ?? [];
    list.push(row.rating);
    bySport.set(row.sport, list);
  }
  const feedbackStats: FeedbackStats[] = [...bySport.entries()].map(([sport, ratings]) => ({
    sport,
    count:   ratings.length,
    average: ratings.reduce((a, b) => a + b, 0) / ratings.length,
  }));
  if (feedback.length > 0) {
    feedbackStats.push({
      sport:   "overall",
      count:   feedback.length,
      average: feedback.reduce((a, r) => a + r.rating, 0) / feedback.length,
    });
  }

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
        feedback={feedback}
        feedbackStats={feedbackStats}
      />
    </div>
  );
}
