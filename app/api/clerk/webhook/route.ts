/**
 * POST /api/clerk/webhook
 *
 * Listens for Clerk webhook events and assigns pending tiers on user creation.
 *
 * ── Setup ────────────────────────────────────────────────────────────────
 * In the Clerk dashboard → Webhooks → Add Endpoint:
 *   URL:    https://app.thetradeanalyzer.com/api/clerk/webhook
 *   Events: user.created
 *   Copy the "Signing Secret" → set as CLERK_WEBHOOK_SECRET in your env
 *
 * ── Verification ─────────────────────────────────────────────────────────
 * Clerk delivers webhooks via Svix.  Signatures are verified using the
 * Svix algorithm (HMAC-SHA256 of "${svix-id}.${svix-timestamp}.${body}",
 * signed with the base64-decoded webhook secret).  No extra npm package
 * needed — uses Node's built-in crypto module.
 *
 * ── user.created flow ────────────────────────────────────────────────────
 * 1. Look up pending_tier_assignments for the new user's primary email
 *    where assigned_at IS NULL.
 * 2. If found: set tier in Clerk publicMetadata.
 * 3. If tier3: create a commissioner_groups row in Supabase.
 * 4. Mark the pending row as assigned (assigned_at, assigned_to_user_id).
 */

import { NextResponse }  from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { clerkClient }   from "@clerk/nextjs/server";
import { supabase }      from "@/lib/supabase";
import { ensureReferralCode } from "@/lib/referral";

// ── Svix signature verification ───────────────────────────────────────────

/**
 * Verifies a Svix-signed webhook request without the svix npm package.
 *
 * Svix secret format: "whsec_<base64>"
 * Signed content:     "${svix-id}.${svix-timestamp}.${rawBody}"
 * svix-signature:     space-separated "v1,<base64sig>" entries
 */
function verifySvixSignature(
  rawBody: string,
  svixId:        string,
  svixTimestamp: string,
  svixSignature: string,
  secret:        string,
): boolean {
  try {
    // 1. Reject requests older than 5 minutes (replay protection)
    const ts = parseInt(svixTimestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

    // 2. Decode the webhook secret ("whsec_<base64>" → raw bytes)
    const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");

    // 3. Compute HMAC-SHA256 of the signed content
    const toSign   = `${svixId}.${svixTimestamp}.${rawBody}`;
    const computed = createHmac("sha256", secretBytes)
      .update(toSign, "utf8")
      .digest("base64");

    // 4. Compare against every signature in the header (Svix may rotate keys)
    const signatures = svixSignature.split(" ").map((s) => s.replace(/^v\d+,/, ""));
    return signatures.some((sig) => {
      const a = Buffer.from(computed);
      const b = Buffer.from(sig);
      if (a.length !== b.length) return false;
      try { return timingSafeEqual(a, b); } catch { return false; }
    });
  } catch {
    return false;
  }
}

// ── Clerk event types (minimal) ───────────────────────────────────────────

interface ClerkEmailAddress {
  id:            string;
  email_address: string;
}

interface ClerkUserCreatedData {
  id:                        string;
  first_name:                string | null;
  username:                  string | null;
  primary_email_address_id:  string;
  email_addresses:           ClerkEmailAddress[];
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserCreatedData;
}

// ── POST handler ──────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // ── 1. Read raw body ──────────────────────────────────────────────────
  const rawBody = await request.text();

  // ── 2. Verify signature ───────────────────────────────────────────────
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[clerk webhook] CLERK_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const svixId        = request.headers.get("svix-id")        ?? "";
  const svixTimestamp = request.headers.get("svix-timestamp")  ?? "";
  const svixSignature = request.headers.get("svix-signature")  ?? "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing Svix headers" }, { status: 400 });
  }

  if (!verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature, webhookSecret)) {
    console.warn("[clerk webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 3. Parse payload ──────────────────────────────────────────────────
  let event: ClerkWebhookEvent;
  try {
    event = JSON.parse(rawBody) as ClerkWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── 4. Only handle user.created ───────────────────────────────────────
  if (event.type !== "user.created") {
    return NextResponse.json({ received: true, note: `Ignored event: ${event.type}` });
  }

  const userData = event.data;
  const userId   = userData.id;

  // Resolve the primary email address
  const primaryEmail = userData.email_addresses.find(
    (e) => e.id === userData.primary_email_address_id,
  )?.email_address ?? userData.email_addresses[0]?.email_address ?? "";

  if (!userId || !primaryEmail) {
    console.warn("[clerk webhook] user.created event missing id or email");
    return NextResponse.json({ received: true });
  }

  const email = primaryEmail.trim().toLowerCase();

  // ── 5. Check for a pending tier assignment ────────────────────────────
  const { data: pending, error: queryErr } = await supabase
    .from("pending_tier_assignments")
    .select("id, tier, plan")
    .eq("email", email)
    .is("assigned_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (queryErr) {
    console.error("[clerk webhook] Failed to query pending_tier_assignments:", queryErr.message);
    // Return 200 so Clerk doesn't retry — this would be a Supabase issue
    return NextResponse.json({ received: true });
  }

  if (!pending) {
    // No pending assignment — user is free tier, nothing to do
    console.log(`[clerk webhook] No pending assignment for ${email}`);
    return NextResponse.json({ received: true });
  }

  const { id: pendingId, tier } = pending;

  // ── 6. Assign tier in Clerk publicMetadata ────────────────────────────
  const clerk = await clerkClient();

  try {
    await clerk.users.updateUser(userId, {
      publicMetadata: { tier },
    });
    console.log(`[clerk webhook] Assigned tier=${tier} to new user ${userId} (${email})`);
  } catch (err) {
    console.error("[clerk webhook] Failed to update Clerk metadata:", err);
    return NextResponse.json({ received: true });
  }

  // ── 7. Generate referral code ─────────────────────────────────────────
  const displayName =
    userData.first_name ??
    userData.username ??
    email.split("@")[0];

  await ensureReferralCode(userId, displayName);

  // ── 8. Commissioner: create commissioner_groups row ───────────────────
  if (tier === "tier3") {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const { error: upsertErr } = await supabase
      .from("commissioner_groups")
      .upsert(
        {
          commissioner_user_id: userId,
          expires_at:           expiresAt.toISOString(),
          grace_until:          null,
        },
        { onConflict: "commissioner_user_id" },
      );

    if (upsertErr) {
      console.error("[clerk webhook] Failed to create commissioner_groups:", upsertErr.message);
      // Tier was already set in Clerk — log and continue
    } else {
      console.log(`[clerk webhook] Created commissioner_groups for ${userId}`);
    }
  }

  // ── 9. Mark pending row as assigned ───────────────────────────────────
  const { error: updateErr } = await supabase
    .from("pending_tier_assignments")
    .update({
      assigned_at:          new Date().toISOString(),
      assigned_to_user_id:  userId,
    })
    .eq("id", pendingId);

  if (updateErr) {
    console.error("[clerk webhook] Failed to mark pending_tier_assignments row as assigned:", updateErr.message);
  }

  return NextResponse.json({ received: true });
}
