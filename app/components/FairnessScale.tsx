"use client";

/**
 * FairnessScale — the segmented fairness bar with a position marker.
 *
 * Single shared implementation used by the three trade analyzers' Fairness
 * Result cards and by the shareable Trade Summary card. `displayScore` is the
 * 0–100 ratio-based position (50 = even, >50 = you win). Nothing here is
 * interactive, so the same markup is safe inside a screenshot card.
 */
export default function FairnessScale({
  displayScore,
  showLabels = true,
  compact = false,
}: {
  displayScore: number;
  /** Render the "Opponent Wins / Fairness Scale / You Win" caption row. */
  showLabels?: boolean;
  /** Thinner bar for tight layouts (summary card). */
  compact?: boolean;
}) {
  const pos = Number.isFinite(displayScore) ? Math.max(0, Math.min(100, displayScore)) : 50;
  return (
    <div>
      {showLabels && (
        <div className="relative flex justify-between text-xs mb-1" style={{ color: "var(--color-muted)" }}>
          <span>Opponent Wins</span>
          <span className="absolute left-1/2 -translate-x-1/2 font-medium">Fairness Scale</span>
          <span>You Win</span>
        </div>
      )}
      {/* Segmented bar — all zones always visible, marker moves */}
      <div className={`relative ${compact ? "my-1.5" : "my-2"}`}>
        <div className={`${compact ? "h-4" : "h-6"} rounded-full overflow-hidden flex`}>
          {/* Each width = segment range / 100 * 100% */}
          <div style={{ width: "10.5%", background: "var(--bar-extreme)" }} />
          <div style={{ width: "10%",   background: "var(--bar-danger)" }} />
          <div style={{ width: "10%",   background: "var(--bar-warning)" }} />
          <div style={{ width: "10%",   background: "var(--bar-mild)" }} />
          <div style={{ width: "19%",   background: "var(--bar-fair)" }} />
          <div style={{ width: "10%",   background: "var(--bar-mild)" }} />
          <div style={{ width: "10%",   background: "var(--bar-warning)" }} />
          <div style={{ width: "10%",   background: "var(--bar-danger)" }} />
          <div style={{ width: "10.5%", background: "var(--bar-extreme)" }} />
        </div>
        {/* Marker — overhangs the bar top and bottom so it stands out */}
        <div
          className="absolute -top-1.5 -bottom-1.5 w-1.5 -translate-x-1/2 rounded-full pointer-events-none"
          style={{
            left: `${pos}%`,
            background: "#fff",
            boxShadow: "0 0 0 1.5px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.45)",
          }}
        />
      </div>
    </div>
  );
}
