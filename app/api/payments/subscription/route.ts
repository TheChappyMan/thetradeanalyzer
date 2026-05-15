/**
 * POST /api/payments/subscription
 *
 * Helcim webhook handler.
 *
 * ── Verification ─────────────────────────────────────────────────────────
 * Helcim signs every webhook with HMAC-SHA256 using your secret.
 * The signature is delivered in the `X-Helcim-Hmac-Sha256` header as a
 * hex-encoded string of the raw request body.
 *
 * ── Payload shape (Helcim) ───────────────────────────────────────────────
 * {
 *   "event":   "subscription.activated" | "subscription.cancelled" | "subscription.expired",
 *   "data": {
 *     "subscription": {
 *       "planCode":     "pro-monthly",
 *       "referralCode": "K9M2-JUSTIN"   // ← only if Helcim passes it through
 *     },
 *     "customer": {
 *       "email": "user@example.com"
 *     }
 *   }
 * }
 *
 * ── Referral code tracking limitation ────────────────────────────────────
 * The WordPress pricing page appends ?ref=CODE to the Helcim subscription
 * URL. Whether Helcim includes this in the webhook payload depends on their
 * platform.  The code below reads data.subscription.referralCode — if
 * Helcim does NOT pass custom URL parameters through to webhooks, referral
 * tracking for new subscriptions will silently no-op and no payout row
 * will be written.  In that case, implement a pre-checkout page at
 * /checkout?plan=X&ref=CODE that stores the code in a Supabase session
 * row keyed by email before forwarding to Helcim.
 *
 * ── Tier mapping ─────────────────────────────────────────────────────────
 *   pro-monthly / pro-annual       → tier1
 *   proplus-monthly / proplus-annual → tier2
 *   commissioner                   → tier3
 *
 * ── Cancellation / expiry ────────────────────────────────────────────────
 *   tier1 / tier2  → set tier: "free" immediately
 *   tier3          → set grace_until = now + 7 days (not immediate removal)
 *
 * ── Pre-auth payment flow ────────────────────────────────────────────────
 * If no Clerk user exists for the email yet, a row is written to
 * pending_tier_assignments.  The Clerk user.created webhook picks it up
 * and assigns the tier when the account is created.
 */

import { NextResponse }  from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { clerkClient }   from "@clerk/nextjs/server";
import { supabase }      from "@/lib/supabase";
import { ensureReferralCode, getReferralByCode, recordReferralPayout, REFERRAL_PAYOUT } from "@/lib/referral";

// ── Plan → tier mapping ────────────────────────────────────────────────────

const PLAN_TIER: Record<string, string> = {
  "pro-monthly":      "tier1",
  "pro-annual":       "tier1",
  "proplus-monthly":  "tier2",
  "proplus-annual":   "tier2",
  "commissioner":     "tier3",
};

