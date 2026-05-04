"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useLeagueContext } from "@/lib/league-context";
import {
  type HitterStatKey,
  type PitcherStatKey,
  type HitterWeights,
  type PitcherWeights,
  type CategoryConfig,
  type LeagueFormat,
  type MlbRosterKey,
  type MlbRoster,
  type MlbLeague,
  HITTER_STATS,
  PITCHER_STATS,
  emptyHitterWeights,
  emptyPitcherWeights,
  emptyHitterCategories,
  emptyPitcherCategories,
  presetForFormat,
  DEFAULT_MLB_LEAGUE,
} from "@/lib/mlb-types";

/**
 * Fantasy MLB Trade Analyzer
 *  - statsapi.mlb.com integration (hitting + pitching stats)
 *  - Three league formats: 5x5 Roto, OBP Roto, Points
 *  - Roto mode: z-score valuation across chosen categories
 *  - Points mode: weighted projected-season value
 *  - Position scarcity multipliers (C highest, 2B moderate, etc.)
 *  - Age curve multiplier for keeper leagues
 *  - Closer inflation warning badge
 *  - Data modes: This Year Total/Proj, Last Year Total/Proj
 */

// ============================================================
// PERSISTENCE – localStorage helpers
// ============================================================

const LS_CURRENT  = "fta-mlb-current-league";
const LS_PROFILES = "fta-mlb-saved-profiles";
const LS_HISTORY  = "fta-mlb-trade-history";
const LS_DATA_MODE = "fta-mlb-data-mode";
const MAX_HISTORY = 50;

type SavedProfile = { name: string; savedAt: string; league: MlbLeague };

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

function loadCurrentLeague(): MlbLeague | null {
  try {
    const raw = localStorage.getItem(LS_CURRENT);
    return raw ? (JSON.parse(raw) as MlbLeague) : null;
  } catch { return null; }
}
function saveCurrentLeague(league: MlbLeague) {
  try { localStorage.setItem(LS_CURRENT, JSON.stringify(league)); } catch {}
}
function loadProfiles(): SavedProfile[] {
  try {
    const raw = localStorage.getItem(LS_PROFILES);
    return raw ? (JSON.parse(raw) as SavedProfile[]) : [];
  } catch { return []; }
}
function saveProfiles(profiles: SavedProfile[]) {
  try { localStorage.setItem(LS_PROFILES, JSON.stringify(profiles)); } catch {}
}
function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_HISTORY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch { return []; }
}
function saveHistory(entries: HistoryEntry[]) {
  try { localStorage.setItem(LS_HISTORY, JSON.stringify(entries)); } catch {}
}

// ============================================================
// DATA LAYER – MLB API types & player database
// ============================================================

type MlbPlayerStats = Partial<Record<HitterStatKey | PitcherStatKey, number>>;

type MlbDbPlayer = {
  id: number;       // unique: mlbId*10 for hitters, mlbId*10+1 for pitchers
  mlbId: number;
  name: string;
  team: string;
  position: string; // C 1B 2B 3B SS OF DH  /  SP RP
  isPitcher: boolean;
  gamesPlayed: number;
  gamesStarted: number;
  age: number | null;
  isSuspectedCloser: boolean;
  stats: MlbPlayerStats;
};

type TradePlayer = {
  id: number;
  name: string;
  team: string;
  position: string;
  isKeeper: boolean;
};

type ParsedPick = {
  raw: string;
  round: number;
  slot: number;
  year: number | null;
  overall: number;
  error: string | null;
};

type DbStatus  = "loading" | "ready" | "error";
type DataMode  = "thisTotal" | "thisAvg" | "lastTotal" | "lastAvg";
type LeagueRow = { id: string; name: string; sport: string; settings: unknown };

// ── Helpers ────────────────────────────────────────────────────

function asNumber(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function parseRate(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s || s === "-.--" || s === "-.---") return 0;
    return parseFloat(s.startsWith(".") ? "0" + s : s) || 0;
  }
  return 0;
}

function parseIP(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parts = v.split(".");
    const full   = parseInt(parts[0], 10) || 0;
    const thirds = parseInt(parts[1] || "0", 10);
    return full + thirds / 3;
  }
  return 0;
}

function normalizeHitterPosition(abbrev: string, posType: string): string {
  if (abbrev === "LF" || abbrev === "CF" || abbrev === "RF") return "OF";
  if (abbrev === "OF" || posType === "Outfield")              return "OF";
  if (abbrev === "C")                                          return "C";
  if (abbrev === "1B")                                         return "1B";
  if (abbrev === "2B")                                         return "2B";
  if (abbrev === "3B")                                         return "3B";
  if (abbrev === "SS")                                         return "SS";
  if (abbrev === "DH")                                         return "DH";
  if (abbrev === "P"  || posType === "Pitcher")                return "P"; // exclude
  return "";
}

type MlbStatSplit = {
  stat: Record<string, unknown>;
  player: { id: number; fullName: string };
  team: { abbreviation?: string; name?: string };
  position?: { abbreviation?: string; name?: string; type?: string };
};

function buildPlayerDatabase(args: {
  hitters: MlbStatSplit[];
  pitchers: MlbStatSplit[];
  ageMap: Record<number, number>;
}): MlbDbPlayer[] {
  const db: MlbDbPlayer[] = [];
  const seenH = new Set<number>();
  const seenP = new Set<number>();

  for (const split of args.hitters) {
    const mlbId = split.player.id;
    if (!mlbId || seenH.has(mlbId)) continue;
    seenH.add(mlbId);

    const abbrev  = split.position?.abbreviation ?? "";
    const posType = split.position?.type ?? "";
    const position = normalizeHitterPosition(abbrev, posType);
    if (!position || position === "P") continue;

    const s  = split.stat;
    const gp = asNumber(s.gamesPlayed);
    if (gp === 0) continue;

    db.push({
      id: mlbId * 10,
      mlbId,
      name: split.player.fullName,
      team: split.team.abbreviation ?? "",
      position,
      isPitcher: false,
      gamesPlayed: gp,
      gamesStarted: 0,
      age: args.ageMap[mlbId] ?? null,
      isSuspectedCloser: false,
      stats: {
        G:   gp,
        R:   asNumber(s.runs),
        HR:  asNumber(s.homeRuns),
        RBI: asNumber(s.rbi),
        SB:  asNumber(s.stolenBases),
        AVG: parseRate(s.avg),
        OBP: parseRate(s.obp),
        SLG: parseRate(s.slg),
        H:   asNumber(s.hits),
        BB:  asNumber(s.baseOnBalls),
        K:   asNumber(s.strikeOuts),
        XBH: asNumber(s.doubles) + asNumber(s.triples) + asNumber(s.homeRuns),
        TB:  asNumber(s.totalBases),
        CS:  asNumber(s.caughtStealing),
        AB:  asNumber(s.atBats),
      },
    });
  }

  for (const split of args.pitchers) {
    const mlbId = split.player.id;
    if (!mlbId || seenP.has(mlbId)) continue;
    seenP.add(mlbId);

    const s   = split.stat;
    const gp  = asNumber(s.gamesPlayed);
    const gs  = asNumber(s.gamesStarted);
    if (gp === 0) continue;

    const position = gs / Math.max(gp, 1) >= 0.5 ? "SP" : "RP";
    const saves = asNumber(s.saves);
    const ip    = parseIP(s.inningsPitched);
    const hr9   = ip > 0 ? (asNumber(s.homeRuns) * 9) / ip : 0;

    db.push({
      id: mlbId * 10 + 1,
      mlbId,
      name: split.player.fullName,
      team: split.team.abbreviation ?? "",
      position,
      isPitcher: true,
      gamesPlayed: gp,
      gamesStarted: gs,
      age: args.ageMap[mlbId] ?? null,
      isSuspectedCloser: position === "RP" && saves >= 10,
      stats: {
        W:    asNumber(s.wins),
        L:    asNumber(s.losses),
        SV:   saves,
        HLD:  asNumber(s.holds),
        K:    asNumber(s.strikeOuts),
        ERA:  parseRate(s.era),
        WHIP: parseRate(s.whip),
        IP:   ip,
        QS:   asNumber(s.qualityStarts),
        BB:   asNumber(s.baseOnBalls),
        HR9:  hr9,
      },
    });
  }

  return db;
}

