"use client";

/**
 * AccuracyRating
 *
 * 1-10 star rating widget shown at the bottom of each analyzer page.
 * Selecting a rating reveals an optional comments box; submissions go to
 * /api/feedback. One submission per sport is remembered in localStorage so
 * returning visitors see a thank-you line instead of the widget.
 */

import { useEffect, useState } from "react";

const STARS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function AccuracyRating({ sport }: { sport: "nhl" | "nfl" | "mlb" }) {
  const lsKey = `fta-feedback-${sport}`;

  // Read in an effect (not the initializer) to avoid an SSR hydration mismatch.
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(lsKey) === "1") setSubmitted(true); } catch {}
  }, [lsKey]);
  const [rating,   setRating]   = useState<number>(0);
  const [hovered,  setHovered]  = useState<number>(0);
  const [comments, setComments] = useState("");
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  async function handleSubmit() {
    if (rating < 1 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport, rating, comments: comments.trim() || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "Something went wrong — please try again");
        return;
      }
      setSubmitted(true);
      try { localStorage.setItem(lsKey, "1"); } catch {}
    } catch {
      setError("Something went wrong — please try again");
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <div className="card mt-6 text-center text-sm" style={{ color: "var(--color-muted)" }}>
        ✓ Thanks for your feedback!
      </div>
    );
  }

  const active = hovered || rating;

  return (
    <div className="card mt-6">
      <h2 className="font-medium mb-1" style={{ color: "var(--color-text)" }}>
        How accurate do you find this analyzer?
      </h2>
      <p className="text-xs mb-2" style={{ color: "var(--color-muted)" }}>
        1 = way off, 10 = spot on
      </p>

      <div
        className="flex gap-1 flex-wrap"
        onMouseLeave={() => setHovered(0)}
        role="radiogroup"
        aria-label="Accuracy rating from 1 to 10"
      >
        {STARS.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} out of 10`}
            className="text-2xl leading-none transition-transform hover:scale-110"
            style={{ color: n <= active ? "#E9B44C" : "var(--color-border)" }}
            onMouseEnter={() => setHovered(n)}
            onClick={() => setRating(n)}
          >
            ★
          </button>
        ))}
        {rating > 0 && (
          <span className="ml-2 self-center text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            {rating} / 10
          </span>
        )}
      </div>

      {rating > 0 && (
        <div className="mt-3">
          <label className="text-xs" style={{ color: "var(--color-muted)" }}>
            Anything else you&apos;d like us to know? Recommendations welcome. (optional)
          </label>
          <textarea
            className="form-input h-20 text-sm mt-1"
            maxLength={2000}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder="What could we improve?"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              className="btn-secondary text-xs"
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy ? "Submitting…" : "Submit Feedback"}
            </button>
            {error && (
              <span className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