// ── Signature verification ─────────────────────────────────────────────────

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  try {
    const computed = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("hex");
    const a = Buffer.from(signature.toLowerCase());
    const b = Buffer.from(computed.toLowerCase());
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // ── 1. Read raw body (needed for HMAC) ──────────────────────────────────
  const rawBody = await request.text();

  // ── 2. Verify signature ─────────────────────────────────────────────────
  const webhookSecret = process.env.HELCIM_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[helcim webhook] HELCIM_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const signature = request.headers.get("X-Helcim-Hmac-Sha256") ?? "";
  if (!signature || !verifySignature(rawBody, signature, webhookSecret)) {
    console.warn("[helcim webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 3. Parse payload ─────────────────────────────────────────────────────
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const p           = payload as Record<string, unknown>;
  const event       = (p.event as string | undefined) ?? "";
  const data        = (p.data as Record<string, unknown> | undefined) ?? {};
  const subData     = (data.subscription as Record<string, unknown> | undefined) ?? {};
  const custData    = (data.customer    as Record<string, unknown> | undefined) ?? {};

  const planCode      = (subData.planCode     as string | undefined) ?? "";
  const referralCode  = (subData.referralCode as string | undefined) ?? "";  // may be empty
  const customerEmail = ((custData.email as string | undefined) ?? "").trim().toLowerCase();

  if (!customerEmail) {
    console.warn("[helcim webhook] No customer email in payload");
    return NextResponse.json({ error: "Missing customer email" }, { status: 400 });
  }

  // ── 4. Activation ────────────────────────────────────────────────────────

  if (event === "subscription.activated" || event === "subscription.created") {
    const tier = PLAN_TIER[planCode];
    if (!tier) {
      console.warn(`[helcim webhook] Unknown planCode: ${planCode}`);
      return NextResponse.json({ error: `Unknown plan: ${planCode}` }, { status: 400 });
    }

    // Look up Clerk user
    const clerk = await clerkClient();
    const { data: userList } = await clerk.users.getUserList({ emailAddress: [customerEmail] });
    const clerkUser = userList?.[0];

    if (!clerkUser) {
      // No Clerk account yet — store as pending
      const { error: insertErr } = await supabase
        .from("pending_tier_assignments")
        .insert({ email: customerEmail, tier, plan: planCode });

      if (insertErr) {
        console.error("[helcim webhook] Failed to insert pending_tier_assignments:", insertErr.message);
      } else {
        console.log(`[helcim webhook] Stored pending tier=${tier} for ${customerEmail}`);
      }

      return NextResponse.json({ received: true, note: "Pending assignment created" });
    }

    const userId      = clerkUser.id;
    const displayName = clerkUser.firstName ?? clerkUser.username ?? customerEmail.split("@")[0];

    // Assign tier
    await clerk.users.updateUser(userId, {
      publicMetadata: { ...clerkUser.publicMetadata, tier },
    });

    // Generate referral code
    await ensureReferralCode(userId, displayName);

    // Commissioner: create/refresh commissioner_groups
    if (tier === "tier3") {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      const { error: upsertErr } = await supabase
        .from("commissioner_groups")
        .upsert(
          { commissioner_user_id: userId, expires_at: expiresAt.toISOString(), grace_until: null },
          { onConflict: "commissioner_user_id" },
        );
      if (upsertErr) console.error("[helcim webhook] Failed to upsert commissioner_groups:", upsertErr.message);
    }

    console.log(`[helcim webhook] Set tier=${tier} for ${customerEmail} (${userId})`);

    // ── Referral tracking (annual plans only) ──────────────────────────
    // NOTE: referralCode will be empty unless Helcim passes the ?ref= URL
    // parameter from the pricing page through to the webhook payload.
    // If it's empty, this block is a no-op. See file header for details.
    if (referralCode && REFERRAL_PAYOUT[planCode] !== undefined) {
      const referrer = await getReferralByCode(referralCode);
      if (referrer) {
        await recordReferralPayout({
          referralCodeId:  referrer.id,
          referrerUserId:  referrer.user_id,
          referredEmail:   customerEmail,
          referredUserId:  userId,
          plan:            planCode,
          payoutAmount:    REFERRAL_PAYOUT[planCode],
        });
        console.log(`[helcim webhook] Recorded referral payout for code ${referralCode}`);
      } else {
        console.warn(`[helcim webhook] Referral code not found: ${referralCode}`);
      }
    }

  // ── 5. Cancellation / expiry ─────────────────────────────────────────────

  } else if (
    event === "subscription.cancelled" ||
    event === "subscription.expired"  ||
    event === "subscription.deactivated"
  ) {
    const clerk = await clerkClient();
    const { data: userList } = await clerk.users.getUserList({ emailAddress: [customerEmail] });
    const clerkUser = userList?.[0];

    if (!clerkUser) {
      // Remove any pending assignment
      await supabase
        .from("pending_tier_assignments")
        .delete()
        .eq("email", customerEmail)
        .is("assigned_at", null);
      console.log(`[helcim webhook] Cancelled — removed pending assignment for ${customerEmail}`);
      return NextResponse.json({ received: true });
    }

    const userId      = clerkUser.id;
    const currentTier = (clerkUser.publicMetadata?.tier as string | undefined) ?? "free";

    if (currentTier === "tier3") {
      const graceUntil = new Date();
      graceUntil.setDate(graceUntil.getDate() + 7);
      const { error: graceErr } = await supabase
        .from("commissioner_groups")
        .update({ grace_until: graceUntil.toISOString() })
        .eq("commissioner_user_id", userId);
      if (graceErr) console.error("[helcim webhook] Failed to set grace_until:", graceErr.message);
      console.log(`[helcim webhook] Set grace_until for commissioner ${userId}`);
    } else {
      await clerk.users.updateUser(userId, {
        publicMetadata: { ...clerkUser.publicMetadata, tier: "free" },
      });
      console.log(`[helcim webhook] Downgraded to free for ${customerEmail} (${userId})`);
    }

  } else {
    console.log(`[helcim webhook] Unhandled event type: ${event}`);
  }

  return NextResponse.json({ received: true });
}