// ============================================================
// SEASON NORMALIZATION
// ============================================================

const RATE_HITTER  = new Set<HitterStatKey>(["AVG", "OBP", "SLG"]);
const RATE_PITCHER = new Set<PitcherStatKey>(["ERA", "WHIP", "HR9"]);

function normalizeHitterTo162(player: MlbDbPlayer): MlbDbPlayer {
  if (player.isPitcher || player.gamesPlayed === 0) return player;
  const gp = player.gamesPlayed;
  const stats: MlbPlayerStats = {};
  for (const [k, v] of Object.entries(player.stats) as [string, number | undefined][]) {
    if (v === undefined) continue;
    (stats as Record<string, number>)[k] = RATE_HITTER.has(k as HitterStatKey)
      ? v
      : (v / gp) * 162;
  }
  return { ...player, gamesPlayed: 162, stats };
}

function normalizeSpTo32(player: MlbDbPlayer): MlbDbPlayer {
  if (!player.isPitcher || player.position !== "SP") return player;
  const gs = Math.max(player.gamesStarted, player.gamesPlayed);
  if (gs === 0) return player;
  const stats: MlbPlayerStats = {};
  for (const [k, v] of Object.entries(player.stats) as [string, number | undefined][]) {
    if (v === undefined) continue;
    (stats as Record<string, number>)[k] = RATE_PITCHER.has(k as PitcherStatKey)
      ? v
      : (v / gs) * 32;
  }
  return { ...player, gamesPlayed: 32, gamesStarted: 32, stats };
}

function normalizeRpTo70(player: MlbDbPlayer): MlbDbPlayer {
  if (!player.isPitcher || player.position !== "RP") return player;
  const gp = player.gamesPlayed;
  if (gp === 0) return player;
  const stats: MlbPlayerStats = {};
  for (const [k, v] of Object.entries(player.stats) as [string, number | undefined][]) {
    if (v === undefined) continue;
    (stats as Record<string, number>)[k] = RATE_PITCHER.has(k as PitcherStatKey)
      ? v
      : (v / gp) * 70;
  }
  return { ...player, gamesPlayed: 70, stats };
}

// ============================================================
// MATH HELPERS
// ============================================================

function tanh(x: number): number {
  const e1 = Math.exp(x), e2 = Math.exp(-x);
  return (e1 - e2) / (e1 + e2);
}

function fairnessScore(give: number, get: number): number {
  const TAU   = 0.65;
  const total = give + get;
  if (total === 0) return 50;
  const pctDiff = (get - give) / total;
  return Math.max(0, Math.min(100, 50 + 50 * tanh(pctDiff / TAU)));
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
// POSITION SCARCITY MULTIPLIER
// ============================================================

const POSITION_SCARCITY: Record<string, number> = {
  C:   1.12,
  "1B": 1.00,
  "2B": 1.05,
  "3B": 1.00,
  SS:   1.03,
  OF:   1.00,
  DH:   0.97,
  SP:   1.05,
  RP:   1.00,
};

function positionScarcityMultiplier(position: string): number {
  return POSITION_SCARCITY[position] ?? 1.0;
}

// ============================================================
// AGE CURVE (keeper leagues)
// ============================================================

function ageMultiplier(age: number | null, isKeeperLeague: boolean): number {
  if (!isKeeperLeague || age === null) return 1.0;
  if (age <= 22) return 1.15;
  if (age === 23) return 1.20;
  if (age === 24) return 1.25;
  if (age === 25) return 1.18;
  if (age === 26) return 1.10;
  if (age <= 30) return 1.00;
  if (age >= 36) return 0.80;
  return Math.max(0.80, 1.00 - (age - 30) * 0.04);
}

// ============================================================
// KEEPER MULTIPLIER
// ============================================================

function keeperMultiplier(rank: number | null): number {
  if (rank === null || rank > 150) return 1.0;
  return 1.32 - ((rank - 1) / 149) * 0.32;
}

// ============================================================
// VALUATION – Points mode
// ============================================================

function projectedSeasonValue(
  player: MlbDbPlayer,
  hitterWeights: HitterWeights,
  pitcherWeights: PitcherWeights,
  useRates: boolean
): number {
  if (player.isPitcher) {
    const isSP     = player.position === "SP";
    const gamesBase = Math.max(isSP ? player.gamesStarted : 0, player.gamesPlayed);
    if (gamesBase === 0) return 0;
    const projection = isSP ? 32 : 70;
    let total = 0;
    for (const [stat, weight] of Object.entries(pitcherWeights)) {
      if (!weight) continue;
      const value   = player.stats[stat as PitcherStatKey] ?? 0;
      const isRate  = RATE_PITCHER.has(stat as PitcherStatKey);
      if (!useRates) {
        total += value * weight;
      } else if (isRate) {
        total += value * weight;
      } else {
        total += (value / gamesBase) * projection * weight;
      }
    }
    return total;
  } else {
    const gp = player.gamesPlayed;
    if (gp === 0) return 0;
    const projection = 162;
    let total = 0;
    for (const [stat, weight] of Object.entries(hitterWeights)) {
      if (!weight) continue;
      const value  = player.stats[stat as HitterStatKey] ?? 0;
      const isRate = RATE_HITTER.has(stat as HitterStatKey);
      if (!useRates) {
        total += value * weight;
      } else if (isRate) {
        total += value * weight;
      } else {
        total += (value / gp) * projection * weight;
      }
    }
    return total;
  }
}

// ============================================================
// VALUATION – Z-score roto mode
// ============================================================

type StatPoolStats  = { mean: number; stddev: number; avgVolume?: number };
type MlbPoolStats   = {
  hitterStats:  Record<HitterStatKey,  StatPoolStats>;
  pitcherStats: Record<PitcherStatKey, StatPoolStats>;
};

// Volume-weighted pitcher rate stats — longer stints count more than short ones.
const VOL_PITCHER_RATES = new Set<PitcherStatKey>(["ERA", "WHIP"]);

function _meanStddev(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 1 };
  const mean     = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) || 1 };
}

function computeMlbPoolStats(
  playerDb: MlbDbPlayer[],
  teams: number,
  roster: MlbRoster,
  hitterStats: HitterStatKey[],
  pitcherStats: PitcherStatKey[],
  useRates: boolean
): MlbPoolStats {
  const hitters  = playerDb.filter((p) => !p.isPitcher && p.gamesPlayed > 0);
  const pitchers = playerDb.filter((p) =>  p.isPitcher && p.gamesPlayed > 0);

  const hitterSlots  = (["C", "1B", "2B", "3B", "SS", "OF", "UTIL"] as MlbRosterKey[])
    .reduce((s, k) => s + (roster[k] || 0), 0);
  const pitcherSlots = (["SP", "RP", "P"] as MlbRosterKey[])
    .reduce((s, k) => s + (roster[k] || 0), 0);

  const hitterN  = Math.max(100, teams * hitterSlots);
  const pitcherN = Math.max(40,  teams * pitcherSlots);

  // Sort by playing-time proxies
  const topHitters  = [...hitters]
    .sort((a, b) => (b.stats.AB || 0) - (a.stats.AB || 0))
    .slice(0, hitterN);
  const topPitchers = [...pitchers]
    .sort((a, b) => (b.stats.IP || 0) - (a.stats.IP || 0))
    .slice(0, pitcherN);

  const hitterPoolStats  = {} as Record<HitterStatKey,  StatPoolStats>;
  const pitcherPoolStats = {} as Record<PitcherStatKey, StatPoolStats>;

  for (const stat of hitterStats) {
    const values = topHitters.map((p) => {
      const raw = p.stats[stat] ?? 0;
      if (!useRates || RATE_HITTER.has(stat)) return raw;
      return raw / (p.gamesPlayed || 1);
    });
    hitterPoolStats[stat] = _meanStddev(values);
  }

  for (const stat of pitcherStats) {
    if (useRates && VOL_PITCHER_RATES.has(stat)) {
      const values  = topPitchers.map((p) => p.stats[stat] ?? 0);
      const volumes = topPitchers.map((p) => p.stats.IP ?? 0);
      const { mean, stddev } = _meanStddev(values);
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / (volumes.length || 1);
      pitcherPoolStats[stat] = { mean, stddev, avgVolume };
    } else if (useRates && RATE_PITCHER.has(stat)) {
      const values = topPitchers.map((p) => p.stats[stat] ?? 0);
      pitcherPoolStats[stat] = _meanStddev(values);
    } else if (useRates) {
      const values = topPitchers.map((p) => {
        const gp = p.gamesPlayed || 1;
        return (p.stats[stat] ?? 0) / gp;
      });
      pitcherPoolStats[stat] = _meanStddev(values);
    } else {
      const values = topPitchers.map((p) => p.stats[stat] ?? 0);
      pitcherPoolStats[stat] = _meanStddev(values);
    }
  }

  return { hitterStats: hitterPoolStats, pitcherStats: pitcherPoolStats };
}

