"use client";

import FairnessScale from "./FairnessScale";

/**
 * TradeSummaryCard — the shareable, screenshot-first summary of a trade.
 *
 * Purely presentational: the page computes every value with the same engine
 * math it uses for the Fairness Result, then hands the rows in here. Nothing
 * inside is interactive (no buttons, inputs, or remove icons) so a single
 * phone screenshot captures a finished-looking card.
 *
 * Sizing target: one iPhone screenshot at 390px wide, no scrolling, for up
 * to 4 assets per side. Above that the rows tighten (compact mode) so larger
 * trades still fit as many rows as possible; rows are never clipped.
 */

export type SummaryAsset = {
  key: string;
  /** Player name, or "Pick 2.10" for draft picks. */
  name: string;
  /** Secondary line: "TOR · C" for players, "2027 draft pick" for picks. */
  sub?: string;
  /** Adjusted (trade) value — after replacement, scarcity, keeper, injury. */
  value: number;
  /** Short text badges: "IR", "Keeper", "Elite RB", etc. */
  badges?: string[];
};

export type TradeSummaryCardProps = {
  sport: "nhl" | "nfl" | "mlb";
  /** Saved league name; null when unnamed. Ignored when `defaultSettings`. */
  leagueName: string | null;
  /** Free tier: show "Default settings" in place of a league name. */
  defaultSettings: boolean;
  teams: number;
  /** "Categories" | "Points" | "Roto 5x5" | "Half PPR" ... */
  scoringLabel: string;
  /** "Redraft" | "Keeper" */
  leagueTypeLabel: string;
  /** "Last Year – Total" ... */
  dataModeLabel: string;
  give: SummaryAsset[];
  get: SummaryAsset[];
  giveTotal: number;
  getTotal: number;
  /** Decimal places for values (categories/roto use 2, points use 1). */
  decimals: 1 | 2;
  /** Trade Rating, 0–100. */
  tradeRating: number;
  /** Fairness-scale marker position, 0–100 (50 = even, >50 = you win). */
  displayScore: number;
  /** Plain-language verdict sentence. */
  verdictText: string;
};

const SPORT_LABEL: Record<TradeSummaryCardProps["sport"], string> = {
  nhl: "NHL",
  nfl: "NFL",
  mlb: "MLB",
};

