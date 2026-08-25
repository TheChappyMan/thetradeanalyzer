/**
 * NHL valuation engine — extracted from app/nhl/page.tsx so other pages
 * (e.g. /rankings) can rank players with the exact same math the trade
 * analyzer uses. Pure functions only; no React, no fetching.
 */

import type {
  SkaterStatKey,
  GoalieStatKey,
  SkaterWeights,
  GoalieWeights,
  CategoryConfig,
  Roster,
  RosterKey,
  PositionBonuses,
} from "./types";

// ============================================================
// PLAYER DATABASE
// ============================================================

export type PlayerStats = Partial<Record<SkaterStatKey | GoalieStatKey, number>>;

export type DbPlayer = {
  id: number;
  name: string;
  team: string;
  position: string;
  isGoalie: boolean;
  gamesPlayed: number;
  stats: PlayerStats;
};

export function asNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
export function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// The NHL stats API reports wings as single-letter codes ("L"/"R").
// Everything downstream (POSITION_SLOT_MAP, the eligible-position
// checkboxes, the auto-W fallback) expects "LW"/"RW".
export function normalizePositionCode(code: string): string {
  if (code === "L") return "LW";
  if (code === "R") return "RW";
  return code;
}

export function buildPlayerDatabase(args: {
  summary: Record<string, unknown>[];
  realtime: Record<string, unknown>[];
  faceoffs: Record<string, unknown>[];
  goalies: Record<string, unknown>[];
}): DbPlayer[] {
  const db = new Map<number, DbPlayer>();

  args.summary.forEach((s) => {
    const id = asNumber(s.playerId);
    if (!id) return;
    const ppPoints = asNumber(s.ppPoints);
    const ppGoals = asNumber(s.ppGoals);
    const shPoints = asNumber(s.shPoints);
    const shGoals = asNumber(s.shGoals);
    db.set(id, {
      id,
      name: asString(s.skaterFullName),
      team: asString(s.teamAbbrevs),
      position: normalizePositionCode(asString(s.positionCode)),
      isGoalie: false,
      gamesPlayed: asNumber(s.gamesPlayed),
      stats: {
        G: asNumber(s.goals),
        A: asNumber(s.assists),
        P: asNumber(s.points),
        PM: asNumber(s.plusMinus),
        PIM: asNumber(s.penaltyMinutes),
        PPG: ppGoals,
        PPA: ppPoints - ppGoals,
        PPP: ppPoints,
        SHG: shGoals,
        SHA: shPoints - shGoals,
        SHP: shPoints,
        STP: ppPoints + shPoints,
        GWG: asNumber(s.gameWinningGoals),
        SOG: asNumber(s.shots),
        TOI: asNumber(s.timeOnIce),
        ATOI: asNumber(s.timeOnIcePerGame),
      },
    });
  });

  args.realtime.forEach((r) => {
    const id = asNumber(r.playerId);
    const p = db.get(id);
    if (!p) return;
    p.stats.HIT = asNumber(r.hits);
    p.stats.BLK = asNumber(r.blockedShots);
  });

  args.faceoffs.forEach((f) => {
    const id = asNumber(f.playerId);
    const p = db.get(id);
    if (!p) return;
    p.stats.FW = asNumber(f.totalFaceoffWins);
    p.stats.FL = asNumber(f.totalFaceoffLosses);
  });

  args.goalies.forEach((g) => {
    const id = asNumber(g.playerId);
    if (!id) return;
    db.set(id, {
      id,
      name: asString(g.goalieFullName),
      team: asString(g.teamAbbrevs),
      position: "G",
      isGoalie: true,
      gamesPlayed: asNumber(g.gamesPlayed),
      stats: {
        W: asNumber(g.wins),
        L: asNumber(g.losses),
        OTL: asNumber(g.otLosses),
        SO: asNumber(g.shutouts),
        SV: asNumber(g.saves),
        GA: asNumber(g.goalsAgainst),
        GAA: asNumber(g.goalsAgainstAverage),
        "SV%": asNumber(g.savePercentage),
      },
    });
  });

  return Array.from(db.values());
}

// ============================================================
// SEASON NORMALIZATION
// ============================================================

// Rate stats are already per-game; all other stats are counting totals.
export const RATE_STAT_KEYS = new Set<string>(["ATOI", "GAA", "SV%"]);

/** Return a copy of `player` with all counting stats scaled to an 82-game pace. */
export function normalizePlayerTo82(player: DbPlayer): DbPlayer {
  if (player.gamesPlayed === 0) return player;
  const gp = player.gamesPlayed;
  const normalizedStats: PlayerStats = {};
  for (const [key, val] of Object.entries(player.stats) as [string, number | undefined][]) {
    if (val === undefined) continue;
    (normalizedStats as Record<string, number>)[key] = RATE_STAT_KEYS.has(key)
      ? val
      : (val / gp) * 82;
  }
  return { ...player, gamesPlayed: 82, stats: normalizedStats };
}

// ============================================================
// VALUATION — points mode
// ============================================================

