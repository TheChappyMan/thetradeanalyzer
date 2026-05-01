"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useLeagueContext } from "@/lib/league-context";

/**
 * Fantasy Trade Analyzer – V3 (Next.js 15 / TypeScript)
 *  - NHL API integration (skater summary + realtime + faceoffs + goalie summary)
 *  - Typeahead player search with team/position/GP display
 *  - Real valuation: sum(per-game rate × weight) × position_multiplier × 82
 *  - Loading state & graceful API failure fallback
 */

// ============================================================
// TYPES
// ============================================================

type SkaterStatKey =
  | "G" | "A" | "P" | "PM" | "PIM"
  | "PPG" | "PPA" | "PPP"
  | "SHG" | "SHA" | "SHP"
  | "GWG" | "SOG" | "HIT" | "BLK" | "FW" | "FL"
  | "TOI" | "ATOI";

type GoalieStatKey = "W" | "L" | "OTL" | "SO" | "SV" | "GA" | "GAA" | "SV%";

type SkaterWeights = Record<SkaterStatKey, number>;
type GoalieWeights = Record<GoalieStatKey, number>;

type CategoryConfig = { direction: "more" | "less" };

type RosterKey =
  | "C" | "LW" | "RW" | "W" | "F" | "D" | "U" | "G" | "B" | "IR" | "IRplus";
type Roster = Record<RosterKey, number>;

type League = {
  name: string;
  teams: number;
  leagueType: "redraft" | "keeper";
  keepersPerTeam: number;
  roster: Roster;
  scoringType: "points" | "categories";
  skaterWeights: SkaterWeights;
  goalieWeights: GoalieWeights;
  skaterCategories: Record<SkaterStatKey, CategoryConfig | null>;
  goalieCategories: Record<GoalieStatKey, CategoryConfig | null>;
};

// ============================================================
// PERSISTENCE – localStorage helpers
// ============================================================

const LS_CURRENT = "fta-current-league";
const LS_PROFILES = "fta-saved-profiles";

type SavedProfile = { name: string; savedAt: string; league: League };

function loadCurrentLeague(): League | null {
  try {
    const raw = localStorage.getItem(LS_CURRENT);
    return raw ? (JSON.parse(raw) as League) : null;
  } catch {
    return null;
  }
}

function saveCurrentLeague(league: League) {
  try {
    localStorage.setItem(LS_CURRENT, JSON.stringify(league));
  } catch {}
}

function loadProfiles(): SavedProfile[] {
  try {
    const raw = localStorage.getItem(LS_PROFILES);
    return raw ? (JSON.parse(raw) as SavedProfile[]) : [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: SavedProfile[]) {
  try {
    localStorage.setItem(LS_PROFILES, JSON.stringify(profiles));
  } catch {}
}

const LS_HISTORY = "fta-trade-history";
const MAX_HISTORY = 50;
const LS_DATA_MODE = "fta-data-mode";

type HistoryEntry = {
  id: string;
  savedAt: string;
  leagueName: string;
  sport?: string;
  leagueId?: string;
  sendPlayerNames: string[];
  recvPlayerNames: string[];
  sendPicks: string;
  recvPicks: string;
  sendValue: number;
  recvValue: number;
  score: number;
  verdict: string;
};

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_HISTORY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(LS_HISTORY, JSON.stringify(entries));
  } catch {}
}

type PlayerStats = Partial<Record<SkaterStatKey | GoalieStatKey, number>>;

type DbPlayer = {
  id: number;
  name: string;
  team: string;
  position: string;
  isGoalie: boolean;
  gamesPlayed: number;
  stats: PlayerStats;
};

type TradePlayer = {
  id: number;
  name: string;
  team: string;
  primaryPosition: string;
  positions: string[];
};

type ParsedPick = {
  raw: string;        // original text the user typed
  round: number;
  slot: number;
  year: number | null; // optional year prefix, purely for display
  overall: number;     // (round - 1) * teams + slot
  error: string | null; // populated if parsing failed or pick is invalid
};

type DbStatus = "loading" | "ready" | "error";

type DataMode = "thisTotal" | "thisAvg" | "lastTotal" | "lastAvg";

type LeagueRow = { id: string; name: string; sport: string; settings: unknown };

// ============================================================
// DATA LAYER – NHL API (via server proxy to avoid CORS)
// ============================================================

function asNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function buildPlayerDatabase(args: {
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
      position: asString(s.positionCode),
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
// MATH HELPERS
// ============================================================

function tanh(x: number): number {
  const e1 = Math.exp(x);
  const e2 = Math.exp(-x);
  return (e1 - e2) / (e1 + e2);
}

function fairnessScore(give: number, get: number): number {
  const TAU = 0.65;
  const total = give + get;
  if (total === 0) return 50;
  const pctDiff = (get - give) / total;
  const raw = 50 + 50 * tanh(pctDiff / TAU);
  return Math.max(0, Math.min(100, raw));
}

function fairnessDescription(score: number): string {
  if (score <= 10.4) return "You're getting robbed.";
  if (score <= 20.4) return "Not quite a robbery, but you're giving a lot away.";
  if (score <= 30.4) return "It's close, but you lose value.";
  if (score <= 40.4) return "You lose, but only by a bit.";
  if (score <= 60.4) return "This is in the realm of fairness.";
  if (score <= 70.4) return "You win this trade.";
  if (score <= 80.4) return "Big win for you.";
  if (score <= 90.4) return "They shouldn't accept this trade, but if they do, good for you.";
  return "We won't tell, but if they accept this, it's probably collusion.";
}

// ============================================================
// POSITION FLEX MULTIPLIER (Model 3)
// ============================================================

const POSITION_SLOT_MAP: Record<string, string[]> = {
  C:  ["C", "F", "U"],
  LW: ["LW", "W", "F", "U"],
  RW: ["RW", "W", "F", "U"],
  W:  ["W", "LW", "RW", "F", "U"],
  F:  ["F", "C", "LW", "RW", "W", "U"],
  D:  ["D", "U"],
  G:  ["G"],
};

const SKATER_SLOT_KEYS: RosterKey[] = ["C", "LW", "RW", "W", "F", "D", "U"];

function totalSkaterStartingSlots(roster: Roster): number {
  return SKATER_SLOT_KEYS.reduce((sum, k) => sum + (roster[k] || 0), 0);
}

function slotsCoveredByPositions(positions: string[], roster: Roster): number {
  const covered = new Set<string>();
  positions.forEach((p) => {
    (POSITION_SLOT_MAP[p] || []).forEach((slot) => covered.add(slot));
  });
  let count = 0;
  covered.forEach((slot) => {
    if ((SKATER_SLOT_KEYS as string[]).includes(slot)) {
      count += roster[slot as RosterKey] || 0;
    }
  });
  return count;
}

const FLEX_ALPHA = 0.4;

function positionMultiplier(positions: string[], roster: Roster): number {
  if (!positions || positions.length === 0) return 1;
  if (positions.includes("G")) return 1;
  const totalSlots = totalSkaterStartingSlots(roster);
  if (totalSlots === 0) return 1;
  const playerCoverage = slotsCoveredByPositions(positions, roster) / totalSlots;
  const baselineCoverage = slotsCoveredByPositions(["C"], roster) / totalSlots;
  return 1 + (playerCoverage - baselineCoverage) * FLEX_ALPHA;
}

// ============================================================
// VALUATION
// ============================================================

function projectedSeasonValue(
  player: DbPlayer,
  skaterWeights: SkaterWeights,
  goalieWeights: GoalieWeights
): number {
  const gp = player.gamesPlayed;
  if (gp === 0) return 0;
  const weights: Record<string, number> = player.isGoalie ? goalieWeights : skaterWeights;
  let perGame = 0;
  Object.keys(weights).forEach((stat) => {
    const weight = weights[stat] || 0;
    const value = player.stats[stat as SkaterStatKey | GoalieStatKey] || 0;
    const isRateStat = stat === "ATOI" || stat === "GAA" || stat === "SV%";
    const rate = isRateStat ? value : value / gp;
    perGame += rate * weight;
  });
  return perGame * 82;
}

// Parse a string of picks into structured ParsedPick objects.
// Accepts formats:
//   "1.01"          -> round 1, slot 1
//   "2.05"          -> round 2, slot 5
//   "2027 1.01"     -> round 1, slot 1, year 2027 (year is annotation only, no discount)
// Separators: commas, semicolons, or newlines.
function parsePicks(text: string, teams: number): ParsedPick[] {
  if (!text.trim()) return [];
  const tokens = text.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  return tokens.map((raw): ParsedPick => {
    // Optional year prefix: "2027 1.01"
    const yearMatch = raw.match(/^(\d{4})\s+(.+)$/);
    let year: number | null = null;
    let core = raw;
    if (yearMatch) {
      year = parseInt(yearMatch[1], 10);
      core = yearMatch[2];
    }

    // Expect round.slot format
    const pickMatch = core.match(/^(\d+)\.(\d+)$/);
    if (!pickMatch) {
      return {
        raw, round: 0, slot: 0, year, overall: 0,
        error: "Invalid format. Use round.slot (e.g., 1.01)",
      };
    }

    const round = parseInt(pickMatch[1], 10);
    const slot = parseInt(pickMatch[2], 10);

    if (round < 1) {
      return { raw, round, slot, year, overall: 0, error: "Round must be 1 or higher" };
    }
    if (slot < 1 || slot > teams) {
      return {
        raw, round, slot, year, overall: 0,
        error: `Slot must be between 1 and ${teams} (your league size)`,
      };
    }

    const overall = (round - 1) * teams + slot;
    return { raw, round, slot, year, overall, error: null };
  });
}

// Build a league-specific talent ranking: all players sorted by projected
// value descending, using the user's scoring weights. Returns values only
// (not player objects) since that's all pick valuation needs.
function buildTalentRanking(
  playerDb: DbPlayer[],
  skaterWeights: SkaterWeights,
  goalieWeights: GoalieWeights,
  scoringType: "points" | "categories" = "points",
  skaterCategories?: Record<SkaterStatKey, CategoryConfig | null>,
  goalieCategories?: Record<GoalieStatKey, CategoryConfig | null>,
  poolStats?: PoolStats | null,
  skaterStatKeys?: SkaterStatKey[],
  goalieStatKeys?: GoalieStatKey[],
  useRates?: boolean
): number[] {
  return playerDb
    .map((p) => {
      if (
        scoringType === "categories" &&
        skaterCategories && goalieCategories && poolStats &&
        skaterStatKeys && goalieStatKeys
      ) {
        return zScoreValue(p, skaterCategories, goalieCategories, poolStats, skaterStatKeys, goalieStatKeys, useRates ?? true);
      }
      return projectedSeasonValue(p, skaterWeights, goalieWeights);
    })
    .sort((a, b) => b - a);
}

// Given a parsed pick and league config, compute its projected value.
// Returns 0 if the pick has an error or if the ranking lookup fails.
function valueForPick(
  pick: ParsedPick,
  talentRanking: number[],
  teams: number,
  keepersPerTeam: number
): number {
  if (pick.error) return 0;
  const keeperOffset = teams * keepersPerTeam;
  const talentRank = keeperOffset + pick.overall; // 1-indexed
  const idx = talentRank - 1;
  if (idx < 0) return 0;
  // If the pick exceeds the database, use the last available value as a floor
  if (idx >= talentRanking.length) {
    return talentRanking[talentRanking.length - 1] || 0;
  }
  return talentRanking[idx] || 0;
}

// ============================================================
// CATEGORIES VALUATION – z-score mode
// ============================================================

type StatPoolStats = { mean: number; stddev: number; avgVolume?: number };
type PoolStats = {
  skaterStats: Record<SkaterStatKey, StatPoolStats>;
  goalieStats: Record<GoalieStatKey, StatPoolStats>;
};

// Stats where we use the raw value directly (already a per-game rate).
const RATE_SKATER = new Set<SkaterStatKey>(["ATOI"]);
// Goalie stats that are volume-weighted rate stats.
const VOL_GOALIE = new Set<GoalieStatKey>(["SV%", "GAA"]);

function _meanStddev(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 1 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) || 1 };
}

function computePoolStats(
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

  return { skaterStats: skaterPoolStats, goalieStats: goaliePoolStats };
}

function _skaterZ(player: DbPlayer, stat: SkaterStatKey, ps: StatPoolStats, useRates: boolean): number {
  if (ps.stddev === 0) return 0;
  const raw = player.stats[stat] || 0;
  const value = !useRates ? raw : (RATE_SKATER.has(stat) ? raw : raw / player.gamesPlayed);
  return (value - ps.mean) / ps.stddev;
}

