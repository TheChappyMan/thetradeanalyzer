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
 *       "planCode": "pro-monthly",   // matches the code you set in Helcim
 *       "status":   "active" | "cancelled" | "expired"
 *     },
 *     "customer": {
 *       "email": "user@example.com"
 *     }
 *   }
 * }
 *
 * Adjust field paths below if your Helcim plan uses different keys.
 *
 * ── Tier mapping ─────────────────────────────────────────────────────────
 *   pro-monthly / pro-annual       → tier1
 *   proplus-monthly / proplus-annual → tier2
 *   commissioner                   → tier3
 *
 * ── Cancellation / expiry ────────────────────────────────────────────────
 *   tier1 / tier2  → set tier: "free" immediately
 *   tier3          → set grace_until = now + 7 days (not immediate removal)
 */

import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { clerkClient } from "@clerk/nextjs/server";
import { supabase } from "@/lib/supabase";

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
    // timingSafeEqual requires equal-length buffers
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

  // Type-safe field extraction
  const p = payload as Record<string, unknown>;
  const event     = (p.event as string | undefined) ?? "";
  const data      = (p.data as Record<string, unknown> | undefined) ?? {};
  const subData   = (data.subscription as Record<string, unknown> | undefined) ?? {};
  const custData  = (data.customer    as Record<string, unknown> | undefined) ?? {};

  const planCode    = (subData.planCode as string | undefined) ?? "";
  const customerEmail = ((custData.email as string | undefined) ?? "").trim().toLowerCase();

  if (!customerEmail) {
    console.warn("[helcim webhook] No customer email in payload");
    return NextResponse.json({ error: "Missing customer email" }, { status: 400 });
  }

  // ── 4. Look up Clerk user by email ──────────────────────────────────────
  const clerk = await clerkClient();
  const { data: userList } = await clerk.users.getUserList({
    emailAddress: [customerEmail],
  });

  const clerkUser = userList?.[0];
  if (!clerkUser) {
    // User hasn't created an account yet — return 200 to prevent retries
    console.warn(`[helcim webhook] No Clerk user found for ${customerEmail}`);
    return NextResponse.json({ received: true, note: "No matching user" });
  }

  const userId = clerkUser.id;

  // ── 5. Handle event ─────────────────────────────────────────────────────

  if (event === "subscription.activated" || event === "subscription.created") {
    // ── Activation / renewal ──────────────────────────────────────────────
    const tier = PLAN_TIER[planCode];
    if (!tier) {
      console.warn(`[helcim webhook] Unknown planCode: ${planCode}`);
      return NextResponse.json({ error: `Unknown plan: ${planCode}` }, { status: 400 });
    }

    await clerk.users.updateUser(userId, {
      publicMetadata: { ...clerkUser.publicMetadata, tier },
    });

    // Commissioner (tier3): create or refresh commissioner_groups row
    if (tier === "tier3") {
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      // Upsert by commissioner_user_id
      const { error: upsertErr } = await supabase
        .from("commissioner_groups")
        .upsert(
          {
            commissioner_user_id: userId,
            expires_at:           expiresAt.toISOString(),
            grace_until:          null,   // clear any existing grace period
          },
          { onConflict: "commissioner_user_id" }
        );

      if (upsertErr) {
        console.error("[helcim webhook] Failed to upsert commissioner_groups:", upsertErr.message);
        // Don't return an error — tier was set; log and continue
      }
    }

    console.log(`[helcim webhook] Set tier=${tier} for ${customerEmail} (${userId})`);

  } else if (
    event === "subscription.cancelled" ||
    event === "subscription.expired"  ||
    event === "subscription.deactivated"
  ) {
    // ── Cancellation / expiry ─────────────────────────────────────────────
    const currentTier = (clerkUser.publicMetadata?.tier as string | undefined) ?? "free";

    if (currentTier === "tier3") {
      // Commissioner: 7-day grace period before losing access
      const graceUntil = new Date();
      graceUntil.setDate(graceUntil.getDate() + 7);

      const { error: graceErr } = await supabase
        .from("commissioner_groups")
        .update({ grace_until: graceUntil.toISOString() })
        .eq("commissioner_user_id", userId);

      if (graceErr) {
        console.error("[helcim webhook] Failed to set grace_until:", graceErr.message);
      }

      console.log(`[helcim webhook] Set grace_until=${graceUntil.toISOString()} for commissioner ${userId}`);

    } else {
      // Pro / Pro Plus: immediate downgrade to free
      await clerk.users.updateUser(userId, {
        publicMetadata: { ...clerkUser.publicMetadata, tier: "free" },
      });

      console.log(`[helcim webhook] Downgraded to free for ${customerEmail} (${userId})`);
    }

  } else {
    // Unknown event — acknowledge and ignore
    console.log(`[helcim webhook] Unhandled event type: ${event}`);
  }

  return NextResponse.json({ received: true });
}