export function projectedSeasonValue(
  player: DbPlayer,
  skaterWeights: SkaterWeights,
  goalieWeights: GoalieWeights,
  useRates: boolean = true,
  positionBonuses?: PositionBonuses
): number {
  const gp = player.gamesPlayed;
  if (gp === 0) return 0;
  const weights: Record<string, number> = player.isGoalie ? goalieWeights : skaterWeights;

  // Positional bonus points (points leagues): extra weight on G/A/P for the
  // player's position group. Defensemen use `defenders`; C/LW/RW use `forwards`.
  const bonus = !player.isGoalie && positionBonuses
    ? (player.position === "D" ? positionBonuses.defenders : positionBonuses.forwards)
    : null;
  const bonusFor = (stat: string): number =>
    bonus && (stat === "G" || stat === "A" || stat === "P") ? (bonus[stat as "G" | "A" | "P"] || 0) : 0;

  if (!useRates) {
    let total = 0;
    Object.keys(weights).forEach((stat) => {
      const weight = (weights[stat] || 0) + bonusFor(stat);
      const value = player.stats[stat as SkaterStatKey | GoalieStatKey] || 0;
      total += value * weight;
    });
    return total;
  }
  let perGame = 0;
  Object.keys(weights).forEach((stat) => {
    const weight = (weights[stat] || 0) + bonusFor(stat);
    const value = player.stats[stat as SkaterStatKey | GoalieStatKey] || 0;
    const isRateStat = stat === "ATOI" || stat === "GAA" || stat === "SV%";
    const rate = isRateStat ? value : value / gp;
    perGame += rate * weight;
  });
  return perGame * 82;
}

// ============================================================
// CATEGORIES VALUATION — z-score mode
// ============================================================

export type StatPoolStats = { mean: number; stddev: number; avgVolume?: number };
export type PoolStats = {
  skaterStats: Record<SkaterStatKey, StatPoolStats>;
  goalieStats: Record<GoalieStatKey, StatPoolStats>;
  /** League-adjusted pool sizes — replacement level is rank N+1 */
  skaterN: number;
  goalieN: number;
  /** Median games played among pool members (thin-sample fallback threshold) */
  skaterMedianGp: number;
  goalieMedianGp: number;
};

export function _median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Stats where we use the raw value directly (already a per-game rate).
export const RATE_SKATER = new Set<SkaterStatKey>(["ATOI"]);
// Goalie stats that are volume-weighted rate stats.
export const VOL_GOALIE = new Set<GoalieStatKey>(["SV%", "GAA"]);

export function _meanStddev(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) || 1 };
}

export function computePoolStats(
  playerDb: DbPlayer[],
  teams: number,
  roster: Roster,
  skaterStats: SkaterStatKey[],
  goalieStats: GoalieStatKey[],
  useRates: boolean
): PoolStats {
  const skaters = playerDb.filter((p) => !p.isGoalie && p.gamesPlayed > 0);
  const goalies = playerDb.filter((p) => p.isGoalie && p.gamesPlayed > 0);

  const skaterSlots = (["C", "LW", "RW", "W", "F", "D", "U"] as RosterKey[])
    .reduce((s, k) => s + (roster[k] || 0), 0);
  const skaterN = Math.max(100, teams * skaterSlots);
  const goalieN = Math.max(30, teams * (roster.G || 0));

  const topSkaters = [...skaters]
    .sort((a, b) => (b.stats.TOI || 0) - (a.stats.TOI || 0))
    .slice(0, skaterN);
  const topGoalies = [...goalies]
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, goalieN);

  const skaterPoolStats = {} as Record<SkaterStatKey, StatPoolStats>;
  for (const stat of skaterStats) {
    const values = topSkaters.map((p) => {
      const raw = p.stats[stat] || 0;
      if (!useRates) return raw;
      return RATE_SKATER.has(stat) ? raw : raw / p.gamesPlayed;
    });
    skaterPoolStats[stat] = _meanStddev(values);
  }

  const goaliePoolStats = {} as Record<GoalieStatKey, StatPoolStats>;
  for (const stat of goalieStats) {
    if (useRates && stat === "SV%") {
      const values = topGoalies.map((p) => p.stats["SV%"] || 0);
      const volumes = topGoalies.map((p) => (p.stats.SV || 0) / p.gamesPlayed);
      const { mean, stddev } = _meanStddev(values);
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
      goaliePoolStats[stat] = { mean, stddev, avgVolume };
    } else if (useRates && stat === "GAA") {
      const values = topGoalies.map((p) => p.stats.GAA || 0);
      const { mean, stddev } = _meanStddev(values);
      const avgVolume = topGoalies.reduce((a, p) => a + p.gamesPlayed, 0) / (topGoalies.length || 1);
      goaliePoolStats[stat] = { mean, stddev, avgVolume };
    } else if (useRates) {
      const values = topGoalies.map((p) => ((p.stats[stat] || 0)) / p.gamesPlayed);
      goaliePoolStats[stat] = _meanStddev(values);
    } else {
      // Total mode: compare raw season totals directly
      const values = topGoalies.map((p) => p.stats[stat] || 0);
      goaliePoolStats[stat] = _meanStddev(values);
    }
  }

  return {
    skaterStats: skaterPoolStats,
    goalieStats: goaliePoolStats,
    skaterN,
    goalieN,
    skaterMedianGp: _median(topSkaters.map((p) => p.gamesPlayed)),
    goalieMedianGp: _median(topGoalies.map((p) => p.gamesPlayed)),
  };
}

