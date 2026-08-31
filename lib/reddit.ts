/**
 * Reddit Pixel event helpers shared by the analyzer pages.
 * The pixel itself is loaded by app/components/RedditPixel.tsx.
 */

/**
 * Fire the TradeAnalyzed custom conversion — call it from the same
 * debounced code path that sends the GA4 trade_analyzed_* event, so a
 * completed analysis fires all pixels together.
 *
 * conversionId is a fresh UUID per call: the caller's debounce guarantees
 * one call per completed analysis (re-renders don't re-run the effect), and
 * a genuinely new analysis should count again, so a new ID each call is the
 * correct dedupe granularity. Trades aren't saved at verdict time (paid
 * auto-save runs on a separate, later debounce), so there is no database ID
 * to use here — the client UUID applies to all tiers, signed-out included.
 */
export function fireRedditTradeAnalyzed(): void {
  if (typeof window === "undefined" || typeof window.rdt !== "function") return;
  const conversionId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `ta-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.rdt("track", "Custom", {
    customEventName: "TradeAnalyzed",
    conversionId,
  });
}
