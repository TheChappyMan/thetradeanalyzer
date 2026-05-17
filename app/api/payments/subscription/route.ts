/**
 * POST /api/payments/subscription
 *
 * Stripe webhook handler.
 *
 * ── Webhook configuration (Stripe Dashboard) ─────────────────────────────
 * Developers → Webhooks → Add endpoint:
 *   URL:    https://app.thetradeanalyzer.com/api/payments/subscription
 *   Events: checkout.session.completed
 *           customer.subscription.deleted
 *           invoice.payment_failed
 *
 * ── Verification ──────────────────────────────────────────────────────────
 * Stripe signs every webhook with the endpoint's signing secret.
 * Verified via stripe.webhooks.constructEvent() using STRIPE_WEBHOOK_SECRET.
 *
 * ── checkout.session.completed ────────────────────────────────────────────
 * Fired when a Stripe Checkout / Payment Link session completes.
 * The price ID is read from line_items and mapped to a tier.
 *   • If a Clerk user exists   → tier assigned immediately
 *   • If no Clerk user yet     → row written to pending_tier_assignments;
 *                                 the Clerk user.created webhook picks it up
 * For tier3: commissioner_groups row is created/refreshed.
 * For annual plans: if session.metadata.referral_code is present, a
 * referral_payouts row is recorded.
 *
 * ── customer.subscription.deleted ─────────────────────────────────────────
 * Fired when a subscription is cancelled and the billing period ends.
 *   tier1 / tier2 → set tier: "free" immediately
 *   tier3         → set grace_until = now + 7 days (graceful removal)
 *
 * ── invoice.payment_failed ────────────────────────────────────────────────
 * Logged only. Access is NOT removed on first failure — Stripe retries
 * automatically. Remove access only on subscription.deleted.
 *
 * ── Tier mapping ──────────────────────────────────────────────────────────
 *   Pro Monthly       price_1TXSbzA9L1H9GntT2qHPLFAk → tier1
 *   Pro Annual        price_1TYBclA9L1H9GntTzOkxpBcu → tier1
 *   Pro Plus Monthly  price_1TYBdsA9L1H9GntTjZy0KCVC → tier2
 *   Pro Plus Annual   price_1TYBjaA9L1H9GntTBHoiFimQ → tier2
 *   Commissioner Ann. price_1TYBeSA9L1H9GntTbpxNWPRT → tier3
 */

import { NextResponse }  from "next/server";
import Stripe            from "stripe";
import { clerkClient }   from "@clerk/nextjs/server";
import { supabase }      from "@/lib/supabase";
import {
  ensureReferralCode,
  getReferralByCode,
  recordReferralPayout,
  REFERRAL_PAYOUT,
} from "@/lib/referral";

// ── Stripe client ──────────────────────────────────────────────────────────

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

// ── Price ID → tier mapping ────────────────────────────────────────────────

const PRICE_TIER: Record<string, string> = {
  "price_1TXSbzA9L1H9GntT2qHPLFAk": "tier1",  // Pro Monthly
  "price_1TYBclA9L1H9GntTzOkxpBcu": "tier1",  // Pro Annual
  "price_1TYBdsA9L1H9GntTjZy0KCVC": "tier2",  // Pro Plus Monthly
  "price_1TYBjaA9L1H9GntTBHoiFimQ": "tier2",  // Pro Plus Annual
  "price_1TYBeSA9L1H9GntTbpxNWPRT": "tier3",  // Commissioner Annual
};

// ── Price ID → internal plan name (used as REFERRAL_PAYOUT key) ───────────

const PRICE_PLAN: Record<string, string> = {
  "price_1TXSbzA9L1H9GntT2qHPLFAk": "pro-monthly",
  "price_1TYBclA9L1H9GntTzOkxpBcu": "pro-annual",
  "price_1TYBdsA9L1H9GntTjZy0KCVC": "proplus-monthly",
  "price_1TYBjaA9L1H9GntTBHoiFimQ": "proplus-annual",
  "price_1TYBeSA9L1H9GntTbpxNWPRT": "commissioner",
};

// ── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // 1. Read raw body — must be text to pass to stripe.webhooks.constructEvent
  const rawBody = await request.text();

  // 2. Verify Stripe webhook signature
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const stripeSignature = request.headers.get("stripe-signature") ?? "";

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, stripeSignature, webhookSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[stripe webhook] Signature verification failed: ${msg}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  console.log(`[stripe webhook] Received: ${event.type} (${event.id})`);

  // 3. Route by event type
  if (event.type === "checkout.session.completed") {
    await handleCheckoutSessionCompleted(event);

  } else if (event.type === "customer.subscription.deleted") {
    await handleSubscriptionDeleted(event);

  } else if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as Stripe.Invoice;
    const subId   = invoice.parent?.subscription_details?.subscription ?? "unknown";
    console.warn(
      `[stripe webhook] Payment failed — ` +
      `customer=${invoice.customer} subscription=${subId} ` +
      `attempt=${invoice.attempt_count ?? "?"}`
    );
    // Do not remove access — Stripe retries automatically.
    // Access is removed only on customer.subscription.deleted.

  } else {
    console.log(`[stripe webhook] Unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}

// ── checkout.session.completed ─────────────────────────────────────────────

async function handleCheckoutSessionCompleted(event: Stripe.Event) {
  // Expand line_items to get the price ID (not included in the raw webhook payload)
  const rawSession = event.data.object as Stripe.Checkout.Session;
  const session = await stripe.checkout.sessions.retrieve(rawSession.id, {
    expand: ["line_items"],
  });

  const customerEmail = (
    session.customer_details?.email ?? session.customer_email ?? ""
  ).trim().toLowerCase();

  if (!customerEmail) {
    console.warn("[stripe webhook] checkout.session.completed — no customer email");
    return;
  }

  const priceId  = session.line_items?.data[0]?.price?.id ?? "";
  const tier     = PRICE_TIER[priceId];
  const planCode = PRICE_PLAN[priceId];

  if (!tier || !planCode) {
    console.warn(`[stripe webhook] checkout.session.completed — unknown price ID: "${priceId}"`);
    return;
  }

  const referralCode = (session.metadata?.referral_code ?? "").trim();

  // ── Look up Clerk user ────────────────────────────────────────────────────
  const clerk = await clerkClient();
  const { data: userList } = await clerk.users.getUserList({ emailAddress: [customerEmail] });
  const clerkUser = userList?.[0];

  if (!clerkUser) {
    // No Clerk account yet — store pending assignment.
    // The Clerk user.created webhook will assign the tier on sign-up.
    const { error: insertErr } = await supabase
      .from("pending_tier_assignments")
      .insert({ email: customerEmail, tier, plan: planCode });

    if (insertErr) {
      console.error("[stripe webhook] Failed to insert pending_tier_assignments:", insertErr.message);
    } else {
      console.log(`[stripe webhook] Stored pending tier=${tier} plan=${planCode} for ${customerEmail}`);
    }
    return;
  }

  const userId      = clerkUser.id;
  const displayName = clerkUser.firstName ?? clerkUser.username ?? customerEmail.split("@")[0];

  // ── Assign tier in Clerk publicMetadata ───────────────────────────────────
  await clerk.users.updateUser(userId, {
    publicMetadata: { ...clerkUser.publicMetadata, tier },
  });
  console.log(`[stripe webhook] Set tier=${tier} plan=${planCode} for ${customerEmail} (${userId})`);

  // ── Generate referral code if not already present ─────────────────────────
  await ensureReferralCode(userId, displayName);

  // ── Commissioner: create/refresh commissioner_groups row ──────────────────
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
      console.error("[stripe webhook] Failed to upsert commissioner_groups:", upsertErr.message);
    }
  }

  // ── Referral payout (annual plans only) ───────────────────────────────────
  // Pass referral_code in session.metadata.referral_code to credit the referrer.
  // Only annual plans are eligible: pro-annual ($4), proplus-annual ($9), commissioner ($40).
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
      console.log(`[stripe webhook] Recorded referral payout — code=${referralCode} plan=${planCode}`);
    } else {
      console.warn(`[stripe webhook] Referral code not found: ${referralCode}`);
    }
  }
}

// ── customer.subscription.deleted ─────────────────────────────────────────

async function handleSubscriptionDeleted(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const customerId   = subscription.customer as string;

  // Fetch customer from Stripe to get their email
  let customerEmail = "";
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ((customer as Stripe.DeletedCustomer).deleted) {
      console.warn(`[stripe webhook] subscription.deleted — customer ${customerId} already deleted`);
      return;
    }
    customerEmail = ((customer as Stripe.Customer).email ?? "").trim().toLowerCase();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[stripe webhook] Failed to retrieve customer ${customerId}: ${msg}`);
    return;
  }

  if (!customerEmail) {
    console.warn(`[stripe webhook] subscription.deleted — no email for customer ${customerId}`);
    return;
  }

  const clerk = await clerkClient();
  const { data: userList } = await clerk.users.getUserList({ emailAddress: [customerEmail] });
  const clerkUser = userList?.[0];

  if (!clerkUser) {
    // Remove any unprocessed pending assignment for this email
    await supabase
      .from("pending_tier_assignments")
      .delete()
      .eq("email", customerEmail)
      .is("assigned_at", null);
    console.log(`[stripe webhook] subscription.deleted — removed pending assignment for ${customerEmail}`);
    return;
  }

  const userId      = clerkUser.id;
  const currentTier = (clerkUser.publicMetadata?.tier as string | undefined) ?? "free";

  if (currentTier === "tier3") {
    // Commissioner: 7-day grace period before removal
    const graceUntil = new Date();
    graceUntil.setDate(graceUntil.getDate() + 7);
    const { error: graceErr } = await supabase
      .from("commissioner_groups")
      .update({ grace_until: graceUntil.toISOString() })
      .eq("commissioner_user_id", userId);
    if (graceErr) {
      console.error("[stripe webhook] Failed to set grace_until:", graceErr.message);
    }
    console.log(`[stripe webhook] subscription.deleted — set grace_until for commissioner ${userId}`);
  } else {
    await clerk.users.updateUser(userId, {
      publicMetadata: { ...clerkUser.publicMetadata, tier: "free" },
    });
    console.log(`[stripe webhook] subscription.deleted — downgraded to free for ${customerEmail} (${userId})`);
  }
}