export function _skaterZ(player: DbPlayer, stat: SkaterStatKey, ps: StatPoolStats, useRates: boolean): number {
  if (ps.stddev === 0) return 0;
  const raw = player.stats[stat] || 0;
  const value = !useRates ? raw : (RATE_SKATER.has(stat) ? raw : raw / player.gamesPlayed);
  return (value - ps.mean) / ps.stddev;
}

export function _goalieZ(player: DbPlayer, stat: GoalieStatKey, ps: StatPoolStats, useRates: boolean): number {
  if (ps.stddev === 0) return 0;
  const raw = player.stats[stat] || 0;
  if (!useRates) {
    // Total mode: compare raw season totals directly
    return (raw - ps.mean) / ps.stddev;
  }
  if (VOL_GOALIE.has(stat) && ps.avgVolume !== undefined && ps.avgVolume > 0) {
    const vol = stat === "SV%"
      ? (player.stats.SV || 0) / player.gamesPlayed
      : player.gamesPlayed;
    return (raw - ps.mean) * (vol / ps.avgVolume) / ps.stddev;
  }
  return (raw / player.gamesPlayed - ps.mean) / ps.stddev;
}

export function zScoreValue(
  player: DbPlayer,
  skaterCategories: Record<SkaterStatKey, CategoryConfig | null>,
  goalieCategories: Record<GoalieStatKey, CategoryConfig | null>,
  poolStats: PoolStats,
  skaterStats: SkaterStatKey[],
  goalieStats: GoalieStatKey[],
  useRates: boolean
): number {
  if (player.gamesPlayed === 0) return 0;
  let total = 0;
  if (player.isGoalie) {
    for (const stat of goalieStats) {
      const cfg = goalieCategories[stat];
      if (!cfg || !poolStats.goalieStats[stat]) continue;
      const z = _goalieZ(player, stat, poolStats.goalieStats[stat], useRates);
      total += cfg.direction === "less" ? -z : z;
    }
  } else {
    for (const stat of skaterStats) {
      const cfg = skaterCategories[stat];
      if (!cfg || !poolStats.skaterStats[stat]) continue;
      const z = _skaterZ(player, stat, poolStats.skaterStats[stat], useRates);
      total += cfg.direction === "less" ? -z : z;
    }
  }
  return total;
}

// ============================================================
// POSITIONAL REPLACEMENT + SOFT FLOOR
// ============================================================

// ── Below-replacement soft floor ─────────────────────────────
// A hard clamp at 0 makes every below-replacement player at a position
// price identically. Below-replacement values compress into a narrow
// positive band that preserves ordering; continuous at the replacement
// point (diff = 0 → BAND on both branches).
export const BELOW_REPL_BAND = 0.05;
export function softReplacementValue(diff: number): number {
  return diff >= 0 ? diff + BELOW_REPL_BAND : BELOW_REPL_BAND * Math.exp(diff / 2);
}

/**
 * Positional replacement z-levels (C/LW/RW/D/G): the best player at that
 * position outside the number of starters the league must field there.
 * Flex slots are attributed by the same coverage semantics as the slot
 * map: W splits across LW/RW, F across C/LW/RW, U deepens all four
 * skater positions uniformly.
 *
 * `zOf` supplies the z-value per player, so callers can inject the
 * thin-sample fallback (the analyzer does) or use raw entries.
 */
export function computeNhlReplacement(
  playerDb: DbPlayer[],
  teams: number,
  roster: Roster,
  zOf: (p: DbPlayer) => number
): { byPosition: Record<string, number>; required: Record<string, number> } {
  const s = (k: RosterKey) => roster[k] || 0;
  const required: Record<string, number> = {
    C:  Math.round(teams * (s("C")  + s("F") / 3 + s("U") / 4)),
    LW: Math.round(teams * (s("LW") + s("W") / 2 + s("F") / 3 + s("U") / 4)),
    RW: Math.round(teams * (s("RW") + s("W") / 2 + s("F") / 3 + s("U") / 4)),
    D:  Math.round(teams * (s("D")  + s("U") / 4)),
    G:  teams * s("G"),
  };

  const zsByGroup: Record<string, number[]> = {};
  for (const p of playerDb) {
    if (p.gamesPlayed === 0) continue;
    const group = p.isGoalie ? "G" : p.position;   // C | LW | RW | D
    (zsByGroup[group] ??= []).push(zOf(p));
  }

  const byPosition: Record<string, number> = {};
  for (const [group, req] of Object.entries(required)) {
    const zs = (zsByGroup[group] ?? []).sort((a, b) => b - a);
    byPosition[group] = zs.length === 0 ? 0 : zs[Math.min(req, zs.length - 1)] ?? 0;
  }
  return { byPosition, required };
}