function _hitterZ(
  player: MlbDbPlayer, stat: HitterStatKey,
  ps: StatPoolStats, useRates: boolean
): number {
  if (ps.stddev === 0) return 0;
  const raw   = player.stats[stat] ?? 0;
  const value = (!useRates || RATE_HITTER.has(stat))
    ? raw
    : raw / (player.gamesPlayed || 1);
  return (value - ps.mean) / ps.stddev;
}

function _pitcherZ(
  player: MlbDbPlayer, stat: PitcherStatKey,
  ps: StatPoolStats, useRates: boolean
): number {
  if (ps.stddev === 0) return 0;
  const raw = player.stats[stat] ?? 0;
  if (!useRates) return (raw - ps.mean) / ps.stddev;
  if (VOL_PITCHER_RATES.has(stat) && ps.avgVolume !== undefined && ps.avgVolume > 0) {
    const ip = player.stats.IP ?? 0;
    return (raw - ps.mean) * (ip / ps.avgVolume) / ps.stddev;
  }
  // Other rate stats or counting stats divided by games
  const value = RATE_PITCHER.has(stat) ? raw : raw / (player.gamesPlayed || 1);
  return (value - ps.mean) / ps.stddev;
}

function mlbZScoreValue(
  player: MlbDbPlayer,
  hitterCategories:  Record<HitterStatKey,  CategoryConfig | null>,
  pitcherCategories: Record<PitcherStatKey, CategoryConfig | null>,
  poolStats:   MlbPoolStats,
  hitterStats: HitterStatKey[],
  pitcherStats: PitcherStatKey[],
  useRates: boolean
): number {
  if (player.gamesPlayed === 0) return 0;
  let total = 0;
  if (player.isPitcher) {
    for (const stat of pitcherStats) {
      const cfg = pitcherCategories[stat];
      if (!cfg || !poolStats.pitcherStats[stat]) continue;
      const z = _pitcherZ(player, stat, poolStats.pitcherStats[stat], useRates);
      total += cfg.direction === "less" ? -z : z;
    }
  } else {
    for (const stat of hitterStats) {
      const cfg = hitterCategories[stat];
      if (!cfg || !poolStats.hitterStats[stat]) continue;
      const z = _hitterZ(player, stat, poolStats.hitterStats[stat], useRates);
      total += cfg.direction === "less" ? -z : z;
    }
  }
  return total;
}

// ============================================================
// PICK VALUATION
// ============================================================

function parsePicks(text: string, teams: number): ParsedPick[] {
  if (!text.trim()) return [];
  const tokens = text.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  return tokens.map((raw): ParsedPick => {
    const yearMatch = raw.match(/^(\d{4})\s+(.+)$/);
    let year: number | null = null;
    let core = raw;
    if (yearMatch) { year = parseInt(yearMatch[1], 10); core = yearMatch[2]; }
    const pickMatch = core.match(/^(\d+)\.(\d+)$/);
    if (!pickMatch) {
      return { raw, round: 0, slot: 0, year, overall: 0, error: "Invalid format. Use round.slot (e.g., 1.01)" };
    }
    const round = parseInt(pickMatch[1], 10);
    const slot  = parseInt(pickMatch[2], 10);
    if (round < 1) return { raw, round, slot, year, overall: 0, error: "Round must be 1 or higher" };
    if (slot < 1 || slot > teams) return { raw, round, slot, year, overall: 0, error: `Slot must be between 1 and ${teams}` };
    return { raw, round, slot, year, overall: (round - 1) * teams + slot, error: null };
  });
}

function buildTalentRanking(
  playerDb: MlbDbPlayer[],
  league: MlbLeague,
  poolStats: MlbPoolStats | null,
  useRates: boolean
): number[] {
  return playerDb
    .map((p) => {
      if (league.format !== "points" && poolStats) {
        return mlbZScoreValue(
          p, league.hitterCategories, league.pitcherCategories,
          poolStats, HITTER_STATS, PITCHER_STATS, useRates
        );
      }
      return projectedSeasonValue(p, league.hitterWeights, league.pitcherWeights, useRates);
    })
    .sort((a, b) => b - a);
}

function valueForPick(
  pick: ParsedPick, talentRanking: number[], teams: number, keepersPerTeam: number
): number {
  if (pick.error) return 0;
  const keeperOffset = teams * keepersPerTeam;
  const idx = keeperOffset + pick.overall - 1;
  if (idx < 0) return 0;
  if (idx >= talentRanking.length) {
    const fallback = talentRanking[talentRanking.length - 1] || 0;
    return Math.min(fallback, fallback * 1.075);
  }
  const playerValue = talentRanking[idx] || 0;
  return Math.min(playerValue, playerValue * 1.075);
}

