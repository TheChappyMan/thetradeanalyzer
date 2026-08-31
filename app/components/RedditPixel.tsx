"use client";

/**
 * RedditPixel
 *
 * Loads the Reddit Pixel and handles:
 *  - base init + initial PageVisit (inline snippet)
 *  - advanced matching re-init once the Clerk user resolves (email + externalId)
 *  - SPA PageVisit on every client-side route change (skips the initial load,
 *    which the base snippet already tracks)
 *  - SignUp conversion for freshly created accounts (createdAt < 10 min),
 *    deduped per user via localStorage so it never refires on sign-in
 *
 * Purchase conversions fire from /payment-success alongside the GA4 purchase
 * event, sharing its order_id sessionStorage dedupe.
 *
 * useSearchParams requires a Suspense boundary in the App Router, so the
 * default export wraps the real component in one.
 */

import { Suspense, useEffect, useRef } from "react";
import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";

const PIXEL_ID = "a2_j1ilahr3n3z2";

/** Call fn now if rdt is ready, otherwise retry every 200 ms for ~5 s. */
function whenRdtReady(fn: () => void) {
  let attempts = 0;
  const tick = () => {
    if (typeof window.rdt === "function") {
      fn();
      return;
    }
    if (attempts++ < 25) setTimeout(tick, 200);
  };
  tick();
}

function RedditPixelInner() {
  const { user, isLoaded } = useUser();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const firstRender = useRef(true);
  const matchedRef = useRef(false);

  // ── Advanced matching: re-init with email + externalId once signed in ──
  useEffect(() => {
    if (!isLoaded || !user || matchedRef.current) return;
    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) return;
    matchedRef.current = true;
    const userId = user.id;
    whenRdtReady(() => {
      window.rdt("init", PIXEL_ID, { email, externalId: userId });
    });
  }, [isLoaded, user]);

  // ── SignUp conversion: fresh accounts only, once per user ──────────────
  useEffect(() => {
    if (!isLoaded || !user) return;
    const created = user.createdAt ? new Date(user.createdAt).getTime() : 0;
    if (!created || Date.now() - created > 10 * 60 * 1000) return;
    const key = `rdt-signup-${user.id}`;
    const userId = user.id;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      return; // no storage → can't dedupe, skip rather than risk refiring
    }
    whenRdtReady(() => {
      // conversionId = Clerk user ID: one account = one signup, so Reddit
      // dedupes even if this somehow fires twice for the same account.
      window.rdt("track", "SignUp", { conversionId: userId });
    });
  }, [isLoaded, user]);

  // ── SPA page tracking: fire on route changes, skip the initial load ────
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (typeof window.rdt === "function") {
      window.rdt("track", "PageVisit");
    }
  }, [pathname, searchParams]);

  return (
    <Script id="reddit-pixel-init" strategy="afterInteractive">
      {`
        !function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js?pixel_id=${PIXEL_ID}",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);
        rdt('init','${PIXEL_ID}');
        rdt('track','PageVisit');
      `}
    </Script>
  );
}

export default function RedditPixel() {
  return (
    <Suspense fallback={null}>
      <RedditPixelInner />
    </Suspense>
  );
}