function _goalieZ(player: DbPlayer, stat: GoalieStatKey, ps: StatPoolStats, useRates: boolean): number {
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

function zScoreValue(
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
// CONSTANTS
// ============================================================

const SKATER_STATS: SkaterStatKey[] = [
  "G", "A", "P", "PM", "PIM",
  "PPG", "PPA", "PPP",
  "SHG", "SHA", "SHP",
  "GWG", "SOG", "HIT", "BLK", "FW", "FL",
  "TOI", "ATOI",
];

const GOALIE_STATS: GoalieStatKey[] = ["W", "L", "OTL", "SO", "SV", "GA", "GAA", "SV%"];

const SKATER_POSITIONS = ["C", "LW", "RW", "W", "F", "D"];

function emptySkaterWeights(): SkaterWeights {
  return SKATER_STATS.reduce((acc, s) => ({ ...acc, [s]: 0 }), {} as SkaterWeights);
}
function emptyGoalieWeights(): GoalieWeights {
  return GOALIE_STATS.reduce((acc, s) => ({ ...acc, [s]: 0 }), {} as GoalieWeights);
}
function emptySkaterCategories(): Record<SkaterStatKey, CategoryConfig | null> {
  return SKATER_STATS.reduce((acc, s) => ({ ...acc, [s]: null }), {} as Record<SkaterStatKey, CategoryConfig | null>);
}
function emptyGoalieCategories(): Record<GoalieStatKey, CategoryConfig | null> {
  return GOALIE_STATS.reduce((acc, s) => ({ ...acc, [s]: null }), {} as Record<GoalieStatKey, CategoryConfig | null>);
}

// ============================================================
// SEASON NORMALIZATION
// ============================================================

// Rate stats are already per-game; all other stats are counting totals.
const RATE_STAT_KEYS = new Set<string>(["ATOI", "GAA", "SV%"]);

/** Return a copy of `player` with all counting stats scaled to an 82-game pace. */
function normalizePlayerTo82(player: DbPlayer): DbPlayer {
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
// MAIN COMPONENT
// ============================================================

const DEFAULT_LEAGUE: League = {
  name: "",
  teams: 12,
  leagueType: "redraft",
  keepersPerTeam: 0,
  roster: {
    C: 2, LW: 2, RW: 2, W: 0, F: 0,
    D: 4, U: 2, G: 2, B: 4, IR: 1, IRplus: 0,
  },
  scoringType: "points",
  skaterWeights: emptySkaterWeights(),
  goalieWeights: emptyGoalieWeights(),
  skaterCategories: emptySkaterCategories(),
  goalieCategories: emptyGoalieCategories(),
};

export default function TradeAnalyzer() {
  const { user, isLoaded: clerkLoaded } = useUser();
  const tier    = (user?.publicMetadata?.tier as string) ?? "free";
  const isPro   = tier === "tier1" || tier === "tier2";
  const isTier2 = tier === "tier2";
  const { selectedLeagueId: ctxLeagueIds } = useLeagueContext();

  const [league, setLeague] = useState<League>(() => {
    const saved = loadCurrentLeague();
    if (!saved) return DEFAULT_LEAGUE;
    // Migration: fill in fields that didn't exist in older saved versions
    const rawWeights = saved.skaterWeights as Record<string, number> | undefined;
    const rawCategories = saved.skaterCategories as Record<string, CategoryConfig | null> | undefined;
    // Migrate PLUS/MINUS → PM
    const migratedWeights = { ...DEFAULT_LEAGUE.skaterWeights, ...rawWeights };
    if (rawWeights && ("PLUS" in rawWeights || "MINUS" in rawWeights)) {
      migratedWeights.PM = (rawWeights.PLUS ?? 0) + Math.abs(rawWeights.MINUS ?? 0);
      delete (migratedWeights as Record<string, number>).PLUS;
      delete (migratedWeights as Record<string, number>).MINUS;
    }
    const migratedCategories = { ...DEFAULT_LEAGUE.skaterCategories, ...rawCategories };
    if (rawCategories && ("PLUS" in rawCategories || "MINUS" in rawCategories)) {
      migratedCategories.PM = rawCategories.PLUS ?? rawCategories.MINUS ?? null;
      delete (migratedCategories as Record<string, CategoryConfig | null>).PLUS;
      delete (migratedCategories as Record<string, CategoryConfig | null>).MINUS;
    }
    return {
      ...DEFAULT_LEAGUE,
      ...saved,
      scoringType: saved.scoringType ?? "points",
      skaterWeights: migratedWeights,
      skaterCategories: rawCategories
        ? migratedCategories
        : emptySkaterCategories(),
      goalieCategories: saved.goalieCategories
        ? { ...DEFAULT_LEAGUE.goalieCategories, ...saved.goalieCategories }
        : emptyGoalieCategories(),
    };
  });
  const [profiles, setProfiles] = useState<SavedProfile[]>(() => loadProfiles());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save state for Pro users (replaces the manual "Save to History" button)
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saved">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [dataMode, setDataMode] = useState<DataMode>(() => {
    try {
      return (localStorage.getItem(LS_DATA_MODE) as DataMode) || "thisTotal";
    } catch {
      return "thisTotal";
    }
  });
  const [currentSeasonDb,  setCurrentSeasonDb]  = useState<DbPlayer[]>([]);
  const [priorSeasonDb,    setPriorSeasonDb]    = useState<DbPlayer[]>([]);
  const [currentSeasonIdStr, setCurrentSeasonIdStr] = useState<string>("");
  const [priorSeasonIdStr,   setPriorSeasonIdStr]   = useState<string>("");
  const [dbStatus, setDbStatus] = useState<DbStatus>("loading");

  // ── Tier 2: multi-league state ───────────────────────────────
  const [t2Leagues,     setT2Leagues]     = useState<LeagueRow[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

  // ── Load both seasons in one round-trip ──────────────────────
  useEffect(() => {
    type SeasonPayload = {
      seasonId: string;
      summary:  Record<string, unknown>[];
      realtime: Record<string, unknown>[];
      faceoffs: Record<string, unknown>[];
      goalies:  Record<string, unknown>[];
    };
    let cancelled = false;
    fetch("/api/nhl?endpoint=all-seasons")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(({ currentSeason, priorSeason }: { currentSeason: SeasonPayload; priorSeason: SeasonPayload }) => {
        if (cancelled) return;
        const curPlayers = buildPlayerDatabase({
          summary: currentSeason.summary, realtime: currentSeason.realtime,
          faceoffs: currentSeason.faceoffs, goalies: currentSeason.goalies,
        });
        const priPlayers = buildPlayerDatabase({
          summary: priorSeason.summary, realtime: priorSeason.realtime,
          faceoffs: priorSeason.faceoffs, goalies: priorSeason.goalies,
        });
        setCurrentSeasonDb(curPlayers);
        setPriorSeasonDb(priPlayers);
        setCurrentSeasonIdStr(currentSeason.seasonId);
        setPriorSeasonIdStr(priorSeason.seasonId);
        // Auto-detect: if user has no saved preference and current season is sparse,
        // default to last year's data.
        const savedMode = (() => { try { return localStorage.getItem(LS_DATA_MODE); } catch { return null; } })();
        if (!savedMode) {
          const significant = currentSeason.summary.filter(
            (s) => asNumber(s.gamesPlayed) >= 10
          ).length;
          if (significant < 100) setDataMode("lastTotal");
        }
        setDbStatus("ready");
      })
      .catch(() => { if (!cancelled) setDbStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  // ── Persist dataMode selection ────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(LS_DATA_MODE, dataMode); } catch {}
  }, [dataMode]);

  // ── Active player database: derived from season + mode ───────
  const playerDb = useMemo(() => {
    const base = (dataMode === "thisTotal" || dataMode === "thisAvg")
      ? currentSeasonDb
      : priorSeasonDb;
    return (dataMode === "thisAvg" || dataMode === "lastAvg")
      ? base.map(normalizePlayerTo82)
      : base;
  }, [dataMode, currentSeasonDb, priorSeasonDb]);

  // Auto-save current league settings whenever they change (free users only)
  useEffect(() => {
    if (isPro) return;
    saveCurrentLeague(league);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saved");
    saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
  }, [league, isPro]);

  // ── Apply saved league settings into component state ────────
  const applyLeagueSettings = useCallback((settings: League) => {
    setLeague({
      ...DEFAULT_LEAGUE,
      ...settings,
      scoringType: settings.scoringType ?? "points",
      skaterCategories: settings.skaterCategories
        ? { ...DEFAULT_LEAGUE.skaterCategories, ...settings.skaterCategories }
        : emptySkaterCategories(),
      goalieCategories: settings.goalieCategories
        ? { ...DEFAULT_LEAGUE.goalieCategories, ...settings.goalieCategories }
        : emptyGoalieCategories(),
    });
  }, []);

  // On load, fetch saved leagues from Supabase for Pro users.
  // Tier 1: load the single league. Tier 2: populate the league selector.
  useEffect(() => {
    if (!clerkLoaded || !isPro) return;
    let cancelled = false;
    fetch("/api/leagues?sport=nhl")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data: LeagueRow[] } | null) => {
        if (cancelled) return;
        const rows = json?.data ?? [];
        if (isTier2) {
          setT2Leagues(rows);
          // Prefer the league selected on the dashboard via context
          const ctxId = ctxLeagueIds["nhl"];
          const target = rows.find((r) => r.id === ctxId)?.id ?? rows[0]?.id ?? null;
          setActiveLeagueId(target);
          // Settings applied by the activeLeagueId effect below
        } else {
          // Tier 1: load the first (and only) league directly
          const settings = rows[0]?.settings;
          if (settings) applyLeagueSettings(settings as League);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isPro, isTier2, clerkLoaded, applyLeagueSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the active Tier 2 league changes, reload settings
  useEffect(() => {
    if (!isTier2 || !activeLeagueId || t2Leagues.length === 0) return;
    const row = t2Leagues.find((r) => r.id === activeLeagueId);
    if (row?.settings) applyLeagueSettings(row.settings as League);
  }, [isTier2, activeLeagueId, t2Leagues, applyLeagueSettings]);

  const saveProfile = useCallback(() => {
    const profileName = league.name.trim() || "Unnamed League";
    const updated = [
      { name: profileName, savedAt: new Date().toISOString(), league },
      ...profiles.filter((p) => p.name !== profileName),
    ];
    setProfiles(updated);
    saveProfiles(updated);
  }, [league, profiles]);

  const loadProfile = useCallback((profile: SavedProfile) => {
    setLeague(profile.league);
  }, []);

  const deleteProfile = useCallback((name: string) => {
    const updated = profiles.filter((p) => p.name !== name);
    setProfiles(updated);
    saveProfiles(updated);
  }, [profiles]);

  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());

  const [sendPlayers, setSendPlayers] = useState<TradePlayer[]>([]);
  const [recvPlayers, setRecvPlayers] = useState<TradePlayer[]>([]);
  const [sendPicks, setSendPicks] = useState("");
  const [recvPicks, setRecvPicks] = useState("");

  const useRates = dataMode === "thisAvg" || dataMode === "lastAvg";

  // Pre-computed population stats for categories mode — recalculates when DB
  // or league size/roster changes, not when categories are toggled.
  const poolStats = useMemo(() => {
    if (playerDb.length === 0) return null;
    return computePoolStats(playerDb, league.teams, league.roster, SKATER_STATS, GOALIE_STATS, useRates);
  }, [playerDb, league.teams, league.roster, useRates]);

  // League-specific talent ranking — sorted projected values for every NHL player.
  // Branches on scoringType so pick valuation works in both modes.
  const talentRanking = useMemo(() => {
    if (playerDb.length === 0) return [];
    return buildTalentRanking(
      playerDb,
      league.skaterWeights,
      league.goalieWeights,
      league.scoringType,
      league.skaterCategories,
      league.goalieCategories,
      poolStats,
      SKATER_STATS,
      GOALIE_STATS,
      useRates
    );
  }, [playerDb, league.skaterWeights, league.goalieWeights, league.scoringType,
      league.skaterCategories, league.goalieCategories, poolStats, useRates]);

  // League ranking: playerId → 1-based rank by projected points value.
  // Recomputes only when the DB or scoring weights change.
  const rankMap = useMemo(() => {
    const map = new Map<number, number>();
    if (playerDb.length === 0) return map;

    let sorted: DbPlayer[];

    if (league.scoringType === "categories" && poolStats) {
      // Categories mode: rank by z-score value
      sorted = [...playerDb].sort((a, b) => {
        const va = zScoreValue(a, league.skaterCategories, league.goalieCategories, poolStats, SKATER_STATS, GOALIE_STATS, useRates);
        const vb = zScoreValue(b, league.skaterCategories, league.goalieCategories, poolStats, SKATER_STATS, GOALIE_STATS, useRates);
        return vb - va || b.gamesPlayed - a.gamesPlayed;
      });
    } else {
      const allZero =
        Object.values(league.skaterWeights).every((v) => v === 0) &&
        Object.values(league.goalieWeights).every((v) => v === 0);

      if (allZero) {
        // No weights set: fall back to gamesPlayed descending
        sorted = [...playerDb].sort((a, b) => b.gamesPlayed - a.gamesPlayed);
      } else {
        // Points mode with weights: rank by projected value, gamesPlayed as tiebreaker
        sorted = [...playerDb].sort((a, b) => {
          const va = projectedSeasonValue(a, league.skaterWeights, league.goalieWeights);
          const vb = projectedSeasonValue(b, league.skaterWeights, league.goalieWeights);
          return vb - va || b.gamesPlayed - a.gamesPlayed;
        });
      }
    }

    sorted.forEach((p, i) => map.set(p.id, i + 1));
    return map;
  }, [playerDb, league.skaterWeights, league.goalieWeights, league.scoringType,
      league.skaterCategories, league.goalieCategories, poolStats, useRates]);

  // Parsed picks with errors flagged
  const sendPicksParsed = useMemo(
    () => parsePicks(sendPicks, league.teams),
    [sendPicks, league.teams]
  );
  const recvPicksParsed = useMemo(
    () => parsePicks(recvPicks, league.teams),
    [recvPicks, league.teams]
  );

  const isCatMode = league.scoringType === "categories";

  const sendValue = useMemo(() => {
    const playerTotal = sendPlayers.reduce((sum, p) => {
      const dbEntry = playerDb.find((x) => x.id === p.id);
      if (!dbEntry) return sum;
      const base = isCatMode && poolStats
        ? zScoreValue(dbEntry, league.skaterCategories, league.goalieCategories, poolStats, SKATER_STATS, GOALIE_STATS, useRates)
        : projectedSeasonValue(dbEntry, league.skaterWeights, league.goalieWeights);
      const mult = positionMultiplier(p.positions, league.roster);
      return sum + base * mult;
    }, 0);
    const keepers = league.leagueType === "keeper" ? league.keepersPerTeam : 0;
    const pickTotal = sendPicksParsed.reduce(
      (sum, pk) => sum + valueForPick(pk, talentRanking, league.teams, keepers),
      0
    );
    return playerTotal + pickTotal;
  }, [sendPlayers, sendPicksParsed, talentRanking, playerDb, league, poolStats, isCatMode, useRates]);

  const recvValue = useMemo(() => {
    const playerTotal = recvPlayers.reduce((sum, p) => {
      const dbEntry = playerDb.find((x) => x.id === p.id);
      if (!dbEntry) return sum;
      const base = isCatMode && poolStats
        ? zScoreValue(dbEntry, league.skaterCategories, league.goalieCategories, poolStats, SKATER_STATS, GOALIE_STATS, useRates)
        : projectedSeasonValue(dbEntry, league.skaterWeights, league.goalieWeights);
      const mult = positionMultiplier(p.positions, league.roster);
      return sum + base * mult;
    }, 0);
    const keepers = league.leagueType === "keeper" ? league.keepersPerTeam : 0;
    const pickTotal = recvPicksParsed.reduce(
      (sum, pk) => sum + valueForPick(pk, talentRanking, league.teams, keepers),
      0
    );
    return playerTotal + pickTotal;
  }, [recvPlayers, recvPicksParsed, talentRanking, playerDb, league, poolStats, isCatMode, useRates]);

  const totalRosterSize = useMemo(() => {
    return Object.values(league.roster).reduce((a, b) => a + b, 0);
  }, [league.roster]);

  const score = useMemo(() => fairnessScore(sendValue, recvValue), [sendValue, recvValue]);

  const minVal = Math.min(sendValue, recvValue);
  const maxVal = Math.max(sendValue, recvValue);
  const tradeRating = (minVal === 0 || maxVal === 0)
    ? 0
    : Math.round(100 * Math.exp(-2.5 * (maxVal / minVal - 1)) * 10) / 10;

  function tradeRatingLabel(rating: number): string {
    if (rating >= 90) return "Perfect Trade";
    if (rating >= 70) return "Excellent Trade";
    if (rating >= 60) return "Good Trade";
    if (rating >= 41) return "Uneven Trade";
    if (rating >= 21) return "Bad Trade";
    return "Severely Lopsided";
  }

  // displayScore: ratio-based distance from center mapped to 0–100,
  // with direction (you win = right of center, opponent wins = left).
  const ratio = (minVal === 0 || maxVal === 0) ? Infinity : maxVal / minVal;
  const youWin = recvValue >= sendValue;
  const ratioDistance = Math.min(50, (1 - Math.exp(-2.5 * (ratio - 1))) * 50);
  const displayScore = youWin ? 50 + ratioDistance : 50 - ratioDistance;

  function barColor(ds: number): string {
    if (ds <= 10.4) return "#000000";
    if (ds <= 20.4) return "#cc0000";
    if (ds <= 30.4) return "#ff6600";
    if (ds <= 40.4) return "#ffcc00";
    if (ds <= 60.4) return "#33aa33";
    if (ds <= 70.4) return "#ffcc00";
    if (ds <= 80.4) return "#ff6600";
    if (ds <= 90.4) return "#cc0000";
    return "#000000";
  }

  function tradeOutline(ds: number): string {
    if (ds <= 10.4) return "Horrific trade, don't do this.";
    if (ds <= 20.4) return "Insanely bad trade.";
    if (ds <= 30.4) return "You really lose this trade.";
    if (ds <= 40.4) return "You lose this trade.";
    if (ds <= 60.4) return "This is in the realm of fairness.";
    if (ds <= 70.4) return "You win this trade.";
    if (ds <= 80.4) return "You really win this trade.";
    if (ds <= 90.4) return "They shouldn't accept this trade, but if they do, good for you.";
    return "We won't tell, but if they accept this, it's probably collusion.";
  }

  // Auto-save to Supabase for Pro users — debounced 1500ms.
  // Fires when both sides of the trade have content and at least one value > 0.
  useEffect(() => {
    if (!isPro) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);

    const hasSend = sendPlayers.length > 0 || sendPicks.trim() !== "";
    const hasRecv = recvPlayers.length > 0 || recvPicks.trim() !== "";
    if (!hasSend || !hasRecv || (sendValue === 0 && recvValue === 0)) return;

    autoSaveTimerRef.current = setTimeout(() => {
      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        savedAt: new Date().toISOString(),
        sport: "nhl",
        leagueId: isTier2 && activeLeagueId ? activeLeagueId : undefined,
        leagueName: league.name.trim() || "Unnamed League",
        sendPlayerNames: sendPlayers.map((p) => p.name),
        recvPlayerNames: recvPlayers.map((p) => p.name),
        sendPicks: sendPicks.trim(),
        recvPicks: recvPicks.trim(),
        sendValue,
        recvValue,
        score,
        verdict: fairnessDescription(score),
      };
      fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      })
        .then(() => {
          setAutoSaveStatus("saved");
          setTimeout(() => setAutoSaveStatus("idle"), 2000);
        })
        .catch(() => {});
    }, 5000);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [isPro, sendPlayers, recvPlayers, sendPicks, recvPicks, isTier2, activeLeagueId]);

  const updateLeague = (patch: Partial<League>) =>
    setLeague((prev) => ({ ...prev, ...patch }));
  const updateRoster = (pos: RosterKey, val: number) =>
    setLeague((prev) => ({ ...prev, roster: { ...prev.roster, [pos]: val } }));
  const updateSkaterWeight = (stat: SkaterStatKey, val: number) =>
    setLeague((prev) => ({ ...prev, skaterWeights: { ...prev.skaterWeights, [stat]: val } }));
  const updateGoalieWeight = (stat: GoalieStatKey, val: number) =>
    setLeague((prev) => ({ ...prev, goalieWeights: { ...prev.goalieWeights, [stat]: val } }));
  const updateSkaterCategory = (stat: SkaterStatKey, cfg: CategoryConfig | null) =>
    setLeague((prev) => ({ ...prev, skaterCategories: { ...prev.skaterCategories, [stat]: cfg } }));
  const updateGoalieCategory = (stat: GoalieStatKey, cfg: CategoryConfig | null) =>
    setLeague((prev) => ({ ...prev, goalieCategories: { ...prev.goalieCategories, [stat]: cfg } }));

  const addPlayer = (side: "send" | "recv", dbEntry: DbPlayer) => {
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    const list = side === "send" ? sendPlayers : recvPlayers;
    if (list.find((p) => p.id === dbEntry.id)) return;
    const pos = dbEntry.position;
    const useW =
      (pos === "LW" || pos === "RW") &&
      (league.roster.LW ?? 0) === 0 &&
      (league.roster.RW ?? 0) === 0 &&
      (league.roster.W  ?? 0) > 0;
    const newEntry: TradePlayer = {
      id: dbEntry.id,
      name: dbEntry.name,
      team: dbEntry.team,
      primaryPosition: pos,
      positions: useW ? ["W"] : [pos],
    };
    setter([...list, newEntry]);
  };

  const removePlayer = (side: "send" | "recv", id: number) => {
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    const list = side === "send" ? sendPlayers : recvPlayers;
    setter(list.filter((p) => p.id !== id));
  };

  const togglePosition = (side: "send" | "recv", id: number, pos: string) => {
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    setter((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const has = p.positions.includes(pos);
        return {
          ...p,
          positions: has ? p.positions.filter((x) => x !== pos) : [...p.positions, pos],
        };
      })
    );
  };

  const saveToHistory = useCallback(() => {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: new Date().toISOString(),
      sport: "nhl",
      leagueId: isTier2 && activeLeagueId ? activeLeagueId : undefined,
      leagueName: league.name.trim() || "Unnamed League",
      sendPlayerNames: sendPlayers.map((p) => p.name),
      recvPlayerNames: recvPlayers.map((p) => p.name),
      sendPicks: sendPicks.trim(),
      recvPicks: recvPicks.trim(),
      sendValue,
      recvValue,
      score,
      verdict: fairnessDescription(score),
    };
    if (isPro) {
      // Pro users: persist to Supabase via API route (no localStorage write)
      fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      }).catch(() => {}); // fire-and-forget; errors are silent
    } else {
      // Free users: persist to localStorage as before
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveHistory(updated);
    }
  }, [isPro, isTier2, activeLeagueId, league.name, sendPlayers, recvPlayers, sendPicks, recvPicks, sendValue, recvValue, score, history]);

  const deleteHistoryEntry = useCallback((id: string) => {
    const updated = history.filter((e) => e.id !== id);
    setHistory(updated);
    saveHistory(updated);
  }, [history]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  const hasAnything = sendPlayers.length > 0 || recvPlayers.length > 0 ||
                      sendPicks.trim() !== "" || recvPicks.trim() !== "";

  return (
    <>
      {isPro && <ProNav />}
      {!isPro && <div style={{ background: "#f3f4f6", padding: "0.5rem 1rem", fontSize: "0.75rem", marginBottom: "0.5rem" }}>💡 Save your settings and trade history — upgrade to Pro</div>}
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Fantasy Trade Analyzer (NHL) — V3</h1>
          <ApiStatus
            status={dbStatus}
            playerCount={playerDb.length}
            currentSeasonId={currentSeasonIdStr}
            priorSeasonId={priorSeasonIdStr}
            dataMode={dataMode}
            setDataMode={setDataMode}
          />
        </div>

        {/* ── Tier 2: league selector ──────────────────────── */}
        {isTier2 && (
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm text-gray-600 shrink-0">League:</label>
            {t2Leagues.length > 0 ? (
              <select
                className="border rounded-xl px-3 py-1.5 text-sm"
                value={activeLeagueId ?? ""}
                onChange={(e) => setActiveLeagueId(e.target.value || null)}
              >
                {t2Leagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-gray-400 italic">No leagues yet</span>
            )}
            <Link
              href="/settings"
              className="text-xs text-blue-600 hover:underline whitespace-nowrap"
            >
              + New League
            </Link>
          </div>
        )}

      {!isPro && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="border rounded-2xl p-4">
          <h2 className="font-medium mb-2">League Settings</h2>

          <label className="text-sm">League Name (optional)</label>
          <input
            type="text"
            className="border rounded-xl p-2 w-full mb-2"
            value={league.name}
            onChange={(e) => updateLeague({ name: e.target.value })}
          />

          <label className="text-sm">Number of Teams</label>
          <input
            type="number"
            min={2}
            className="border rounded-xl p-2 w-full mb-2"
            value={league.teams}
            onChange={(e) => updateLeague({ teams: parseInt(e.target.value || "12", 10) })}
          />

          <label className="text-sm">League Type</label>
          <select
            className="border rounded-xl p-2 w-full mb-2"
            value={league.leagueType}
            onChange={(e) => updateLeague({ leagueType: e.target.value as "redraft" | "keeper" })}
          >
            <option value="redraft">Redraft</option>
            <option value="keeper">Keeper</option>
          </select>

          {league.leagueType === "keeper" && (
            <>
              <label className="text-sm">Keepers per Team</label>
              <input
                type="number"
                min={0}
                className="border rounded-xl p-2 w-full mb-2"
                value={league.keepersPerTeam}
                onChange={(e) => updateLeague({ keepersPerTeam: parseInt(e.target.value || "0", 10) })}
              />
            </>
          )}

          <h3 className="text-sm font-semibold mt-3 mb-2">Roster Slots</h3>
          <p className="text-xs text-gray-600 mb-2">
            Use whichever forward slots your league has; set unused to 0.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(league.roster) as RosterKey[]).map((pos) => (
              <label key={pos} className="text-xs flex items-center gap-2">
                <span className="w-12">{pos === "IRplus" ? "IR+" : pos}</span>
                <input
                  type="number"
                  min={0}
                  className="border rounded-xl p-1 w-full"
                  value={league.roster[pos]}
                  onChange={(e) => updateRoster(pos, parseInt(e.target.value || "0", 10))}
                />
              </label>
            ))}
          </div>
          <div className="text-xs text-gray-600 mt-2">
            Total roster size: <span className="font-semibold">{totalRosterSize}</span>
          </div>

        </div>

        <div className="border rounded-2xl p-4">
          <h2 className="font-medium mb-2">Scoring</h2>

          <label className="text-sm">Scoring Type</label>
          <select
            className="border rounded-xl p-2 w-full mb-3"
            value={league.scoringType}
            onChange={(e) => updateLeague({ scoringType: e.target.value as "points" | "categories" })}
          >
            <option value="points">Points</option>
            <option value="categories">Categories</option>
          </select>

          {!isCatMode ? (
            <>
              <p className="text-xs text-gray-600 mb-2">
                If your league scores both G+A and P, you&apos;re counting goals twice. Set G/A to 0
                if you only score P, or leave P at 0 if you score G and A separately.
              </p>
              <h3 className="text-sm font-semibold mt-1 mb-1">Skaters</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
                {SKATER_STATS.map((stat) => (
                  <div key={stat} className="flex items-center justify-between gap-2">
                    <label className="text-sm w-16">
                      {stat === "PM" ? "+/-" : stat}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      className="border rounded-xl p-1 w-full"
                      value={league.skaterWeights[stat]}
                      onChange={(e) => updateSkaterWeight(stat, parseFloat(e.target.value || "0"))}
                    />
                  </div>
                ))}
              </div>
              <h3 className="text-sm font-semibold mt-2 mb-1">Goalies</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {GOALIE_STATS.map((stat) => (
                  <div key={stat} className="flex items-center justify-between gap-2">
                    <label className="text-sm w-16">{stat}</label>
                    <input
                      type="number"
                      step="0.1"
                      className="border rounded-xl p-1 w-full"
                      value={league.goalieWeights[stat]}
                      onChange={(e) => updateGoalieWeight(stat, parseFloat(e.target.value || "0"))}
                    />
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-600 mb-3">
                Check each category your league uses. If your league has both G+A and P as
                categories, you&apos;re counting goals twice. Set direction to &ldquo;less&rdquo; for stats where
                lower is better (PIM, GAA, L, GA).
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Skaters</h3>
                  <div className="space-y-1">
                    {SKATER_STATS.map((stat) => {
                      const cfg = league.skaterCategories[stat];
                      const label = stat === "PM" ? "+/-" : stat;
                      return (
                        <div key={stat} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            id={`scat-${stat}`}
                            checked={cfg !== null}
                            onChange={(e) =>
                              updateSkaterCategory(stat, e.target.checked ? { direction: "more" } : null)
                            }
                          />
                          <label htmlFor={`scat-${stat}`} className="w-10 cursor-pointer">{label}</label>
                          {cfg && (
                            <div className="flex rounded-lg border overflow-hidden text-xs">
                              <button
                                className={`px-1.5 py-0.5 ${cfg.direction === "more" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                onClick={() => updateSkaterCategory(stat, { direction: "more" })}
                              >+</button>
                              <button
                                className={`px-1.5 py-0.5 ${cfg.direction === "less" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                onClick={() => updateSkaterCategory(stat, { direction: "less" })}
                              >−</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold mb-2">Goalies</h3>
                  <div className="space-y-1">
                    {GOALIE_STATS.map((stat) => {
                      const cfg = league.goalieCategories[stat];
                      return (
                        <div key={stat} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            id={`gcat-${stat}`}
                            checked={cfg !== null}
                            onChange={(e) =>
                              updateGoalieCategory(stat, e.target.checked ? { direction: "more" } : null)
                            }
                          />
                          <label htmlFor={`gcat-${stat}`} className="w-10 cursor-pointer">{stat}</label>
                          {cfg && (
                            <div className="flex rounded-lg border overflow-hidden text-xs">
                              <button
                                className={`px-1.5 py-0.5 ${cfg.direction === "more" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                onClick={() => updateGoalieCategory(stat, { direction: "more" })}
                              >+</button>
                              <button
                                className={`px-1.5 py-0.5 ${cfg.direction === "less" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                onClick={() => updateGoalieCategory(stat, { direction: "less" })}
                              >−</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      )}

      <div className="border rounded-2xl p-4 mb-6">
        <h2 className="font-medium mb-3">Trade Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <TradeSide
            label="You Give"
            players={sendPlayers}
            picks={sendPicks}
            setPicks={setSendPicks}
            parsedPicks={sendPicksParsed}
            talentRanking={talentRanking}
            teams={league.teams}
            keepersPerTeam={league.leagueType === "keeper" ? league.keepersPerTeam : 0}
            playerDb={playerDb}
            dbStatus={dbStatus}
            roster={league.roster}
            skaterWeights={league.skaterWeights}
            goalieWeights={league.goalieWeights}
            rankMap={rankMap}
            onAdd={(p) => addPlayer("send", p)}
            onRemove={(id) => removePlayer("send", id)}
            onTogglePos={(id, pos) => togglePosition("send", id, pos)}
          />
          <TradeSide
            label="You Get"
            players={recvPlayers}
            picks={recvPicks}
            setPicks={setRecvPicks}
            parsedPicks={recvPicksParsed}
            talentRanking={talentRanking}
            teams={league.teams}
            keepersPerTeam={league.leagueType === "keeper" ? league.keepersPerTeam : 0}
            playerDb={playerDb}
            dbStatus={dbStatus}
            roster={league.roster}
            skaterWeights={league.skaterWeights}
            goalieWeights={league.goalieWeights}
            rankMap={rankMap}
            onAdd={(p) => addPlayer("recv", p)}
            onRemove={(id) => removePlayer("recv", id)}
            onTogglePos={(id, pos) => togglePosition("recv", id, pos)}
          />
        </div>
      </div>

      <div className="border rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Fairness Result</h2>
          {isPro && autoSaveStatus === "saved" && (
            <span className="text-xs text-green-600">✓ Auto-saved</span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-4 mb-3">
          <div>
            <div className="text-xs text-gray-600">
              {isCatMode ? "You Give (z-score sum)" : "You Give (projected pts)"}
            </div>
            <div className="text-lg font-semibold">
              {isCatMode ? sendValue.toFixed(2) : sendValue.toFixed(1)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-600">
              {isCatMode ? "You Get (z-score sum)" : "You Get (projected pts)"}
            </div>
            <div className="text-lg font-semibold">
              {isCatMode ? recvValue.toFixed(2) : recvValue.toFixed(1)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-600">Trade Rating</div>
            <div className="text-lg font-semibold">{tradeRating.toFixed(1)} / 100</div>
          </div>
          <div>
            <div className="text-xs text-gray-600">Trade Outline</div>
            {(sendValue > 0 || recvValue > 0) && (
              <div className="text-sm font-medium text-gray-800">{tradeOutline(displayScore)}</div>
            )}
          </div>
        </div>

        {/* ── Fairness Scale Bar ───────────────────────────────── */}
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Opponent Wins</span>
            <span className="font-medium text-gray-600">Fairness Scale</span>
            <span>You Win</span>
          </div>
          {/* Segmented bar — all zones always visible, marker moves */}
          <div className="relative h-3 rounded-full overflow-hidden flex">
            {/* Each width = segment range / 100 * 100% */}
            <div style={{ width: "10.5%",  background: "#000000" }} />
            <div style={{ width: "10%",    background: "#cc0000" }} />
            <div style={{ width: "10%",    background: "#ff6600" }} />
            <div style={{ width: "10%",    background: "#ffcc00" }} />
            <div style={{ width: "19%",    background: "#33aa33" }} />
            <div style={{ width: "10%",    background: "#ffcc00" }} />
            <div style={{ width: "10%",    background: "#ff6600" }} />
            <div style={{ width: "10%",    background: "#cc0000" }} />
            <div style={{ width: "10.5%",  background: "#000000" }} />
            {/* Marker */}
            <div
              className="absolute top-0 h-full w-1 -translate-x-1/2 bg-white shadow pointer-events-none"
              style={{ left: `${displayScore}%` }}
            />
          </div>
        </div>

        {(sendValue === 0 && recvValue === 0) && (
          <div className="text-xs text-amber-700 mt-2">
            {isCatMode
              ? "All values are 0 — make sure you’ve selected at least one category above and added players."
              : "All values are 0 — make sure you’ve set scoring weights above and added players below."}
          </div>
        )}
      </div>

      </div>
    </>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function ApiStatus({
  status, playerCount, currentSeasonId, priorSeasonId, dataMode, setDataMode,
}: {
  status: DbStatus;
  playerCount: number;
  currentSeasonId: string;
  priorSeasonId: string;
  dataMode: DataMode;
  setDataMode: (m: DataMode) => void;
}) {
  if (status === "loading") {
    return <div className="text-xs text-gray-500">Loading NHL data…</div>;
  }
  if (status === "error") {
    return <div className="text-xs text-red-600">NHL API unavailable — please refresh</div>;
  }
  const activeId = (dataMode === "thisTotal" || dataMode === "thisAvg")
    ? currentSeasonId
    : priorSeasonId;
  const seasonDisplay = activeId
    ? `${activeId.slice(0, 4)}-${activeId.slice(6)}`
    : "";
  return (
    <div className="text-xs text-gray-600 text-right flex items-center gap-3">
      <div>
        <div>{playerCount} players loaded</div>
        {seasonDisplay && <div>Season: {seasonDisplay}</div>}
      </div>
      <select
        className="border rounded-lg px-2 py-1 text-xs text-gray-700 bg-white"
        value={dataMode}
        onChange={(e) => setDataMode(e.target.value as DataMode)}
      >
        <option value="thisTotal">This Year – Total</option>
        <option value="thisAvg">This Year – Per-Game Proj.</option>
        <option value="lastTotal">Last Year – Total</option>
        <option value="lastAvg">Last Year – Per-Game Proj.</option>
      </select>
    </div>
  );
}

type TradeSideProps = {
  label: string;
  players: TradePlayer[];
  picks: string;
  setPicks: (v: string) => void;
  parsedPicks: ParsedPick[];
  talentRanking: number[];
  teams: number;
  keepersPerTeam: number;
  playerDb: DbPlayer[];
  dbStatus: DbStatus;
  roster: Roster;
  skaterWeights: SkaterWeights;
  goalieWeights: GoalieWeights;
  rankMap: Map<number, number>;
  onAdd: (p: DbPlayer) => void;
  onRemove: (id: number) => void;
  onTogglePos: (id: number, pos: string) => void;
};

function TradeSide({
  label, players, picks, setPicks, parsedPicks, talentRanking, teams, keepersPerTeam,
  playerDb, dbStatus,
  roster, skaterWeights, goalieWeights, rankMap,
  onAdd, onRemove, onTogglePos,
}: TradeSideProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{label} — Players</h3>
      <PlayerTypeahead
        playerDb={playerDb}
        dbStatus={dbStatus}
        existingIds={players.map((p) => p.id)}
        onSelect={onAdd}
      />
      <div className="mt-2 space-y-2">
        {players.map((p) => (
          <PlayerRow
            key={p.id}
            player={p}
            dbEntry={playerDb.find((x) => x.id === p.id)}
            roster={roster}
            skaterWeights={skaterWeights}
            goalieWeights={goalieWeights}
            rank={rankMap.get(p.id) ?? null}
            totalPlayers={playerDb.length}
            onRemove={() => onRemove(p.id)}
            onTogglePos={(pos) => onTogglePos(p.id, pos)}
          />
        ))}
      </div>

      <h3 className="text-sm font-semibold mt-4 mb-1">{label} — Picks</h3>
      <p className="text-xs text-gray-600 mb-1">
        Enter picks as <span className="font-mono">round.slot</span> (e.g.,{" "}
        <span className="font-mono">1.01</span> = first round, first overall).
        Separate multiple picks with commas or new lines. Optionally prefix with a year
        (e.g., <span className="font-mono">2027 1.01</span>) — year is for your reference only and
        does not affect value.
      </p>
      <textarea
        className="border rounded-xl p-2 w-full h-14 text-sm"
        placeholder="1.01, 2.05"
        value={picks}
        onChange={(e) => setPicks(e.target.value)}
      />
      <ParsedPicksList
        parsedPicks={parsedPicks}
        talentRanking={talentRanking}
        teams={teams}
        keepersPerTeam={keepersPerTeam}
      />
    </div>
  );
}

function ParsedPicksList({
  parsedPicks, talentRanking, teams, keepersPerTeam,
}: {
  parsedPicks: ParsedPick[];
  talentRanking: number[];
  teams: number;
  keepersPerTeam: number;
}) {
  if (parsedPicks.length === 0) return null;
  const keeperOffset = teams * keepersPerTeam;
  return (
    <div className="mt-2 space-y-1">
      {parsedPicks.map((pk, idx) => {
        if (pk.error) {
          return (
            <div key={idx} className="border rounded-xl p-2 bg-red-50 text-xs flex justify-between">
              <span className="font-mono text-gray-700">{pk.raw}</span>
              <span className="text-red-700">{pk.error}</span>
            </div>
          );
        }
        const talentRank = keeperOffset + pk.overall;
        const value = valueForPick(pk, talentRanking, teams, keepersPerTeam);
        return (
          <div key={idx} className="border rounded-xl p-2 bg-gray-50 text-xs flex justify-between">
            <span className="font-mono font-semibold">
              {pk.year ? `${pk.year} ` : ""}
              {pk.round}.{pk.slot.toString().padStart(2, "0")}
            </span>
            <span className="text-gray-600">
              talent rank {talentRank} · value {value.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type PlayerTypeaheadProps = {
  playerDb: DbPlayer[];
  dbStatus: DbStatus;
  existingIds: number[];
  onSelect: (p: DbPlayer) => void;
};

function PlayerTypeahead({ playerDb, dbStatus, existingIds, onSelect }: PlayerTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase().trim();
    return playerDb
      .filter((p) => {
        if (existingIds.includes(p.id)) return false;
        return p.name.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const aStart = a.name.toLowerCase().startsWith(q) ||
                       a.name.toLowerCase().split(" ").some((t) => t.startsWith(q));
        const bStart = b.name.toLowerCase().startsWith(q) ||
                       b.name.toLowerCase().split(" ").some((t) => t.startsWith(q));
        if (aStart && !bStart) return -1;
        if (bStart && !aStart) return 1;
        return b.gamesPlayed - a.gamesPlayed;
      })
      .slice(0, 8);
  }, [query, playerDb, existingIds]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = matches[highlightIdx];
      if (selected) {
        onSelect(selected);
        setQuery("");
        setHighlightIdx(0);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const placeholder = dbStatus === "loading" ? "Loading players…" :
                      dbStatus === "error" ? "Player data unavailable" :
                      "Search for a player…";

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        className="border rounded-xl p-2 w-full text-sm"
        placeholder={placeholder}
        value={query}
        disabled={dbStatus !== "ready"}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlightIdx(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border rounded-xl shadow-lg max-h-64 overflow-auto">
          {matches.map((p, i) => (
            <div
              key={p.id}
              className={`px-3 py-2 text-sm cursor-pointer flex justify-between items-center ${
                i === highlightIdx ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(p);
                setQuery("");
                setHighlightIdx(0);
              }}
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-gray-500">
                {p.team} · {p.position} · {p.gamesPlayed} GP
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type PlayerRowProps = {
  player: TradePlayer;
  dbEntry: DbPlayer | undefined;
  roster: Roster;
  skaterWeights: SkaterWeights;
  goalieWeights: GoalieWeights;
  rank: number | null;
  totalPlayers: number;
  onRemove: () => void;
  onTogglePos: (pos: string) => void;
};

function PlayerRow({
  player, dbEntry, roster, skaterWeights, goalieWeights, rank, totalPlayers,
  onRemove, onTogglePos,
}: PlayerRowProps) {
  if (!dbEntry) return null;
  const mult = positionMultiplier(player.positions, roster);
  const baseValue = projectedSeasonValue(dbEntry, skaterWeights, goalieWeights);
  const adjValue = baseValue * mult;

  const unusedFlagged = player.positions.filter((p) => {
    if (p === "G") return false;
    const slots = POSITION_SLOT_MAP[p] || [];
    return !slots.some(
      (s) => (SKATER_SLOT_KEYS as string[]).includes(s) && (roster[s as RosterKey] || 0) > 0
    );
  });

  return (
    <div className="border rounded-xl p-2 bg-gray-50 text-xs">
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="font-semibold">{player.name}</span>
          <span className="text-gray-500 ml-2">
            {dbEntry.team} · primary {player.primaryPosition} · {dbEntry.gamesPlayed} GP
          </span>
        </div>
        <button
          className="text-red-600 hover:text-red-800 px-2"
          onClick={onRemove}
          title="Remove player"
        >
          ×
        </button>
      </div>
      {player.primaryPosition !== "G" ? (
        <div className="flex items-center gap-2">
          <span className="text-gray-600 w-16">Eligible:</span>
          <div className="flex gap-1 flex-1 flex-wrap">
            {SKATER_POSITIONS.map((pos) => (
              <label key={pos} className="flex items-center gap-0.5">
                <input
                  type="checkbox"
                  checked={player.positions.includes(pos)}
                  onChange={() => onTogglePos(pos)}
                />
                <span>{pos}</span>
              </label>
            ))}
          </div>
          <span className="text-gray-600">×{mult.toFixed(3)}</span>
        </div>
      ) : (
        <div className="text-gray-600">Goalie — no flex multiplier</div>
      )}
      {unusedFlagged.length > 0 && (
        <div className="text-[10px] text-amber-700 mt-1">
          Note: your league has no {unusedFlagged.join("/")} slots.
        </div>
      )}
      <div className="mt-1 flex justify-between">
        <span className="text-gray-600">
          Base value: {baseValue.toFixed(1)}
          {rank !== null && (
            <span className="ml-3">League Ranking: {rank} / {totalPlayers}</span>
          )}
        </span>
        <span className="font-semibold">Adjusted: {adjValue.toFixed(1)}</span>
      </div>
    </div>
  );
}

// ============================================================
// TIER-GATED UI
// ============================================================

function ProNav() {
  const links: { href: string; label: string }[] = [
    { href: "/settings", label: "Settings" },
    { href: "/history",  label: "History"  },
    { href: "/nhl",      label: "NHL"      },
    { href: "/nfl",      label: "NFL"      },
  ];
  return (
    <nav className="bg-gray-900 text-white px-6 py-2.5 flex items-center gap-6 text-sm">
      <span className="font-semibold text-gray-400 text-xs tracking-widest uppercase mr-2">
        Trade Analyzer
      </span>
      {links.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className="text-gray-200 hover:text-white transition-colors"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function UpgradeBanner() {
  return (
    <div className="mb-5 flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-xs text-gray-500">
      <span>💡 Save your settings and trade history —</span>
      <a href="#" className="font-medium text-blue-600 hover:underline">
        upgrade to Pro
      </a>
    </div>
  );
}

function HistoryRow({ entry, onDelete }: { entry: HistoryEntry; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const date = new Date(entry.savedAt);
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const scoreBg =
    entry.score >= 60 ? "bg-green-50 border-green-200" :
    entry.score <= 40 ? "bg-red-50 border-red-200" :
    "bg-gray-50 border-gray-200";

  const sendSummary = [
    ...entry.sendPlayerNames,
    ...(entry.sendPicks ? entry.sendPicks.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) : []),
  ].join(", ") || "—";

  const recvSummary = [
    ...entry.recvPlayerNames,
    ...(entry.recvPicks ? entry.recvPicks.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) : []),
  ].join(", ") || "—";

  return (
    <div className={`border rounded-xl text-xs ${scoreBg}`}>
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-gray-400 shrink-0">{dateStr} {timeStr}</span>
          {entry.leagueName && (
            <span className="text-gray-500 shrink-0 font-medium">{entry.leagueName}</span>
          )}
          <span className="text-gray-600 truncate hidden sm:block">
            {sendSummary} → {recvSummary}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="font-semibold">{entry.score.toFixed(1)} / 100</span>
          <button
            className="text-red-400 hover:text-red-600 px-1"
            onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
            title="Remove"
          >
            ×
          </button>
          <span className="text-gray-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-inherit pt-2 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-semibold text-gray-700 mb-1">You Gave</div>
              {entry.sendPlayerNames.length > 0 && (
                <div className="mb-1">{entry.sendPlayerNames.join(", ")}</div>
              )}
              {entry.sendPicks && (
                <div className="text-gray-500">Picks: {entry.sendPicks}</div>
              )}
              <div className="text-gray-600 mt-1">Value: <span className="font-medium">{entry.sendValue.toFixed(1)}</span></div>
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-1">You Got</div>
              {entry.recvPlayerNames.length > 0 && (
                <div className="mb-1">{entry.recvPlayerNames.join(", ")}</div>
              )}
              {entry.recvPicks && (
                <div className="text-gray-500">Picks: {entry.recvPicks}</div>
              )}
              <div className="text-gray-600 mt-1">Value: <span className="font-medium">{entry.recvValue.toFixed(1)}</span></div>
            </div>
          </div>
          <div className="text-gray-700 italic">{entry.verdict}</div>
        </div>
      )}
    </div>
  );
}