// DEFAULT_MLB_LEAGUE is imported as DEFAULT_MLB_LEAGUE from @/lib/mlb-types

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function MlbTradeAnalyzer() {
  const { user, isLoaded: clerkLoaded } = useUser();
  const tier    = (user?.publicMetadata?.tier as string) ?? "free";
  const isPro   = tier === "tier1" || tier === "tier2";
  const isTier2 = tier === "tier2";
  const { selectedLeagueId: ctxLeagueIds } = useLeagueContext();

  const [league, setLeague] = useState<MlbLeague>(() => {
    const saved = loadCurrentLeague();
    if (!saved) return DEFAULT_MLB_LEAGUE;
    return {
      ...DEFAULT_MLB_LEAGUE,
      ...saved,
      format: saved.format ?? "5x5",
      hitterCategories:  saved.hitterCategories
        ? { ...DEFAULT_MLB_LEAGUE.hitterCategories,  ...saved.hitterCategories  }
        : emptyHitterCategories(),
      pitcherCategories: saved.pitcherCategories
        ? { ...DEFAULT_MLB_LEAGUE.pitcherCategories, ...saved.pitcherCategories }
        : emptyPitcherCategories(),
    };
  });

  const [profiles,   setProfiles]   = useState<SavedProfile[]>(() => loadProfiles());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saved">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [dataMode, setDataMode] = useState<DataMode>(() => {
    try { return (localStorage.getItem(LS_DATA_MODE) as DataMode) || "thisTotal"; }
    catch { return "thisTotal"; }
  });

  const [currentSeasonDb,  setCurrentSeasonDb]  = useState<MlbDbPlayer[]>([]);
  const [priorSeasonDb,    setPriorSeasonDb]    = useState<MlbDbPlayer[]>([]);
  const [currentSeasonYear, setCurrentSeasonYear] = useState<number>(0);
  const [priorSeasonYear,   setPriorSeasonYear]   = useState<number>(0);
  const [dbStatus, setDbStatus] = useState<DbStatus>("loading");

  const [t2Leagues,      setT2Leagues]      = useState<LeagueRow[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [currentLeagueId, setCurrentLeagueId] = useState<string | null>(null);

  // ── Fetch both seasons ────────────────────────────────────────
  useEffect(() => {
    type SeasonPayload = {
      season: number;
      hitters:  MlbStatSplit[];
      pitchers: MlbStatSplit[];
      ageMap: Record<number, number>;
    };
    let cancelled = false;
    fetch("/api/mlb?endpoint=all-seasons")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(({ currentSeason, priorSeason }: { currentSeason: SeasonPayload; priorSeason: SeasonPayload }) => {
        if (cancelled) return;
        const curDb = buildPlayerDatabase(currentSeason);
        const priDb = buildPlayerDatabase(priorSeason);
        setCurrentSeasonDb(curDb);
        setPriorSeasonDb(priDb);
        setCurrentSeasonYear(currentSeason.season);
        setPriorSeasonYear(priorSeason.season);
        // Auto-detect sparse season → default to last year
        const savedMode = (() => { try { return localStorage.getItem(LS_DATA_MODE); } catch { return null; } })();
        if (!savedMode) {
          const significant = currentSeason.hitters.filter(
            (s) => asNumber(s.stat.gamesPlayed) >= 15
          ).length;
          if (significant < 50) setDataMode("lastTotal");
        }
        setDbStatus("ready");
      })
      .catch(() => { if (!cancelled) setDbStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LS_DATA_MODE, dataMode); } catch {}
  }, [dataMode]);

  // ── Active player database ────────────────────────────────────
  const playerDb = useMemo(() => {
    const base = (dataMode === "thisTotal" || dataMode === "thisAvg")
      ? currentSeasonDb : priorSeasonDb;
    if (dataMode === "thisAvg" || dataMode === "lastAvg") {
      return base.map((p) => {
        if (!p.isPitcher) return normalizeHitterTo162(p);
        if (p.position === "SP") return normalizeSpTo32(p);
        return normalizeRpTo70(p);
      });
    }
    return base;
  }, [dataMode, currentSeasonDb, priorSeasonDb]);

  // ── Auto-save league (free users) ─────────────────────────────
  useEffect(() => {
    if (isPro) return;
    saveCurrentLeague(league);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saved");
    saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
  }, [league, isPro]);

  const applyLeagueSettings = useCallback((settings: MlbLeague) => {
    setLeague({
      ...DEFAULT_MLB_LEAGUE,
      ...settings,
      format: settings.format ?? "5x5",
      hitterCategories:  settings.hitterCategories
        ? { ...DEFAULT_MLB_LEAGUE.hitterCategories,  ...settings.hitterCategories  }
        : emptyHitterCategories(),
      pitcherCategories: settings.pitcherCategories
        ? { ...DEFAULT_MLB_LEAGUE.pitcherCategories, ...settings.pitcherCategories }
        : emptyPitcherCategories(),
    });
  }, []);

  // ── Pro: load leagues from Supabase ───────────────────────────
  useEffect(() => {
    if (!clerkLoaded || !isPro) return;
    let cancelled = false;
    fetch("/api/leagues?sport=mlb")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data: LeagueRow[] } | null) => {
        if (cancelled) return;
        const rows = json?.data ?? [];
        if (isTier2) {
          setT2Leagues(rows);
          const ctxId = ctxLeagueIds["mlb"];
          const target = rows.find((r) => r.id === ctxId)?.id ?? rows[0]?.id ?? null;
          setActiveLeagueId(target);
          setCurrentLeagueId(target);
        } else {
          const settings = rows[0]?.settings;
          if (settings) applyLeagueSettings(settings as MlbLeague);
          setCurrentLeagueId(rows[0]?.id ?? null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isPro, isTier2, clerkLoaded, applyLeagueSettings]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isTier2 || !activeLeagueId || t2Leagues.length === 0) return;
    const row = t2Leagues.find((r) => r.id === activeLeagueId);
    if (row?.settings) applyLeagueSettings(row.settings as MlbLeague);
    setCurrentLeagueId(activeLeagueId);
  }, [isTier2, activeLeagueId, t2Leagues, applyLeagueSettings]);

  const [history,     setHistory]     = useState<HistoryEntry[]>(() => loadHistory());
  const [sendPlayers, setSendPlayers] = useState<TradePlayer[]>([]);
  const [recvPlayers, setRecvPlayers] = useState<TradePlayer[]>([]);
  const [sendPicks,   setSendPicks]   = useState("");
  const [recvPicks,   setRecvPicks]   = useState("");

  const useRates   = dataMode === "thisAvg" || dataMode === "lastAvg";
  const isRotoMode = league.format !== "points";

  // ── Pool stats for roto z-score ───────────────────────────────
  const poolStats = useMemo(() => {
    if (playerDb.length === 0 || !isRotoMode) return null;
    return computeMlbPoolStats(
      playerDb, league.teams, league.roster, HITTER_STATS, PITCHER_STATS, useRates
    );
  }, [playerDb, league.teams, league.roster, useRates, isRotoMode]);

  // ── Talent ranking for pick valuation ─────────────────────────
  const talentRanking = useMemo(() => {
    if (playerDb.length === 0) return [];
    return buildTalentRanking(playerDb, league, poolStats, useRates);
  }, [playerDb, league, poolStats, useRates]);

  // ── League ranking map ────────────────────────────────────────
  const rankMap = useMemo(() => {
    const map = new Map<number, number>();
    if (playerDb.length === 0) return map;
    const sorted = [...playerDb].sort((a, b) => {
      const va = isRotoMode && poolStats
        ? mlbZScoreValue(a, league.hitterCategories, league.pitcherCategories, poolStats, HITTER_STATS, PITCHER_STATS, useRates)
        : projectedSeasonValue(a, league.hitterWeights, league.pitcherWeights, useRates);
      const vb = isRotoMode && poolStats
        ? mlbZScoreValue(b, league.hitterCategories, league.pitcherCategories, poolStats, HITTER_STATS, PITCHER_STATS, useRates)
        : projectedSeasonValue(b, league.hitterWeights, league.pitcherWeights, useRates);
      return vb - va || b.gamesPlayed - a.gamesPlayed;
    });
    sorted.forEach((p, i) => map.set(p.id, i + 1));
    return map;
  }, [playerDb, league, poolStats, isRotoMode, useRates]);

  // ── Parsed picks ──────────────────────────────────────────────
  const sendPicksParsed = useMemo(() => parsePicks(sendPicks, league.teams), [sendPicks, league.teams]);
  const recvPicksParsed = useMemo(() => parsePicks(recvPicks, league.teams), [recvPicks, league.teams]);

  // ── Per-player value helper ───────────────────────────────────
  function playerValue(p: TradePlayer, dbEntry: MlbDbPlayer): number {
    const base = isRotoMode && poolStats
      ? mlbZScoreValue(dbEntry, league.hitterCategories, league.pitcherCategories, poolStats, HITTER_STATS, PITCHER_STATS, useRates)
      : projectedSeasonValue(dbEntry, league.hitterWeights, league.pitcherWeights, useRates);
    const scarcity = positionScarcityMultiplier(dbEntry.position);
    const ageMult  = ageMultiplier(dbEntry.age, league.leagueType === "keeper");
    const kMult    = p.isKeeper ? keeperMultiplier(rankMap.get(p.id) ?? null) : 1.0;
    return base * scarcity * (p.isKeeper ? ageMult : 1.0) * kMult;
  }

  const keepersPerTeam = league.leagueType === "keeper" ? league.keepersPerTeam : 0;

  const sendValue = useMemo(() => {
    const playerTotal = sendPlayers.reduce((sum, p) => {
      const dbEntry = playerDb.find((x) => x.id === p.id);
      return dbEntry ? sum + playerValue(p, dbEntry) : sum;
    }, 0);
    const pickTotal = sendPicksParsed.reduce(
      (sum, pk) => sum + valueForPick(pk, talentRanking, league.teams, keepersPerTeam), 0
    );
    return playerTotal + pickTotal;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendPlayers, sendPicksParsed, talentRanking, playerDb, league, poolStats, isRotoMode, useRates, rankMap]);

  const recvValue = useMemo(() => {
    const playerTotal = recvPlayers.reduce((sum, p) => {
      const dbEntry = playerDb.find((x) => x.id === p.id);
      return dbEntry ? sum + playerValue(p, dbEntry) : sum;
    }, 0);
    const pickTotal = recvPicksParsed.reduce(
      (sum, pk) => sum + valueForPick(pk, talentRanking, league.teams, keepersPerTeam), 0
    );
    return playerTotal + pickTotal;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recvPlayers, recvPicksParsed, talentRanking, playerDb, league, poolStats, isRotoMode, useRates, rankMap]);

  const score = useMemo(() => fairnessScore(sendValue, recvValue), [sendValue, recvValue]);

  const offset       = Math.min(0, sendValue, recvValue);
  const adjSend      = sendValue - offset;
  const adjRecv      = recvValue - offset;
  const minVal       = Math.min(adjSend, adjRecv);
  const maxVal       = Math.max(adjSend, adjRecv);
  const tradeRating  = (minVal === 0 || maxVal === 0)
    ? 0
    : Math.min(100, Math.round(100 * Math.exp(-2.5 * (maxVal / minVal - 1)) * 10) / 10);
  const youWin        = recvValue >= sendValue;
  const ratio         = (minVal === 0 || maxVal === 0) ? Infinity : maxVal / minVal;
  const ratioDistance = Math.min(50, (1 - Math.exp(-2.5 * (ratio - 1))) * 50);
  const displayScore  = youWin ? 50 + ratioDistance : 50 - ratioDistance;
  const safeScore     = isNaN(displayScore) ? 50 : displayScore;

  function tradeRatingLabel(r: number) {
    if (r >= 90) return "Perfect Trade";
    if (r >= 70) return "Excellent Trade";
    if (r >= 60) return "Good Trade";
    if (r >= 41) return "Uneven Trade";
    if (r >= 21) return "Bad Trade";
    return "Severely Lopsided";
  }

  function barColor(ds: number) {
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

  function tradeOutline(ds: number) {
    if (ds <= 10.4) return "Horrific trade, don't do this.";
    if (ds <= 20.4) return "Insanely bad trade.";
    if (ds <= 30.4) return "You really lose this trade.";
    if (ds <= 40.4) return "You lose this trade.";
    if (ds <= 60.4) return "This is in the realm of fairness.";
    if (ds <= 70.4) return "You really win this trade.";
    if (ds <= 80.4) return "Big win for you.";
    if (ds <= 90.4) return "They shouldn't accept this, but if they do, good for you.";
    return "We won't tell, but if they accept this, it's probably collusion.";
  }

  // ── Auto-save to Supabase (Pro users) ────────────────────────
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
        sport: "mlb",
        leagueId: currentLeagueId ?? undefined,
        leagueName: league.name.trim() || "Unnamed League",
        sendPlayerNames: sendPlayers.map((p) => p.name),
        recvPlayerNames: recvPlayers.map((p) => p.name),
        sendPicks: sendPicks.trim(),
        recvPicks: recvPicks.trim(),
        sendValue, recvValue, score,
        verdict: fairnessDescription(score),
      };
      fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      }).then(() => {
        setAutoSaveStatus("saved");
        setTimeout(() => setAutoSaveStatus("idle"), 2000);
      }).catch(() => {});
    }, 5000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [isPro, sendPlayers, recvPlayers, sendPicks, recvPicks, currentLeagueId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Updaters ──────────────────────────────────────────────────
  const updateLeague    = (patch: Partial<MlbLeague>) => setLeague((p) => ({ ...p, ...patch }));
  const updateRoster    = (pos: MlbRosterKey, val: number) =>
    setLeague((p) => ({ ...p, roster: { ...p.roster, [pos]: val } }));
  const updateHitterWeight  = (stat: HitterStatKey,  val: number) =>
    setLeague((p) => ({ ...p, hitterWeights:  { ...p.hitterWeights,  [stat]: val } }));
  const updatePitcherWeight = (stat: PitcherStatKey, val: number) =>
    setLeague((p) => ({ ...p, pitcherWeights: { ...p.pitcherWeights, [stat]: val } }));
  const updateHitterCategory  = (stat: HitterStatKey,  cfg: CategoryConfig | null) =>
    setLeague((p) => ({ ...p, hitterCategories:  { ...p.hitterCategories,  [stat]: cfg } }));
  const updatePitcherCategory = (stat: PitcherStatKey, cfg: CategoryConfig | null) =>
    setLeague((p) => ({ ...p, pitcherCategories: { ...p.pitcherCategories, [stat]: cfg } }));

  function handleFormatChange(newFormat: LeagueFormat) {
    const preset = presetForFormat(newFormat);
    setLeague((p) => ({ ...p, format: newFormat, ...preset }));
  }

  const addPlayer = (side: "send" | "recv", dbEntry: MlbDbPlayer) => {
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    const list   = side === "send" ? sendPlayers   : recvPlayers;
    if (list.find((p) => p.id === dbEntry.id)) return;
    setter([...list, {
      id: dbEntry.id, name: dbEntry.name, team: dbEntry.team,
      position: dbEntry.position, isKeeper: false,
    }]);
  };

  const removePlayer = (side: "send" | "recv", id: number) => {
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    setter((prev) => prev.filter((p) => p.id !== id));
  };

  const toggleKeeper = (side: "send" | "recv", id: number) => {
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    setter((prev) => prev.map((p) => p.id === id ? { ...p, isKeeper: !p.isKeeper } : p));
  };

  const saveToHistory = useCallback(() => {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: new Date().toISOString(),
      sport: "mlb",
      leagueId: currentLeagueId ?? undefined,
      leagueName: league.name.trim() || "Unnamed League",
      sendPlayerNames: sendPlayers.map((p) => p.name),
      recvPlayerNames: recvPlayers.map((p) => p.name),
      sendPicks: sendPicks.trim(), recvPicks: recvPicks.trim(),
      sendValue, recvValue, score, verdict: fairnessDescription(score),
    };
    if (isPro) {
      fetch("/api/trades", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) })
        .catch(() => {});
    } else {
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveHistory(updated);
    }
  }, [isPro, currentLeagueId, league.name, sendPlayers, recvPlayers, sendPicks, recvPicks, sendValue, recvValue, score, history]);

  const deleteHistoryEntry = useCallback((id: string) => {
    const updated = history.filter((e) => e.id !== id);
    setHistory(updated);
    saveHistory(updated);
  }, [history]);

  const saveProfile = useCallback(() => {
    const profileName = league.name.trim() || "Unnamed League";
    const updated = [
      { name: profileName, savedAt: new Date().toISOString(), league },
      ...profiles.filter((p) => p.name !== profileName),
    ];
    setProfiles(updated); saveProfiles(updated);
  }, [league, profiles]);

  const loadProfile  = useCallback((profile: SavedProfile) => setLeague(profile.league), []);
  const deleteProfile = useCallback((name: string) => {
    const updated = profiles.filter((p) => p.name !== name);
    setProfiles(updated); saveProfiles(updated);
  }, [profiles]);

  const hasAnything = sendPlayers.length > 0 || recvPlayers.length > 0 ||
                      sendPicks.trim() !== "" || recvPicks.trim() !== "";
  void hasAnything; void saveProfile; void loadProfile; void deleteProfile;
  void saveStatus; void tradeRatingLabel; void barColor;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <>
      {isPro && <ProNav />}
      {!isPro && (
        <div style={{ background: "#f3f4f6", padding: "0.5rem 1rem", fontSize: "0.75rem", marginBottom: "0.5rem" }}>
          💡 Save your settings and trade history — upgrade to Pro
        </div>
      )}
      <div className="p-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">Fantasy Trade Analyzer (MLB)</h1>
          <MlbApiStatus
            status={dbStatus}
            playerCount={playerDb.length}
            currentSeasonYear={currentSeasonYear}
            priorSeasonYear={priorSeasonYear}
            dataMode={dataMode}
            setDataMode={setDataMode}
          />
        </div>

        {/* Tier 2: league selector */}
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
            <Link href="/settings" className="text-xs text-blue-600 hover:underline whitespace-nowrap">
              + New League
            </Link>
          </div>
        )}

        {/* League Settings + Scoring (hidden for Pro — loaded from Supabase) */}
        {!isPro && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

            {/* League Settings */}
            <div className="border rounded-2xl p-4">
              <h2 className="font-medium mb-2">League Settings</h2>

              <label className="text-sm">League Name (optional)</label>
              <input
                type="text" className="border rounded-xl p-2 w-full mb-2"
                value={league.name} onChange={(e) => updateLeague({ name: e.target.value })}
              />

              <label className="text-sm">Number of Teams</label>
              <input
                type="number" min={2} className="border rounded-xl p-2 w-full mb-2"
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
                    type="number" min={0} className="border rounded-xl p-2 w-full mb-2"
                    value={league.keepersPerTeam}
                    onChange={(e) => updateLeague({ keepersPerTeam: parseInt(e.target.value || "0", 10) })}
                  />
                </>
              )}

              <h3 className="text-sm font-semibold mt-3 mb-2">Roster Slots</h3>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(league.roster) as MlbRosterKey[]).map((pos) => (
                  <label key={pos} className="text-xs flex items-center gap-2">
                    <span className="w-10">{pos}</span>
                    <input
                      type="number" min={0} className="border rounded-xl p-1 w-full"
                      value={league.roster[pos]}
                      onChange={(e) => updateRoster(pos, parseInt(e.target.value || "0", 10))}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Scoring */}
            <div className="border rounded-2xl p-4">
              <h2 className="font-medium mb-2">Scoring Format</h2>

              {/* Format toggle */}
              <div className="flex rounded-xl border overflow-hidden mb-3">
                {(["5x5", "obp", "points"] as LeagueFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    className={`flex-1 py-1.5 text-sm font-medium transition-colors ${
                      league.format === fmt
                        ? "bg-blue-600 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                    onClick={() => handleFormatChange(fmt)}
                  >
                    {fmt === "5x5" ? "5×5 Roto" : fmt === "obp" ? "OBP Roto" : "Points"}
                  </button>
                ))}
              </div>

              {isRotoMode ? (
                <>
                  <p className="text-xs text-gray-500 mb-3">
                    {league.format === "5x5"
                      ? "5×5: R, HR, RBI, SB, AVG (hitting) + W, SV, K, ERA, WHIP (pitching)."
                      : "OBP: same as 5×5 but OBP replaces AVG."}{" "}
                    Check the categories your league uses. Set direction to &ldquo;−&rdquo; for stats where lower is better (ERA, WHIP).
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Hitter categories */}
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Hitters</h3>
                      <div className="space-y-1">
                        {HITTER_STATS.map((stat) => {
                          const cfg = league.hitterCategories[stat];
                          return (
                            <div key={stat} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox" id={`hcat-${stat}`} checked={cfg !== null}
                                onChange={(e) =>
                                  updateHitterCategory(stat, e.target.checked ? { direction: "more" } : null)
                                }
                              />
                              <label htmlFor={`hcat-${stat}`} className="w-10 cursor-pointer text-xs">{stat}</label>
                              {cfg && (
                                <div className="flex rounded-lg border overflow-hidden text-xs">
                                  <button
                                    className={`px-1.5 py-0.5 ${cfg.direction === "more" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                    onClick={() => updateHitterCategory(stat, { direction: "more" })}
                                  >+</button>
                                  <button
                                    className={`px-1.5 py-0.5 ${cfg.direction === "less" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                    onClick={() => updateHitterCategory(stat, { direction: "less" })}
                                  >−</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* Pitcher categories */}
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Pitchers</h3>
                      <div className="space-y-1">
                        {PITCHER_STATS.map((stat) => {
                          const cfg = league.pitcherCategories[stat];
                          return (
                            <div key={stat} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox" id={`pcat-${stat}`} checked={cfg !== null}
                                onChange={(e) =>
                                  updatePitcherCategory(stat, e.target.checked ? { direction: "more" } : null)
                                }
                              />
                              <label htmlFor={`pcat-${stat}`} className="w-10 cursor-pointer text-xs">{stat}</label>
                              {cfg && (
                                <div className="flex rounded-lg border overflow-hidden text-xs">
                                  <button
                                    className={`px-1.5 py-0.5 ${cfg.direction === "more" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                    onClick={() => updatePitcherCategory(stat, { direction: "more" })}
                                  >+</button>
                                  <button
                                    className={`px-1.5 py-0.5 ${cfg.direction === "less" ? "bg-blue-600 text-white" : "text-gray-600 hover:bg-gray-100"}`}
                                    onClick={() => updatePitcherCategory(stat, { direction: "less" })}
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
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-3">
                    Points per stat. Typical: R=1, H=1, HR=4, RBI=1, BB=1, SB=2, K=−1 (hitters);
                    W=5, L=−3, SV=5, HLD=3, K=1, IP=1, QS=3 (pitchers).
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Hitters</h3>
                      <div className="space-y-1">
                        {HITTER_STATS.map((stat) => (
                          <div key={stat} className="flex items-center justify-between gap-2">
                            <label className="text-xs w-10">{stat}</label>
                            <input
                              type="number" step="0.5" className="border rounded-xl p-1 w-full text-xs"
                              value={league.hitterWeights[stat]}
                              onChange={(e) => updateHitterWeight(stat, parseFloat(e.target.value || "0"))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold mb-2">Pitchers</h3>
                      <div className="space-y-1">
                        {PITCHER_STATS.map((stat) => (
                          <div key={stat} className="flex items-center justify-between gap-2">
                            <label className="text-xs w-10">{stat}</label>
                            <input
                              type="number" step="0.5" className="border rounded-xl p-1 w-full text-xs"
                              value={league.pitcherWeights[stat]}
                              onChange={(e) => updatePitcherWeight(stat, parseFloat(e.target.value || "0"))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Trade sides */}
        <div className="border rounded-2xl p-4 mb-6">
          <h2 className="font-medium mb-3">Trade</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MlbTradeSide
              label="You Give"
              players={sendPlayers}
              picks={sendPicks}
              setPicks={setSendPicks}
              parsedPicks={sendPicksParsed}
              talentRanking={talentRanking}
              teams={league.teams}
              keepersPerTeam={keepersPerTeam}
              playerDb={playerDb}
              dbStatus={dbStatus}
              isKeeperLeague={league.leagueType === "keeper"}
              rankMap={rankMap}
              poolStats={poolStats}
              isRotoMode={isRotoMode}
              hitterCategories={league.hitterCategories}
              pitcherCategories={league.pitcherCategories}
              hitterWeights={league.hitterWeights}
              pitcherWeights={league.pitcherWeights}
              useRates={useRates}
              onAdd={(p) => addPlayer("send", p)}
              onRemove={(id) => removePlayer("send", id)}
              onToggleKeeper={(id) => toggleKeeper("send", id)}
            />
            <MlbTradeSide
              label="You Get"
              players={recvPlayers}
              picks={recvPicks}
              setPicks={setRecvPicks}
              parsedPicks={recvPicksParsed}
              talentRanking={talentRanking}
              teams={league.teams}
              keepersPerTeam={keepersPerTeam}
              playerDb={playerDb}
              dbStatus={dbStatus}
              isKeeperLeague={league.leagueType === "keeper"}
              rankMap={rankMap}
              poolStats={poolStats}
              isRotoMode={isRotoMode}
              hitterCategories={league.hitterCategories}
              pitcherCategories={league.pitcherCategories}
              hitterWeights={league.hitterWeights}
              pitcherWeights={league.pitcherWeights}
              useRates={useRates}
              onAdd={(p) => addPlayer("recv", p)}
              onRemove={(id) => removePlayer("recv", id)}
              onToggleKeeper={(id) => toggleKeeper("recv", id)}
            />
          </div>
        </div>

        {/* Fairness result */}
        <div className="border rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Fairness Result</h2>
            {isPro && autoSaveStatus === "saved" && (
              <span className="text-xs text-green-600">✓ Auto-saved</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-4 mb-3">
            <div>
              <div className="text-xs text-gray-600">
                {isRotoMode ? "You Give (z-score)" : "You Give (proj pts)"}
              </div>
              <div className="text-lg font-semibold">
                {isRotoMode ? sendValue.toFixed(2) : sendValue.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">
                {isRotoMode ? "You Get (z-score)" : "You Get (proj pts)"}
              </div>
              <div className="text-lg font-semibold">
                {isRotoMode ? recvValue.toFixed(2) : recvValue.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Trade Rating</div>
              <div className="text-lg font-semibold">{tradeRating.toFixed(1)} / 100</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Trade Outline</div>
              {(sendValue !== 0 || recvValue !== 0) && (
                <div className="text-sm font-medium text-gray-800">{tradeOutline(safeScore)}</div>
              )}
            </div>
          </div>

          {/* Fairness scale bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Opponent Wins</span>
              <span className="font-medium text-gray-600">Fairness Scale</span>
              <span>You Win</span>
            </div>
            <div className="relative h-3 rounded-full overflow-hidden flex">
              <div style={{ width: "10.5%", background: "#000000" }} />
              <div style={{ width: "10%",   background: "#cc0000" }} />
              <div style={{ width: "10%",   background: "#ff6600" }} />
              <div style={{ width: "10%",   background: "#ffcc00" }} />
              <div style={{ width: "19%",   background: "#33aa33" }} />
              <div style={{ width: "10%",   background: "#ffcc00" }} />
              <div style={{ width: "10%",   background: "#ff6600" }} />
              <div style={{ width: "10%",   background: "#cc0000" }} />
              <div style={{ width: "10.5%", background: "#000000" }} />
              <div
                className="absolute top-0 h-full w-1 -translate-x-1/2 bg-white shadow pointer-events-none"
                style={{ left: `${safeScore}%` }}
              />
            </div>
          </div>

          {(sendValue === 0 && recvValue === 0) && (
            <div className="text-xs text-amber-700 mt-2">
              {isRotoMode
                ? "All values are 0 — make sure you've selected at least one category and added players."
                : "All values are 0 — make sure you've set scoring weights and added players."}
            </div>
          )}

          {(sendValue !== 0 || recvValue !== 0) && (
            <button
              className="mt-3 text-xs border rounded-lg px-3 py-1 hover:bg-gray-50 transition-colors"
              onClick={saveToHistory}
            >
              Save to History
            </button>
          )}
        </div>

        {/* Trade History (free users) */}
        {!isPro && history.length > 0 && (
          <div className="border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium">Trade History</h2>
              <button
                className="text-xs text-red-500 hover:text-red-700"
                onClick={() => { setHistory([]); saveHistory([]); }}
              >
                Clear All
              </button>
            </div>
            <div className="space-y-2">
              {history.map((e) => (
                <MlbHistoryRow key={e.id} entry={e} onDelete={deleteHistoryEntry} />
              ))}
            </div>
          </div>
        )}

      </div>
    </>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function MlbApiStatus({
  status, playerCount, currentSeasonYear, priorSeasonYear, dataMode, setDataMode,
}: {
  status: DbStatus;
  playerCount: number;
  currentSeasonYear: number;
  priorSeasonYear: number;
  dataMode: DataMode;
  setDataMode: (m: DataMode) => void;
}) {
  if (status === "loading") return <div className="text-xs text-gray-500">Loading MLB data…</div>;
  if (status === "error")   return <div className="text-xs text-red-600">MLB API unavailable — please refresh</div>;
  const activeYear = (dataMode === "thisTotal" || dataMode === "thisAvg")
    ? currentSeasonYear : priorSeasonYear;
  return (
    <div className="text-xs text-gray-600 text-right flex items-center gap-3">
      <div>
        <div>{playerCount} players loaded</div>
        {activeYear > 0 && <div>Season: {activeYear}</div>}
      </div>
      <select
        className="border rounded-lg px-2 py-1 text-xs text-gray-700 bg-white"
        value={dataMode}
        onChange={(e) => setDataMode(e.target.value as DataMode)}
      >
        <option value="thisTotal">This Year – Total</option>
        <option value="thisAvg">This Year – Projected</option>
        <option value="lastTotal">Last Year – Total</option>
        <option value="lastAvg">Last Year – Projected</option>
      </select>
    </div>
  );
}

type MlbTradeSideProps = {
  label: string;
  players: TradePlayer[];
  picks: string;
  setPicks: (v: string) => void;
  parsedPicks: ParsedPick[];
  talentRanking: number[];
  teams: number;
  keepersPerTeam: number;
  playerDb: MlbDbPlayer[];
  dbStatus: DbStatus;
  isKeeperLeague: boolean;
  rankMap: Map<number, number>;
  poolStats: MlbPoolStats | null;
  isRotoMode: boolean;
  hitterCategories:  Record<HitterStatKey,  CategoryConfig | null>;
  pitcherCategories: Record<PitcherStatKey, CategoryConfig | null>;
  hitterWeights:  HitterWeights;
  pitcherWeights: PitcherWeights;
  useRates: boolean;
  onAdd: (p: MlbDbPlayer) => void;
  onRemove: (id: number) => void;
  onToggleKeeper: (id: number) => void;
};

function MlbTradeSide({
  label, players, picks, setPicks, parsedPicks, talentRanking, teams, keepersPerTeam,
  playerDb, dbStatus, isKeeperLeague, rankMap,
  poolStats, isRotoMode, hitterCategories, pitcherCategories,
  hitterWeights, pitcherWeights, useRates,
  onAdd, onRemove, onToggleKeeper,
}: MlbTradeSideProps) {

  // Check if any player is a suspected closer — show blanket warning
  const hasCloser = players.some((p) => {
    const db = playerDb.find((x) => x.id === p.id);
    return db?.isSuspectedCloser;
  });

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{label} — Players</h3>

      {hasCloser && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-800">
          <span className="text-base leading-none">⚠️</span>
          <span>
            <strong>Closer inflation:</strong> Saves are scarce and visible, but closers contribute to very few other categories. Make sure you&apos;re not overpaying.
          </span>
        </div>
      )}

      <MlbPlayerTypeahead playerDb={playerDb} dbStatus={dbStatus} existingIds={players.map((p) => p.id)} onSelect={onAdd} />

      <div className="mt-2 space-y-2">
        {players.map((p) => {
          const dbEntry = playerDb.find((x) => x.id === p.id);
          if (!dbEntry) return null;
          const base = isRotoMode && poolStats
            ? mlbZScoreValue(dbEntry, hitterCategories, pitcherCategories, poolStats, HITTER_STATS, PITCHER_STATS, useRates)
            : projectedSeasonValue(dbEntry, hitterWeights, pitcherWeights, useRates);
          const scarcity = positionScarcityMultiplier(dbEntry.position);
          const ageMult  = ageMultiplier(dbEntry.age, isKeeperLeague);
          const kMult    = p.isKeeper ? keeperMultiplier(rankMap.get(p.id) ?? null) : 1.0;
          const adjusted = base * scarcity * (p.isKeeper ? ageMult : 1.0) * kMult;
          const rank     = rankMap.get(p.id) ?? null;

          // Warnings
          const isEarlySeason = !dbEntry.isPitcher
            ? dbEntry.gamesPlayed < 15
            : dbEntry.position === "SP"
              ? dbEntry.gamesStarted < 5
              : dbEntry.gamesPlayed < 10;

          return (
            <div key={p.id} className="border rounded-xl p-2 bg-gray-50 text-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-gray-500">{dbEntry.team}</span>
                  {/* Position badge with scarcity indicator */}
                  <span className={`border rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    p.position === "C"  ? "border-purple-400 text-purple-700 bg-purple-50" :
                    p.position === "2B" ? "border-blue-400 text-blue-700 bg-blue-50" :
                    "border-gray-300 text-gray-600"
                  }`}>
                    {p.position}
                    {(p.position === "C") && " ★"}
                  </span>
                  {/* Closer warning badge */}
                  {dbEntry.isSuspectedCloser && (
                    <span className="border border-yellow-400 bg-yellow-50 text-yellow-700 rounded-full px-1.5 py-0.5 text-[10px]">
                      Closer
                    </span>
                  )}
                  {/* Age badge */}
                  {dbEntry.age !== null && (
                    <span className="text-gray-400 text-[10px]">Age {dbEntry.age}</span>
                  )}
                </div>
                <button className="text-red-600 hover:text-red-800 px-2" onClick={() => onRemove(p.id)} title="Remove">×</button>
              </div>

              <div className="text-gray-500 mb-1">
                {dbEntry.isPitcher
                  ? `${dbEntry.gamesPlayed} G${dbEntry.position === "SP" ? ` · ${dbEntry.gamesStarted} GS` : ""}`
                  : `${dbEntry.gamesPlayed} G`}
                {" · "}scarcity ×{scarcity.toFixed(2)}
              </div>

              {isEarlySeason && (
                <div className="text-[10px] text-amber-700 mb-1">
                  ⚠ Small sample — fewer than {dbEntry.isPitcher && dbEntry.position === "SP" ? "5 starts" : "15 games"} played.
                </div>
              )}

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={p.isKeeper} onChange={() => onToggleKeeper(p.id)} />
                  <span className="text-gray-600">Keeper</span>
                </label>
                {p.isKeeper && (
                  <span className="text-blue-600">
                    rank ×{kMult.toFixed(2)}
                    {isKeeperLeague && dbEntry.age !== null && ` · age ×${ageMult.toFixed(2)}`}
                  </span>
                )}
              </div>

              <div className="mt-1 flex justify-between">
                <span className="text-gray-600">
                  {isRotoMode ? "z-score" : "Base"}: {isRotoMode ? base.toFixed(2) : base.toFixed(1)}
                  {rank !== null && <span className="ml-3">Rank: {rank} / {playerDb.length}</span>}
                </span>
                <span className="font-semibold">Adjusted: {isRotoMode ? adjusted.toFixed(2) : adjusted.toFixed(1)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="text-sm font-semibold mt-4 mb-1">{label} — Picks</h3>
      <p className="text-xs text-gray-600 mb-1">
        Enter as <span className="font-mono">round.slot</span> (e.g. <span className="font-mono">1.01</span>).
        Optionally prefix with year: <span className="font-mono">2027 1.01</span>.
      </p>
      <textarea
        className="border rounded-xl p-2 w-full h-14 text-sm"
        placeholder="1.01, 2.05"
        value={picks}
        onChange={(e) => setPicks(e.target.value)}
      />
      <MlbParsedPicksList parsedPicks={parsedPicks} talentRanking={talentRanking} teams={teams} keepersPerTeam={keepersPerTeam} />
    </div>
  );
}

function MlbParsedPicksList({
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
        const value = valueForPick(pk, talentRanking, teams, keepersPerTeam);
        return (
          <div key={idx} className="border rounded-xl p-2 bg-gray-50 text-xs flex justify-between">
            <span className="font-mono font-semibold">
              {pk.year ? `${pk.year} ` : ""}
              {pk.round}.{pk.slot.toString().padStart(2, "0")}
            </span>
            <span className="text-gray-600">
              talent rank {keeperOffset + pk.overall} · value {value.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function MlbPlayerTypeahead({
  playerDb, dbStatus, existingIds, onSelect,
}: {
  playerDb: MlbDbPlayer[];
  dbStatus: DbStatus;
  existingIds: number[];
  onSelect: (p: MlbDbPlayer) => void;
}) {
  const [query,        setQuery]        = useState("");
  const [open,         setOpen]         = useState(false);
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
      .filter((p) => !existingIds.includes(p.id) && p.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const aS = a.name.toLowerCase().startsWith(q) || a.name.toLowerCase().split(" ").some((t) => t.startsWith(q));
        const bS = b.name.toLowerCase().startsWith(q) || b.name.toLowerCase().split(" ").some((t) => t.startsWith(q));
        if (aS && !bS) return -1;
        if (bS && !aS) return 1;
        return (b.stats.AB || b.stats.IP || 0) - (a.stats.AB || a.stats.IP || 0);
      })
      .slice(0, 8);
  }, [query, playerDb, existingIds]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => (i + 1) % matches.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => (i - 1 + matches.length) % matches.length); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const sel = matches[highlightIdx];
      if (sel) { onSelect(sel); setQuery(""); setHighlightIdx(0); }
    } else if (e.key === "Escape") { setOpen(false); }
  };

  const placeholder =
    dbStatus === "loading" ? "Loading players…" :
    dbStatus === "error"   ? "Player data unavailable" :
    "Search for a player…";

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text" className="border rounded-xl p-2 w-full text-sm"
        placeholder={placeholder} value={query} disabled={dbStatus !== "ready"}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlightIdx(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border rounded-xl shadow-lg max-h-64 overflow-auto">
          {matches.map((p, i) => (
            <div
              key={p.id}
              className={`px-3 py-2 text-sm cursor-pointer flex justify-between items-center ${i === highlightIdx ? "bg-blue-50" : "hover:bg-gray-50"}`}
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); onSelect(p); setQuery(""); setHighlightIdx(0); }}
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-gray-500">
                {p.team} · {p.position} · {p.isPitcher
                  ? (p.position === "SP" ? `${p.gamesStarted} GS` : `${p.gamesPlayed} G`)
                  : `${p.gamesPlayed} G`}
                {p.age !== null ? ` · Age ${p.age}` : ""}
                {p.isSuspectedCloser ? " · Closer" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MlbHistoryRow({ entry, onDelete }: { entry: HistoryEntry; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const date    = new Date(entry.savedAt);
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
          {entry.leagueName && <span className="text-gray-500 shrink-0 font-medium">{entry.leagueName}</span>}
          <span className="text-gray-600 truncate hidden sm:block">{sendSummary} → {recvSummary}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="font-semibold">{entry.score.toFixed(1)} / 100</span>
          <button className="text-red-400 hover:text-red-600 px-1" onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }} title="Remove">×</button>
          <span className="text-gray-400">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t border-inherit pt-2 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-semibold text-gray-700 mb-1">You Gave</div>
              {entry.sendPlayerNames.length > 0 && <div className="mb-1">{entry.sendPlayerNames.join(", ")}</div>}
              {entry.sendPicks && <div className="text-gray-500">Picks: {entry.sendPicks}</div>}
              <div className="text-gray-600 mt-1">Value: <span className="font-medium">{entry.sendValue.toFixed(1)}</span></div>
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-1">You Got</div>
              {entry.recvPlayerNames.length > 0 && <div className="mb-1">{entry.recvPlayerNames.join(", ")}</div>}
              {entry.recvPicks && <div className="text-gray-500">Picks: {entry.recvPicks}</div>}
              <div className="text-gray-600 mt-1">Value: <span className="font-medium">{entry.recvValue.toFixed(1)}</span></div>
            </div>
          </div>
          <div className="text-gray-700 italic">{entry.verdict}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TIER-GATED NAV
// ============================================================

function ProNav() {
  const links = [
    { href: "/settings", label: "Settings" },
    { href: "/history",  label: "History"  },
    { href: "/nhl",      label: "NHL"      },
    { href: "/nfl",      label: "NFL"      },
    { href: "/mlb",      label: "MLB"      },
  ];
  return (
    <nav className="bg-gray-900 text-white px-6 py-2.5 flex items-center gap-6 text-sm">
      <span className="font-semibold text-gray-400 text-xs tracking-widest uppercase mr-2">
        Trade Analyzer
      </span>
      {links.map(({ href, label }) => (
        <Link key={href} href={href} className="text-gray-200 hover:text-white transition-colors">
          {label}
        </Link>
      ))}
    </nav>
  );
}
