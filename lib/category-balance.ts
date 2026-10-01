/**
 * Draft Mode category balance — categories leagues only.
 *
 * For every category a league counts, compare what MY drafted roster has
 * banked against what an average team in this league should have, so a
 * drafter can see which categories they are ahead or behind in while the
 * draft is running.
 *
 * Definitions:
 * - target: the full-roster expectation for one team — the draftable
 *   starter pool's league-wide total for that stat divided by the number
 *   of teams (rate stats use the pool mean instead of a sum).
 * - expectedNow: the target scaled to how many roster spots I have filled
 *   so far, so early picks aren't all "behind".
 * - mine: my drafted players' combined stat (rate stats: simple average).
 *
 * Pure functions only; no React, no fetching. Shared by the NHL Rankings
 * tab today; the same shape works for MLB when Draft Mode ships there.
 */

import type { DbPlayer } from "./nhl-valuation";
import type {
  SkaterStatKey,
  GoalieStatKey,
  CategoryConfig,
  Roster,
  RosterKey,
} from "./types";

export type BalanceStatus = "ahead" | "on-pace" | "behind";

export type CategoryBalanceRow = {
  key: string;
  label: string;
  isGoalie: boolean;
  direction: "more" | "less";
  /** True for per-game/ratio stats (SV%, GAA, ATOI): compared as averages. */
  isRate: boolean;
  mine: number;
  expectedNow: number;
  target: number;
  status: BalanceStatus;
};

// Ratio/per-game stats: totals don't accumulate, so mine/target are averages.
const RATE_KEYS = new Set<string>(["SV%", "GAA", "ATOI"]);

const LABELS: Record<string, string> = { PM: "+/-", "SV%": "SV%" };
export function categoryLabel(key: string): string {
  return LABELS[key] ?? key;
}

// Ahead/behind thresholds on the direction-adjusted ratio.
const AHEAD = 1.05;
const BEHIND = 0.9;

function statusFor(mine: number, expected: number, direction: "more" | "less", isRate: boolean): BalanceStatus {
  if (expected === 0 && mine === 0) return "on-pace";
  // Direction-adjusted ratio: >1 is good in both directions.
  const ratio = direction === "less"
    ? (mine === 0 ? (isRate ? 1 : AHEAD) : expected / mine)
    : (expected === 0 ? AHEAD : mine / expected);
  if (ratio >= AHEAD) return "ahead";
  if (ratio < BEHIND) return "behind";
  return "on-pace";
}

/** Starter counts for scaling: skater slots vs goalie slots (bench excluded). */
export function starterCounts(roster: Roster): { skaters: number; goalies: number } {
  const s = (k: RosterKey) => roster[k] || 0;
  return {
    skaters: s("C") + s("LW") + s("RW") + s("W") + s("F") + s("D") + s("U"),
    goalies: s("G"),
  };
}

/**
 * Compute one balance row per active category.
 *
 * @param rankedPlayers players in descending value order (the rankings
 *   list) — the benchmark pool is the top teams×starters of each kind.
 * @param minePlayers   players checked "Mine".
 *   Both must carry stats in the ACTIVE data mode's basis (per-82
 *   normalization already applied in Avg modes), so mine and target are
 *   always measured on the same scale.
 */
export function computeCategoryBalance(args: {
  rankedPlayers: DbPlayer[];
  minePlayers: DbPlayer[];
  teams: number;
  roster: Roster;
  skaterCategories: Record<SkaterStatKey, CategoryConfig | null>;
  goalieCategories: Record<GoalieStatKey, CategoryConfig | null>;
}): CategoryBalanceRow[] {
  const { rankedPlayers, minePlayers, teams, roster, skaterCategories, goalieCategories } = args;
  const starters = starterCounts(roster);

  // Benchmark pools: the players a 100%-efficient league would roster.
  const poolSkaters: DbPlayer[] = [];
  const poolGoalies: DbPlayer[] = [];
  for (const p of rankedPlayers) {
    if (p.isGoalie) {
      if (poolGoalies.length < teams * starters.goalies) poolGoalies.push(p);
    } else if (poolSkaters.length < teams * starters.skaters) {
      poolSkaters.push(p);
    }
    if (
      poolSkaters.length >= teams * starters.skaters &&
      poolGoalies.length >= teams * starters.goalies
    ) break;
  }

  const mineSkaters = minePlayers.filter((p) => !p.isGoalie);
  const mineGoalies = minePlayers.filter((p) => p.isGoalie);

  const sum = (players: DbPlayer[], key: string) =>
    players.reduce((a, p) => a + (p.stats[key as SkaterStatKey | GoalieStatKey] || 0), 0);
  const avg = (players: DbPlayer[], key: string) =>
    players.length === 0 ? 0 : sum(players, key) / players.length;

  const rows: CategoryBalanceRow[] = [];

  const push = (
    key: string,
    direction: "more" | "less",
    isGoalie: boolean,
    pool: DbPlayer[],
    mine: DbPlayer[],
    mineStarterCap: number
  ) => {
    const isRate = RATE_KEYS.has(key);
    let target: number;
    let expectedNow: number;
    let mineVal: number;
    if (isRate) {
      target = avg(pool, key);
      expectedNow = target; // a ratio doesn't scale with roster fill
      mineVal = avg(mine, key);
    } else {
      target = teams === 0 ? 0 : sum(pool, key) / teams;
      const filled = Math.min(mine.length, mineStarterCap);
      expectedNow = mineStarterCap === 0 ? 0 : target * (filled / mineStarterCap);
      mineVal = sum(mine, key);
    }
    rows.push({
      key,
      label: categoryLabel(key),
      isGoalie,
      direction,
      isRate,
      mine: mineVal,
      expectedNow,
      target,
      // Rate stats with nothing drafted yet have no meaningful comparison.
      status: isRate && mine.length === 0 ? "on-pace" : statusFor(mineVal, expectedNow, direction, isRate),
    });
  };

  for (const [key, cfg] of Object.entries(skaterCategories)) {
    if (!cfg) continue;
    push(key, cfg.direction, false, poolSkaters, mineSkaters, starters.skaters);
  }
  for (const [key, cfg] of Object.entries(goalieCategories)) {
    if (!cfg) continue;
    push(key, cfg.direction, true, poolGoalies, mineGoalies, starters.goalies);
  }
  return rows;
}
