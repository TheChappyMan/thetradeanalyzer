/**
 * PATCH /api/admin/referral-payouts/[id]
 *
 * Marks a referral payout row as paid.
 * Admin only — checked server-side via isAdmin().
 *
 * Returns: { success: true } or { error: string }
 */

import { NextResponse } from "next/server";
import { isAdmin }      from "@/lib/auth";
import { supabase }     from "@/lib/supabase";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ── Admin gate ─────────────────────────────────────────────────────────
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing payout id" }, { status: 400 });
  }

  const { error } = await supabase
    .from("referral_payouts")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending");  // idempotency guard

  if (error) {
    console.error("[admin/referral-payouts] Failed to mark paid:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
