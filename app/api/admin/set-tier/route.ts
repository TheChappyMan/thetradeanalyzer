/**
 * POST /api/admin/set-tier
 *
 * Manually assigns a tier to a user by email address.
 * Admin only — checked server-side via isAdmin().
 *
 * Body: { email: string, tier: "free" | "tier1" | "tier2" | "tier3" }
 * Returns: { success: true, userId: string } or { error: string }
 */

import { NextResponse }   from "next/server";
import { isAdmin }        from "@/lib/auth";
import { clerkClient }    from "@clerk/nextjs/server";
import { supabase }       from "@/lib/supabase";
import { ensureReferralCode } from "@/lib/referral";

const PAID_TIERS = new Set(["tier1", "tier2", "tier3"]);

export async function POST(request: Request) {
  // ── Admin gate ───────────────────────────────────────────────────────────
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { email?: string; tier?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const email = (body.email ?? "").trim().toLowerCase();
  const tier  = (body.tier  ?? "").trim();

  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (!["free", "tier1", "tier2", "tier3"].includes(tier)) {
    return NextResponse.json({ error: "tier must be free, tier1, tier2, or tier3" }, { status: 400 });
  }

  // ── Look up Clerk user ───────────────────────────────────────────────────
  const clerk = await clerkClient();
  const { data: userList } = await clerk.users.getUserList({ emailAddress: [email] });
  const clerkUser = userList?.[0];

  if (!clerkUser) {
    return NextResponse.json({ error: `No user found with email: ${email}` }, { status: 404 });
  }

  const userId = clerkUser.id;

  // ── Set tier in Clerk publicMetadata ─────────────────────────────────────
  await clerk.users.updateUser(userId, {
    publicMetadata: { ...clerkUser.publicMetadata, tier },
  });

  // ── Generate referral code for paid tiers ────────────────────────────────
  if (PAID_TIERS.has(tier)) {
    const displayName = clerkUser.firstName ?? clerkUser.username ?? email.split("@")[0];
    await ensureReferralCode(userId, displayName);
  }

  // ── Commissioner: upsert commissioner_groups ─────────────────────────────
  if (tier === "tier3") {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const { error: upsertErr } = await supabase
      .from("commissioner_groups")
      .upsert(
        { commissioner_user_id: userId, expires_at: expiresAt.toISOString(), grace_until: null },
        { onConflict: "commissioner_user_id" },
      );
    if (upsertErr) {
      console.error("[admin/set-tier] Failed to upsert commissioner_groups:", upsertErr.message);
    }
  }

  console.log(`[admin/set-tier] Set tier=${tier} for ${email} (${userId})`);
  return NextResponse.json({ success: true, userId });
}
