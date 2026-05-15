/**
 * PATCH /api/settings/referral
 *
 * Updates the authenticated user's e-transfer email on their referral_codes row.
 * Requires a paid tier (tier1, tier2, or tier3).
 *
 * Body: { etransferEmail: string }
 */

import { NextResponse }  from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { supabase }      from "@/lib/supabase";

export async function PATCH(request: Request) {
  // ── Auth ─────────────────────────────────────────────────────────────────
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  const tier = (user?.publicMetadata?.tier as string | undefined) ?? "free";
  if (!["tier1", "tier2", "tier3"].includes(tier)) {
    return NextResponse.json({ error: "Paid subscription required" }, { status: 403 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { etransferEmail?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const etransferEmail = (body.etransferEmail ?? "").trim();

  // ── Update row ────────────────────────────────────────────────────────────
  const { error } = await supabase
    .from("referral_codes")
    .update({ etransfer_email: etransferEmail || null })
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