/** Semantic verdict zone from the fairness-scale position. */
function verdictZone(ds: number): { label: string; color: string } {
  // Mirrors the scale's zone boundaries: 19% fair band in the middle, then
  // 10% mild bands either side, everything beyond is clearly lopsided.
  if (ds >= 40.5 && ds <= 60.4) return { label: "Fair",     color: "var(--color-success)" };
  if (ds >= 30.5 && ds <= 70.4) return { label: "Uneven",   color: "var(--color-warning)" };
  return                               { label: "Lopsided", color: "var(--color-danger)"  };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Column({
  title, assets, total, decimals, compact,
}: {
  title: string;
  assets: SummaryAsset[];
  total: number;
  decimals: 1 | 2;
  compact: boolean;
}) {
  const rowPad  = compact ? "py-0.5" : "py-1";
  const nameCls = compact ? "text-[11px]" : "text-xs";
  const subCls  = compact ? "text-[9px]"  : "text-[10px]";
  return (
    <div className="min-w-0 flex flex-col">
      <div
        className="text-[10px] font-semibold uppercase tracking-wide pb-1 mb-1 border-b"
        style={{ color: "var(--color-muted)", borderColor: "var(--color-border)" }}
      >
        {title}
      </div>
      <div className="flex-1">
        {assets.map((a) => (
          <div key={a.key} className={`flex items-start justify-between gap-2 ${rowPad}`}>
            <div className="min-w-0 flex-1">
              <div className={`${nameCls} font-semibold truncate`} style={{ color: "var(--color-text)" }}>
                {a.name}
              </div>
              {(a.sub || (a.badges && a.badges.length > 0)) && (
                // Team/position truncates; badges wrap onto a new line rather
                // than being clipped, so no badge is ever lost in a screenshot.
                <div
                  className={`${subCls} flex flex-wrap items-center gap-x-1 gap-y-0.5 leading-tight`}
                  style={{ color: "var(--color-muted)" }}
                >
                  {a.sub && <span className="truncate max-w-full">{a.sub}</span>}
                  {a.badges?.map((b) => (
                    <span
                      key={b}
                      className="inline-block rounded px-1 font-semibold uppercase tracking-wide whitespace-nowrap"
                      style={{
                        fontSize: compact ? "8px" : "9px",
                        lineHeight: "1.4",
                        background: "var(--color-primary-subtle)",
                        color: "var(--color-primary)",
                      }}
                    >
                      {b}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div
              className={`${nameCls} font-semibold tabular-nums shrink-0`}
              style={{ color: "var(--color-text)" }}
            >
              {a.value.toFixed(decimals)}
            </div>
          </div>
        ))}
      </div>
      <div
        className="flex items-center justify-between gap-2 pt-1 mt-1 border-t"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
          Total
        </span>
        <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--color-primary)" }}>
          {total.toFixed(decimals)}
        </span>
      </div>
    </div>
  );
}

export default function TradeSummaryCard(props: TradeSummaryCardProps) {
  const {
    sport, leagueName, defaultSettings, teams, scoringLabel, leagueTypeLabel, dataModeLabel,
    give, get, giveTotal, getTotal, decimals, tradeRating, displayScore, verdictText,
  } = props;

  const compact = Math.max(give.length, get.length) > 4;
  const zone    = verdictZone(displayScore);
  const safePos = Number.isFinite(displayScore) ? displayScore : 50;

  const contextParts = [
    defaultSettings ? "Default settings" : (leagueName?.trim() || null),
    `${teams}-team`,
    scoringLabel,
    leagueTypeLabel,
  ].filter((p): p is string => !!p);

  return (
    <div
      data-trade-summary
      className="mx-auto w-full rounded-2xl border p-4 select-none"
      style={{
        maxWidth: 420,
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
        fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)",
      }}
    >
      {/* Header: wordmark left, sport right */}
      <div className="flex items-center justify-between gap-3">
        <div
          className="text-base font-semibold lowercase leading-none"
          style={{ color: "var(--color-primary)", letterSpacing: "-0.02em" }}
        >
          thetradeanalyzer
        </div>
        <div
          className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide"
          style={{ background: "var(--color-primary-subtle)", color: "var(--color-primary)" }}
        >
          {SPORT_LABEL[sport]}
        </div>
      </div>

      {/* Context line */}
      <div className="mt-1.5 text-[11px] leading-snug" style={{ color: "var(--color-muted)" }}>
        <div className="truncate">{contextParts.join(" · ")}</div>
        <div className="truncate">{dataModeLabel}</div>
      </div>

      {/* Two columns, always side by side */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Column title="You Give" assets={give} total={giveTotal} decimals={decimals} compact={compact} />
        <Column title="You Get"  assets={get}  total={getTotal}  decimals={decimals} compact={compact} />
      </div>

      {/* Verdict */}
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-muted)" }}>
            Trade Rating
          </div>
          <div className="text-sm font-semibold tabular-nums" style={{ color: "var(--color-text)" }}>
            {tradeRating.toFixed(1)}
            <span className="font-normal" style={{ color: "var(--color-muted)" }}> / 100</span>
          </div>
        </div>
        <FairnessScale displayScore={safePos} showLabels={false} compact />
        <div className="flex justify-between text-[9px] -mt-0.5" style={{ color: "var(--color-muted)" }}>
          <span>Opponent wins</span>
          <span>You win</span>
        </div>
        <div className="mt-1.5 flex items-start gap-1.5">
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{ border: `1px solid ${zone.color}`, color: zone.color }}
          >
            {zone.label}
          </span>
          <span className="text-xs font-semibold leading-snug" style={{ color: zone.color }}>
            {verdictText}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div
        className="mt-3 pt-2 border-t text-[9px] flex justify-between gap-2"
        style={{ color: "var(--color-muted)", borderColor: "var(--color-border)" }}
      >
        <span>Analyzed at thetradeanalyzer.com</span>
        <span className="tabular-nums">{formatDate(new Date())}</span>
      </div>
    </div>
  );
}
