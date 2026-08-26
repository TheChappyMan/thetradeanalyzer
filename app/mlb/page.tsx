"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useLeagueContext } from "@/lib/league-context";
import { loadSessionLeague, saveSessionLeague } from "@/lib/session-league";
import AccuracyRating from "@/app/components/AccuracyRating";
import StatHelp from "@/app/components/StatHelp";
import { MLB_HITTER_DESCRIPTIONS, MLB_PITCHER_DESCRIPTIONS } from "@/lib/stat-descriptions";
import {
  asNumber,
  buildPlayerDatabase,
  normalizeHitterTo162,
  normalizeSpTo32,
  normalizeRpTo70,
  RATE_HITTER,
  RATE_PITCHER,
  projectedSeasonValue,
  computeMlbPoolStats,
  mlbZScoreValue,
  computeMlbReplacement,
  softReplacementValue,
  BELOW_REPL_BAND,
  _median,
  type MlbDbPlayer,
  type MlbPlayerStats,
  type MlbStatSplit,
  type MlbPoolStats,
} from "@/lib/mlb-valuation";
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

// NOTE: league settings are deliberately NOT persisted for free users —
// saved settings are a paid (tier1+) feature stored in Supabase.
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

// (MlbPlayerStats / MlbDbPlayer moved to @/lib/mlb-valuation)


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

// (data helpers + MlbStatSplit moved to @/lib/mlb-valuation)


// (buildPlayerDatabase + season normalization moved to @/lib/mlb-valuation)

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

// (projectedSeasonValue moved to @/lib/mlb-valuation)


// (z-score engine + soft floor moved to @/lib/mlb-valuation)

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

// (Talent ranking for pick valuation is built inline in the component from
// the same replacement-adjusted values used for trade math.)

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
  const isPro   = tier === "tier1" || tier === "tier2" || tier === "tier3";
  const isTier2 = tier === "tier2" || tier === "tier3";
  const { selectedLeagueId: ctxLeagueIds } = useLeagueContext();

  // Free users always start from the defaults — settings persistence is a
  // paid feature (Supabase settings are applied below once Clerk resolves).
  const [league, setLeague] = useState<MlbLeague>(DEFAULT_MLB_LEAGUE);

  const [profiles,   setProfiles]   = useState<SavedProfile[]>(() => loadProfiles());

  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saved">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [dataMode, setDataMode] = useState<DataMode>(() => {
    try { return (localStorage.getItem(LS_DATA_MODE) as DataMode) || "thisTotal"; }
    catch { return "thisTotal"; }
  });

  const [currentSeasonDb,  setCurrentSeasonDb]  = useState<MlbDbPlayer[]>([]);
  const [priorSeasonDb,    setPriorSeasonDb]    = useState<MlbDbPlayer[]>([]);
  const [injuryMap,        setInjuryMap]        = useState<Record<number, string>>({});
  const [currentSeasonYear, setCurrentSeasonYear] = useState<number>(0);
  const [priorSeasonYear,   setPriorSeasonYear]   = useState<number>(0);
  const [dbStatus, setDbStatus] = useState<DbStatus>("loading");

  const [t2Leagues,      setT2Leagues]      = useState<LeagueRow[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);
  const [currentLeagueId, setCurrentLeagueId] = useState<string | null>(null);

  // ── Fetch both seasons ────────────────────────────────────────
  useEffect(() => {
    type SeasonPayload = {
      season:    number;
      hitters:   MlbStatSplit[];
      pitchers:  MlbStatSplit[];
      ageMap:    Record<number, number>;
      injuryMap: Record<number, string>;
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
        const im = currentSeason.injuryMap ?? {};
        if (Object.keys(im).length === 0) {
          console.warn(
            "[MLB injuries] injury map is EMPTY — no IL data was returned by /api/mlb, " +
            "so every player is being valued as healthy. Injury discounts will not apply."
          );
        } else {
          // Verification: every distinct status the feed returned, how many
          // players carry it, and the redraft multiplier now applied.
          const counts: Record<string, number> = {};
          for (const status of Object.values(im)) {
            counts[status] = (counts[status] ?? 0) + 1;
          }
          for (const [status, count] of Object.entries(counts)) {
            console.log(
              `[MLB injuries] status "${status}": ${count} players, ` +
              `redraft ×${mlbInjuryMultiplier(status, true).toFixed(2)}, keeper ×1.00`
            );
          }
        }
        setInjuryMap(im);
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

  // Free users: session-scoped settings so navigating to Rankings and back
  // doesn't reset the league to defaults. One effect so the restore always
  // runs before the first write (a separate write effect would clobber the
  // stored settings with defaults on the same render pass). Pro users are
  // untouched — their settings come from Supabase above.
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (!clerkLoaded) return;
    if (!sessionRestoredRef.current) {
      sessionRestoredRef.current = true;
      if (!isPro) {
        const saved = loadSessionLeague<MlbLeague>("mlb");
        if (saved) {
          applyLeagueSettings(saved);
          return; // write on the next pass, once the restore has landed
        }
      }
    }
    if (!isPro) saveSessionLeague("mlb", league);
  }, [clerkLoaded, isPro, league, applyLeagueSettings]);

  const [history,     setHistory]     = useState<HistoryEntry[]>(() => loadHistory());
  const [sendPlayers, setSendPlayers] = useState<TradePlayer[]>([]);
  const [recvPlayers, setRecvPlayers] = useState<TradePlayer[]>([]);
  const [sendPicks,   setSendPicks]   = useState("");
  const [recvPicks,   setRecvPicks]   = useState("");

  const useRates   = dataMode === "thisAvg" || dataMode === "lastAvg";
  const isRotoMode = league.format !== "points";

  // Median games played among rostered-caliber players, used to flag
  // players whose Total-mode value is dragged down by missed time.
  const poolMedianGp = useMemo(() => {
    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const s = [...arr].sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    return {
      hitter:  median(playerDb.filter((p) => !p.isPitcher && p.gamesPlayed > 0).map((p) => p.gamesPlayed)),
      pitcher: median(playerDb.filter((p) =>  p.isPitcher && p.gamesPlayed > 0).map((p) => p.gamesPlayed)),
    };
  }, [playerDb]);

  // ── Pool stats for roto z-score ───────────────────────────────
  const poolStats = useMemo(() => {
    if (playerDb.length === 0 || !isRotoMode) return null;
    return computeMlbPoolStats(
      playerDb, league.teams, league.roster, HITTER_STATS, PITCHER_STATS, useRates
    );
  }, [playerDb, league.teams, league.roster, useRates, isRotoMode]);

  // ── Thin-sample fallback (per player) ─────────────────────────
  // A player far below the pool's median games played is undervalued in any
  // Total mode — low totals reflect availability, not ability. For those
  // players (below 25% of pool median GP, with absolute floors), value the
  // individual player from prior-season data on a per-game projected basis,
  // scaled to the pool's typical volume so the scales match. Only applies
  // in this-season modes; last-season modes already ARE the prior season.
  const thinSampleFallback = useMemo(() => {
    const map = new Map<number, MlbDbPlayer>();          // current id → pseudo entry
    const lowConfidence = new Set<number>();             // thin sample, no prior data
    const usingThisSeason = dataMode === "thisTotal" || dataMode === "thisAvg";
    if (!usingThisSeason || !poolStats || priorSeasonDb.length === 0) {
      return { map, lowConfidence };
    }
    // Thresholds must use REAL current-season games played. In Projected
    // (Avg) modes playerDb is normalized (everyone reads 162/32/70 G), which
    // would make the threshold never fire — so read from the raw season DB.
    const realByld = new Map(currentSeasonDb.map((x) => [x.id, x]));
    const realHitterMedianGp = _median(
      currentSeasonDb.filter((x) => !x.isPitcher && x.gamesPlayed > 0).map((x) => x.gamesPlayed));
    const realPitcherMedianGp = _median(
      currentSeasonDb.filter((x) =>  x.isPitcher && x.gamesPlayed > 0).map((x) => x.gamesPlayed));
    for (const p of playerDb) {
      const real = realByld.get(p.id) ?? p;
      const isSp     = p.isPitcher && p.position === "SP";
      const medianGp = p.isPitcher ? realPitcherMedianGp : realHitterMedianGp;
      const sample   = isSp ? real.gamesStarted : real.gamesPlayed;
      const floor    = !p.isPitcher ? 15 : isSp ? 5 : 10;
      const threshold = Math.max(floor, 0.25 * medianGp);
      if (sample >= threshold) continue;

      const prior = priorSeasonDb.find(
        (x) => x.mlbId === p.mlbId && x.isPitcher === p.isPitcher
      );
      // The prior season must itself be a meaningful sample — extrapolating
      // per-game rates from a handful of prior games explodes just as badly.
      const priorSample = prior
        ? (prior.isPitcher && prior.position === "SP" ? prior.gamesStarted : prior.gamesPlayed)
        : 0;
      if (!prior || priorSample < floor) {
        lowConfidence.add(p.id);
        continue;
      }

      let pseudo: MlbDbPlayer;
      if (useRates) {
        // Projected modes: normalize the prior season the same way the
        // rest of the pool is normalized (162 G / 32 GS / 70 G).
        pseudo = prior.isPitcher
          ? prior.position === "SP" ? normalizeSpTo32(prior) : normalizeRpTo70(prior)
          : normalizeHitterTo162(prior);
      } else {
        // Total modes: prior per-game rates × the pool's median volume,
        // so the pseudo totals live on the current pool's scale.
        const scaleGp = p.isPitcher ? poolStats.pitcherMedianGp : poolStats.hitterMedianGp;
        const gp = prior.gamesPlayed;
        const rateKeys: Set<string> = prior.isPitcher
          ? (RATE_PITCHER as Set<string>)
          : (RATE_HITTER as Set<string>);
        const stats: MlbPlayerStats = {};
        for (const [k, v] of Object.entries(prior.stats) as [string, number | undefined][]) {
          if (v === undefined) continue;
          (stats as Record<string, number>)[k] = rateKeys.has(k) ? v : (v / gp) * scaleGp;
        }
        pseudo = {
          ...prior,
          gamesPlayed:  scaleGp,
          gamesStarted: prior.isPitcher ? Math.round((prior.gamesStarted / gp) * scaleGp) : 0,
          stats,
        };
      }
      // Keep current identity/team/age so badges and lookups stay correct
      map.set(p.id, {
        ...pseudo,
        id: p.id, mlbId: p.mlbId, name: p.name, team: p.team,
        position: p.position, age: p.age,
      });
    }
    return { map, lowConfidence };
  }, [playerDb, priorSeasonDb, currentSeasonDb, poolStats, dataMode, useRates]);

  /** Entry used for valuation — prior-season pseudo entry for thin samples */
  const effectiveEntry = useCallback(
    (dbEntry: MlbDbPlayer): MlbDbPlayer => thinSampleFallback.map.get(dbEntry.id) ?? dbEntry,
    [thinSampleFallback]
  );

  // ── Replacement level (roto mode) ─────────────────────────────
  // The z-score pool mean sits around the 65th–80th ranked player, so most
  // rostered players sum to a NEGATIVE z. Trade value is therefore measured
  // against the first player OUTSIDE the league-adjusted pool (rank N+1):
  //   value = z_player − z_replacement, clamped at 0 below replacement.
  // Raw z-scores are still shown on player cards.
  // Positional version: replacement is computed PER POSITION — the best
  // player at that position outside the number of starters the league must
  // field there. A global bar prices starting catchers 6–12 at zero because
  // only ~5 catchers clear the overall pool; a positional bar prices exactly
  // the required starters above zero at every position.
  //   required = teams × dedicated slots (CI/MI/IF/LF/CF/RF folded into
  //   their base positions); UTIL deepens every hitter position uniformly
  //   and is never attributed to a single one. P flex splits SP/RP.
  // DH-only players can fill UTIL only, so their bar is the global hitter
  // replacement (the best freely available hitter overall).
  const replacementZ = useMemo(() => {
    if (!poolStats || !isRotoMode) return null;
    const zOf = (p: MlbDbPlayer) =>
      mlbZScoreValue(effectiveEntry(p), league.hitterCategories, league.pitcherCategories, poolStats, HITTER_STATS, PITCHER_STATS, useRates);

    return computeMlbReplacement(playerDb, league.teams, league.roster, poolStats.hitterN, zOf);
  }, [poolStats, isRotoMode, playerDb, league.teams, league.roster,
      league.hitterCategories, league.pitcherCategories, useRates, effectiveEntry]);

  // ── Replacement-adjusted base value ───────────────────────────
  // Roto: z − z_replacement, clamped at 0 (below-replacement players have no
  // realistic trade value; relative spacing above replacement is preserved).
  // Points mode: raw projected points, unshifted and unclamped — points
  // values are positive by construction and must not change.
  // Core: distance from the player's positional replacement bar, or null
  // in points mode (points values flow through untouched).
  const replacementDiff = useCallback((dbEntry: MlbDbPlayer): number | null => {
    const eff = effectiveEntry(dbEntry);
    if (!(isRotoMode && poolStats && replacementZ)) return null;
    const z = mlbZScoreValue(eff, league.hitterCategories, league.pitcherCategories, poolStats, HITTER_STATS, PITCHER_STATS, useRates);
    // Positional bar: SP/RP for pitchers, the fielding position for
    // hitters, global hitter bar for DH (see replacementZ).
    return z - (replacementZ.byPosition[eff.position] ?? 0);
  }, [effectiveEntry, isRotoMode, poolStats, league.hitterCategories, league.pitcherCategories,
      useRates, replacementZ]);

  // DISPLAY / RANKING value: soft floor keeps ordering below the bar, so a
  // good bench catcher never prices identically to a poor one on cards and
  // in sorted lists. Continuous at the bar (diff 0 → 0.05 on both sides).
  const displayBase = useCallback((dbEntry: MlbDbPlayer): number => {
    const diff = replacementDiff(dbEntry);
    if (diff === null) {
      return projectedSeasonValue(effectiveEntry(dbEntry), league.hitterWeights, league.pitcherWeights, useRates);
    }
    return softReplacementValue(diff);
  }, [replacementDiff, effectiveEntry, league.hitterWeights, league.pitcherWeights, useRates]);

  // TRADE-MATH value: identical to display above the bar, but EXACTLY 0
  // below it. A below-replacement throw-in must never tip a fairness
  // verdict — five waiver adds contribute exactly 0, not +0.25.
  const tradeBase = useCallback((dbEntry: MlbDbPlayer): number => {
    const diff = replacementDiff(dbEntry);
    if (diff === null) {
      return projectedSeasonValue(effectiveEntry(dbEntry), league.hitterWeights, league.pitcherWeights, useRates);
    }
    const v = diff >= 0 ? diff + BELOW_REPL_BAND : 0;
    if (v < 0) console.warn(`[MLB value] invariant violated: negative trade value for ${dbEntry.name}`);
    return v;
  }, [replacementDiff, effectiveEntry, league.hitterWeights, league.pitcherWeights, useRates]);

  // ── Talent ranking for pick valuation ─────────────────────────
  // Pick valuation is trade math — built from tradeBase, so a pick landing
  // on a below-replacement rank is worth exactly 0.
  const talentRanking = useMemo(() => {
    if (playerDb.length === 0) return [];
    return playerDb.map(tradeBase).sort((a, b) => b - a);
  }, [playerDb, tradeBase]);

  // ── League ranking map ────────────────────────────────────────
  // Ranks are a DISPLAY concern — displayBase preserves ordering below the
  // bar. Same basis as player value (incl. the prior-season fallback), so a
  // star with a collapsed rank still gets the right keeper multiplier.
  const rankMap = useMemo(() => {
    const map = new Map<number, number>();
    if (playerDb.length === 0) return map;
    const sorted = [...playerDb].sort(
      (a, b) => displayBase(b) - displayBase(a) || b.gamesPlayed - a.gamesPlayed
    );
    sorted.forEach((p, i) => map.set(p.id, i + 1));
    return map;
  }, [playerDb, displayBase]);

  // Raw (unshifted, unclamped) base for card display transparency
  const rawBase = useCallback((dbEntry: MlbDbPlayer): number => {
    const eff = effectiveEntry(dbEntry);
    return isRotoMode && poolStats
      ? mlbZScoreValue(eff, league.hitterCategories, league.pitcherCategories, poolStats, HITTER_STATS, PITCHER_STATS, useRates)
      : projectedSeasonValue(eff, league.hitterWeights, league.pitcherWeights, useRates);
  }, [effectiveEntry, isRotoMode, poolStats, league.hitterCategories, league.pitcherCategories,
      league.hitterWeights, league.pitcherWeights, useRates]);

  // Card note for players valued on fallback / low-confidence data.
  // Uses REAL current-season games (playerDb is normalized in Avg modes).
  const fallbackLabel = useCallback((dbEntry: MlbDbPlayer): string | null => {
    if (thinSampleFallback.map.has(dbEntry.id)) {
      const real = currentSeasonDb.find((x) => x.id === dbEntry.id) ?? dbEntry;
      const sampleLabel = real.isPitcher && real.position === "SP"
        ? `${real.gamesStarted} GS` : `${real.gamesPlayed} G`;
      return `Valued on ${priorSeasonYear} data (${sampleLabel} this season)`;
    }
    if (thinSampleFallback.lowConfidence.has(dbEntry.id)) {
      return "Low-confidence valuation — thin sample and no prior-season data.";
    }
    return null;
  }, [thinSampleFallback, priorSeasonYear, currentSeasonDb]);




  // ── Parsed picks ──────────────────────────────────────────────
  const sendPicksParsed = useMemo(() => parsePicks(sendPicks, league.teams), [sendPicks, league.teams]);
  const recvPicksParsed = useMemo(() => parsePicks(recvPicks, league.teams), [recvPicks, league.teams]);

  // ── Per-player value helper ───────────────────────────────────
  // Multipliers only ever operate on the replacement-adjusted (clamped)
  // value, never a signed z-score, so a boost (keeper ×1.32) always
  // increases value and a discount (injury ×0.35) always decreases it.
  function playerValue(p: TradePlayer, dbEntry: MlbDbPlayer): number {
    const base     = tradeBase(dbEntry);
    const scarcity = positionScarcityMultiplier(dbEntry.position);
    const ageMult  = ageMultiplier(dbEntry.age, league.leagueType === "keeper");
    const kMult    = p.isKeeper ? keeperMultiplier(rankMap.get(p.id) ?? null) : 1.0;
    const iMult    = mlbInjuryMultiplier(injuryMap[dbEntry.mlbId], league.leagueType === "redraft");
    // Order: scarcity → age curve (keeper only) → keeper rank → injury (redraft only)
    return base * scarcity * (p.isKeeper ? ageMult : 1.0) * kMult * iMult;
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
  }, [sendPlayers, sendPicksParsed, talentRanking, playerDb, league, poolStats, isRotoMode, useRates, rankMap, injuryMap]);

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
  }, [recvPlayers, recvPicksParsed, talentRanking, playerDb, league, poolStats, isRotoMode, useRates, rankMap, injuryMap]);

  const score = useMemo(() => fairnessScore(sendValue, recvValue), [sendValue, recvValue]);

  // Defensive safety net: values are replacement-adjusted and non-negative,
  // so this offset should always resolve to 0. A non-zero value means a
  // negative value leaked through — warn loudly.
  const offset       = Math.min(0, sendValue, recvValue);
  if (offset < 0) {
    console.warn(
      `[MLB fairness] negative trade value leaked through the replacement adjustment: ` +
      `offset=${offset.toFixed(3)} (send=${sendValue.toFixed(3)}, recv=${recvValue.toFixed(3)})`
    );
  }
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
  }, [isPro, sendPlayers, recvPlayers, sendPicks, recvPicks, currentLeagueId, sendValue, recvValue, score]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── GA4: fire trade_analyzed when both sides are stable for 3 s ──
  useEffect(() => {
    const hasSend = sendPlayers.length > 0 || sendPicks.trim() !== "";
    const hasRecv = recvPlayers.length > 0 || recvPicks.trim() !== "";
    if (!hasSend || !hasRecv || tradeRating === 0) return;
    const timer = setTimeout(() => {
      if (typeof window.gtag !== "function") return;
      window.gtag("event", "trade_analyzed_MLB", {
        sport: "mlb",
        user_tier: tier,
        is_logged_in: !!user,
        league_format: league.format,
        trade_rating: tradeRating,
        has_picks: sendPicks.trim() !== "" || recvPicks.trim() !== "",
      });
    }, 3000);
    return () => clearTimeout(timer);
  }, [tradeRating, sendPlayers, recvPlayers, sendPicks, recvPicks, tier, user, league.format]);

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
  void tradeRatingLabel; void barColor;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <>
      {!isPro && (
        <div className="upgrade-banner rounded-none px-6 py-2 text-xs mb-0">
          💡 Save your settings and track trade history —{" "}
          <a
            href="https://thetradeanalyzer.com/pricing/"
            className="underline font-semibold"
            style={{ color: "inherit" }}
          >
            upgrade to Pro
          </a>
          <span className="block sm:inline sm:ml-2">
            🎉 Use code <span className="font-bold">BIG50</span> before December 31, 2026 and get
            50% off forever — no price changes as long as you&apos;re subscribed.
          </span>
        </div>
      )}
      <div className="p-6 max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <h1 className="text-2xl font-semibold" style={{ color: "var(--color-text)" }}>MLB Trade Analyzer</h1>
          <MlbApiStatus
            status={dbStatus}
            playerCount={playerDb.length}
            currentSeasonYear={currentSeasonYear}
            priorSeasonYear={priorSeasonYear}
            dataMode={dataMode}
            setDataMode={setDataMode}
          />
        </div>

        {isPro && (
          <p className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>
            Make sure you have your{" "}
            <Link href="/settings" className="link-primary font-medium">league settings filled out</Link>{" "}
            before analyzing trades to ensure accuracy.
          </p>
        )}

        {!isPro && (
          <p className="text-sm mb-4" style={{ color: "var(--color-muted)" }}>
            <strong style={{ color: "var(--color-text)" }}>To get started</strong>, fill out your league&apos;s settings below.
            Once you have completed the league information, you can then start analyzing trades in your league.
            Our analyzer requires this to ensure the score you get is truly accurate. Most trade analyzers use
            rough estimates, which can be up to 50% off true value, depending on your league settings.
          </p>
        )}

        {/* Tier 2: league selector */}
        {isTier2 && (
          <div className="flex items-center gap-3 mb-4">
            <label className="text-sm shrink-0" style={{ color: "var(--color-muted)" }}>League:</label>
            {t2Leagues.length > 0 ? (
              <select
                className="form-input"
                style={{ fontSize: "0.875rem" }}
                value={activeLeagueId ?? ""}
                onChange={(e) => setActiveLeagueId(e.target.value || null)}
              >
                {t2Leagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-sm italic" style={{ color: "var(--color-muted)" }}>No leagues yet</span>
            )}
            <Link href="/settings" className="link-primary text-xs whitespace-nowrap">
              + New League
            </Link>
          </div>
        )}

        {/* League Settings + Scoring (hidden for Pro — loaded from Supabase) */}
        {!isPro && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

            {/* League Settings */}
            <div className="card">
              <h2 className="font-medium mb-2" style={{ color: "var(--color-text)" }}>League Settings</h2>

              <label className="text-sm" style={{ color: "var(--color-muted)" }}>League Name (optional)</label>
              <input
                type="text" className="form-input mb-2"
                value={league.name} onChange={(e) => updateLeague({ name: e.target.value })}
              />

              <label className="text-sm" style={{ color: "var(--color-muted)" }}>Number of Teams</label>
              <input
                type="number" min={2} className="form-input mb-2"
                value={league.teams}
                onChange={(e) => updateLeague({ teams: parseInt(e.target.value || "12", 10) })}
              />

              <label className="text-sm" style={{ color: "var(--color-muted)" }}>League Type</label>
              <select
                className="form-input mb-2"
                value={league.leagueType}
                onChange={(e) => updateLeague({ leagueType: e.target.value as "redraft" | "keeper" })}
              >
                <option value="redraft">Redraft</option>
                <option value="keeper">Keeper</option>
              </select>

              {league.leagueType === "keeper" && (
                <>
                  <label className="text-sm" style={{ color: "var(--color-muted)" }}>Keepers per Team</label>
                  <input
                    type="number" min={0} className="form-input mb-2"
                    value={league.keepersPerTeam}
                    onChange={(e) => updateLeague({ keepersPerTeam: parseInt(e.target.value || "0", 10) })}
                  />
                </>
              )}

              <h3 className="text-sm font-semibold mt-3 mb-2" style={{ color: "var(--color-text)" }}>Roster Slots</h3>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(league.roster) as MlbRosterKey[]).map((pos) => (
                  <label key={pos} className="text-xs flex items-center gap-2">
                    <span className="w-10" style={{ color: "var(--color-text)" }}>{pos}</span>
                    <input
                      type="number" min={0} className="form-input" style={{ padding: "0.25rem" }}
                      value={league.roster[pos]}
                      onChange={(e) => updateRoster(pos, parseInt(e.target.value || "0", 10))}
                    />
                  </label>
                ))}
              </div>
            </div>

            {/* Scoring */}
            <div className="card">
              <h2 className="font-medium mb-2" style={{ color: "var(--color-text)" }}>Scoring Format</h2>

              {/* Format toggle */}
              <div className="flex rounded-xl border overflow-hidden mb-3">
                {(["5x5", "obp", "points"] as LeagueFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    className="flex-1 py-1.5 text-sm font-medium transition-colors"
                    style={league.format === fmt
                      ? { background: "var(--color-primary)", color: "#fff" }
                      : { color: "var(--color-muted)" }}
                    onClick={() => handleFormatChange(fmt)}
                  >
                    {fmt === "5x5" ? "5×5 Roto" : fmt === "obp" ? "OBP Roto" : "Points"}
                  </button>
                ))}
              </div>

              {isRotoMode ? (
                <>
                  <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                    {league.format === "5x5"
                      ? "5×5: R, HR, RBI, SB, AVG (hitting) + W, SV, K, ERA, WHIP (pitching)."
                      : "OBP: same as 5×5 but OBP replaces AVG."}{" "}
                    Check the categories your league uses. Set direction to &ldquo;−&rdquo; for stats where lower is better (ERA, WHIP).
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Hitter categories */}
                    <div>
                      <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Hitters</h3>
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
                              <label htmlFor={`hcat-${stat}`} className="w-14 cursor-pointer text-xs flex items-center gap-1">
                                {stat}
                                <StatHelp text={MLB_HITTER_DESCRIPTIONS[stat]} />
                              </label>
                              {cfg && (
                                <div className="flex rounded-lg border overflow-hidden text-xs">
                                  <button
                                    className="px-1.5 py-0.5"
                                    style={cfg.direction === "more" ? { background: "var(--color-primary)", color: "#fff" } : { color: "var(--color-muted)" }}
                                    onClick={() => updateHitterCategory(stat, { direction: "more" })}
                                  >+</button>
                                  <button
                                    className="px-1.5 py-0.5"
                                    style={cfg.direction === "less" ? { background: "var(--color-primary)", color: "#fff" } : { color: "var(--color-muted)" }}
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
                      <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Pitchers</h3>
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
                              <label htmlFor={`pcat-${stat}`} className="w-14 cursor-pointer text-xs flex items-center gap-1">
                                {stat}
                                <StatHelp text={MLB_PITCHER_DESCRIPTIONS[stat]} />
                              </label>
                              {cfg && (
                                <div className="flex rounded-lg border overflow-hidden text-xs">
                                  <button
                                    className="px-1.5 py-0.5"
                                    style={cfg.direction === "more" ? { background: "var(--color-primary)", color: "#fff" } : { color: "var(--color-muted)" }}
                                    onClick={() => updatePitcherCategory(stat, { direction: "more" })}
                                  >+</button>
                                  <button
                                    className="px-1.5 py-0.5"
                                    style={cfg.direction === "less" ? { background: "var(--color-primary)", color: "#fff" } : { color: "var(--color-muted)" }}
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
                  <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
                    Points per stat. Typical: R=1, H=1, HR=4, RBI=1, BB=1, SB=2, K=−1 (hitters);
                    W=5, L=−3, SV=5, HLD=3, K=1, IP=1, QS=3 (pitchers).
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Hitters</h3>
                      <div className="space-y-1">
                        {HITTER_STATS.map((stat) => (
                          <div key={stat} className="flex items-center justify-between gap-2">
                            <label className="text-xs w-14 flex items-center gap-1" style={{ color: "var(--color-muted)" }}>
                              {stat}
                              <StatHelp text={MLB_HITTER_DESCRIPTIONS[stat]} />
                            </label>
                            <input
                              type="number" step="0.5" className="form-input text-xs" style={{ padding: "0.25rem" }}
                              value={league.hitterWeights[stat]}
                              onChange={(e) => updateHitterWeight(stat, parseFloat(e.target.value || "0"))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>Pitchers</h3>
                      <div className="space-y-1">
                        {PITCHER_STATS.map((stat) => (
                          <div key={stat} className="flex items-center justify-between gap-2">
                            <label className="text-xs w-14 flex items-center gap-1" style={{ color: "var(--color-muted)" }}>
                              {stat}
                              <StatHelp text={MLB_PITCHER_DESCRIPTIONS[stat]} />
                            </label>
                            <input
                              type="number" step="0.5" className="form-input text-xs" style={{ padding: "0.25rem" }}
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
        <div className="card mb-6">
          <h2 className="font-medium mb-3" style={{ color: "var(--color-text)" }}>Trade</h2>
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
              poolMedianGp={poolMedianGp}
              injuryMap={injuryMap}
              displayBaseOf={displayBase}
              rawBaseOf={rawBase}
              fallbackLabelOf={fallbackLabel}
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
              poolMedianGp={poolMedianGp}
              injuryMap={injuryMap}
              displayBaseOf={displayBase}
              rawBaseOf={rawBase}
              fallbackLabelOf={fallbackLabel}
              onAdd={(p) => addPlayer("recv", p)}
              onRemove={(id) => removePlayer("recv", id)}
              onToggleKeeper={(id) => toggleKeeper("recv", id)}
            />
          </div>
        </div>

        {/* Fairness result */}
        <div className="card mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium" style={{ color: "var(--color-text)" }}>Fairness Result</h2>
            {isPro && autoSaveStatus === "saved" && (
              <span className="text-xs" style={{ color: "var(--color-primary)" }}>✓ Auto-saved</span>
            )}
          </div>
          <div className="grid grid-cols-4 gap-4 mb-3">
            <div>
              <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                {isRotoMode ? "You Give (z-score)" : "You Give (proj pts)"}
              </div>
              <div className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
                {isRotoMode ? sendValue.toFixed(2) : sendValue.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--color-muted)" }}>
                {isRotoMode ? "You Get (z-score)" : "You Get (proj pts)"}
              </div>
              <div className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>
                {isRotoMode ? recvValue.toFixed(2) : recvValue.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--color-muted)" }}>Trade Rating</div>
              <div className="text-lg font-semibold" style={{ color: "var(--color-text)" }}>{tradeRating.toFixed(1)} / 100</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: "var(--color-muted)" }}>Trade Outline</div>
              {(sendValue !== 0 || recvValue !== 0) && (
                <div className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{tradeOutline(safeScore)}</div>
              )}
            </div>
          </div>

          {/* Fairness scale bar */}
          <div className="mb-3">
            <div className="relative flex justify-between text-xs mb-1" style={{ color: "var(--color-muted)" }}>
              <span>Opponent Wins</span>
              <span className="absolute left-1/2 -translate-x-1/2 font-medium">Fairness Scale</span>
              <span>You Win</span>
            </div>
            <div className="relative my-2">
              <div className="h-6 rounded-full overflow-hidden flex">
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
                  left: `${safeScore}%`,
                  background: "#fff",
                  boxShadow: "0 0 0 1.5px rgba(0,0,0,0.6), 0 1px 4px rgba(0,0,0,0.45)",
                }}
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

          {isPro && (sendValue !== 0 || recvValue !== 0) && (
            <button
              className="btn-secondary mt-3 text-xs"
              onClick={saveToHistory}
            >
              Save to History
            </button>
          )}
        </div>

        {/* Trade History (free users) */}
        {!isPro && history.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium" style={{ color: "var(--color-text)" }}>Trade History</h2>
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

        <AccuracyRating sport="mlb" />

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
  if (status === "loading") return <div className="text-xs" style={{ color: "var(--color-muted)" }}>Loading MLB data…</div>;
  if (status === "error")   return <div className="text-xs text-red-600">MLB API unavailable — please refresh</div>;
  const activeYear = (dataMode === "thisTotal" || dataMode === "thisAvg")
    ? currentSeasonYear : priorSeasonYear;
  return (
    <div className="text-xs text-left sm:text-right flex items-center gap-3 shrink-0" style={{ color: "var(--color-muted)" }}>
      <div className="whitespace-nowrap">
        <div>{playerCount} players loaded</div>
        {activeYear > 0 && <div>Season: {activeYear}</div>}
      </div>
      <select
        className="form-input text-xs"
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

// ── Injury helpers ─────────────────────────────────────────────────────────

/**
 * Returns the value multiplier for an injured MLB player.
 * Only applied in redraft leagues — keeper leagues retain full value.
 *
 * Short IL stints (a 10-day stint is ~9 of 162 games) carry a badge for
 * awareness but NO discount; only long absences reduce value. The 15-day
 * IL is the pitcher minimum — the equivalent of the position player's
 * 10-day IL, not a more severe injury — so both are treated identically.
 */
function mlbInjuryMultiplier(status: string | undefined, isRedraft: boolean): number {
  if (!status || !isRedraft) return 1.0;
  switch (status) {
    case "DTD":       return 1.0;   // badge only
    case "7-Day IL":  return 1.0;   // badge only (concussion IL)
    case "10-Day IL": return 1.0;   // badge only — short-term absence
    case "15-Day IL": return 1.0;   // badge only — pitcher-minimum equivalent of 10-day
    case "60-Day IL": return 0.75;
    case "Out for Season": return 0.10;
    default:
      // Unknown designation from the feed: warn and value as healthy
      // rather than guessing at a discount.
      console.warn(`[MLB injuries] unknown injury status "${status}" — treating player as healthy`);
      return 1.0;
  }
}

/** Coloured pill badge for injured MLB players. */
function MlbInjuryBadge({
  status,
  mult,
  isRedraft,
}: {
  status: string | undefined;
  mult: number;
  isRedraft: boolean;
}) {
  if (!status) return null;
  // Visual severity tracks the DISCOUNT, not the designation length:
  // tiers with no discount use the milder warning color; 60-day and
  // season-ending use the danger colors.
  const noDiscountTier =
    status === "DTD" || status === "7-Day IL" ||
    status === "10-Day IL" || status === "15-Day IL";
  const isRed     = status === "60-Day IL";
  const isDarkRed = status === "Out for Season";
  const { border, text, bg } =
    noDiscountTier ? { border: "border-amber-400", text: "text-amber-700", bg: "bg-amber-50" } :
    isRed          ? { border: "border-red-400",   text: "text-red-700",   bg: "bg-red-50"   } :
    isDarkRed      ? { border: "border-red-700",   text: "text-red-900",   bg: "bg-red-100"  } :
                     { border: "border-gray-300",  text: "text-gray-600",  bg: ""            };
  const title = !isRedraft
    ? "Full value retained — keeper league"
    : mult < 1.0
      ? `Value discounted ×${mult.toFixed(2)} for redraft`
      : "Short-term absence. No value adjustment applied.";
  return (
    <span
      className={`border rounded-full px-1.5 py-0.5 text-[10px] font-medium ${border} ${text} ${bg}`}
      title={title}
    >
      {status}
    </span>
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
  poolMedianGp: { hitter: number; pitcher: number };
  injuryMap: Record<number, string>;
  /** DISPLAY value (soft-floored) — cards and lists only, NOT trade math */
  displayBaseOf: (dbEntry: MlbDbPlayer) => number;
  /** Raw signed z-score (or raw points) for transparency display */
  rawBaseOf: (dbEntry: MlbDbPlayer) => number;
  /** Prior-season fallback / low-confidence note for the card, or null */
  fallbackLabelOf: (dbEntry: MlbDbPlayer) => string | null;
  onAdd: (p: MlbDbPlayer) => void;
  onRemove: (id: number) => void;
  onToggleKeeper: (id: number) => void;
};

function MlbTradeSide({
  label, players, picks, setPicks, parsedPicks, talentRanking, teams, keepersPerTeam,
  playerDb, dbStatus, isKeeperLeague, rankMap,
  poolStats, isRotoMode, hitterCategories, pitcherCategories,
  hitterWeights, pitcherWeights, useRates, poolMedianGp,
  injuryMap, displayBaseOf, rawBaseOf, fallbackLabelOf,
  onAdd, onRemove, onToggleKeeper,
}: MlbTradeSideProps) {

  // Check if any player is a suspected closer — show blanket warning
  const hasCloser = players.some((p) => {
    const db = playerDb.find((x) => x.id === p.id);
    return db?.isSuspectedCloser;
  });

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2" style={{ color: "var(--color-text)" }}>{label} — Players</h3>

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
          // Raw signed z (or points) for transparency; replacement-adjusted
          // base for the value math — must match playerValue() exactly
          const base = rawBaseOf(dbEntry);
          const scarcity    = positionScarcityMultiplier(dbEntry.position);
          const ageMult     = ageMultiplier(dbEntry.age, isKeeperLeague);
          const kMult       = p.isKeeper ? keeperMultiplier(rankMap.get(p.id) ?? null) : 1.0;
          const iMult       = mlbInjuryMultiplier(injuryMap[dbEntry.mlbId], !isKeeperLeague);
          const adjusted    = displayBaseOf(dbEntry) * scarcity * (p.isKeeper ? ageMult : 1.0) * kMult * iMult;
          const rank        = rankMap.get(p.id) ?? null;
          const fallbackNote = fallbackLabelOf(dbEntry);

          // Warnings
          const isEarlySeason = !dbEntry.isPitcher
            ? dbEntry.gamesPlayed < 15
            : dbEntry.position === "SP"
              ? dbEntry.gamesStarted < 5
              : dbEntry.gamesPlayed < 10;

          // Total mode undervalues players who missed significant time —
          // low raw totals reflect availability, not ability. Suppressed
          // when the prior-season fallback already covers the player.
          const medianGp = dbEntry.isPitcher ? poolMedianGp.pitcher : poolMedianGp.hitter;
          const missedTime = !useRates && medianGp > 0 &&
            dbEntry.gamesPlayed < medianGp * 0.6 && !isEarlySeason && !fallbackNote;

          return (
            <div key={p.id} className="card text-xs" style={{ padding: "0.5rem" }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold" style={{ color: "var(--color-text)" }}>{p.name}</span>
                  <span style={{ color: "var(--color-muted)" }}>{dbEntry.team}</span>
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
                  {/* Injury badge */}
                  <MlbInjuryBadge status={injuryMap[dbEntry.mlbId]} mult={iMult} isRedraft={!isKeeperLeague} />
                  {/* Age badge */}
                  {dbEntry.age !== null && (
                    <span className="text-gray-400 text-[10px]">Age {dbEntry.age}</span>
                  )}
                </div>
                <button className="text-red-600 hover:text-red-800 px-2" onClick={() => onRemove(p.id)} title="Remove">×</button>
              </div>

              <div className="mb-1" style={{ color: "var(--color-muted)" }}>
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

              {missedTime && (
                <div className="text-[10px] text-amber-700 mb-1">
                  ⚠ Missed time — Total mode reflects this partial season, not ability.
                  Try a &quot;Projected&quot; data mode for a fairer keeper comparison.
                </div>
              )}

              {fallbackNote && (
                <div className="text-[10px] text-amber-700 mb-1">
                  ⚠ {fallbackNote}
                </div>
              )}

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={p.isKeeper} onChange={() => onToggleKeeper(p.id)} />
                  <span style={{ color: "var(--color-muted)" }}>Keeper</span>
                </label>
                {p.isKeeper && (
                  <span style={{ color: "var(--color-primary)" }}>
                    rank ×{kMult.toFixed(2)}
                    {isKeeperLeague && dbEntry.age !== null && ` · age ×${ageMult.toFixed(2)}`}
                  </span>
                )}
              </div>

              <div className="mt-1 flex justify-between">
                <span style={{ color: "var(--color-muted)" }}>
                  {isRotoMode ? "z-score" : "Base"}: {isRotoMode ? base.toFixed(2) : base.toFixed(1)}
                  {rank !== null && <span className="ml-3">Rank: {rank} / {playerDb.length}</span>}
                  {iMult < 1.0 && (
                    <span className="ml-2 text-orange-600">×{iMult.toFixed(2)} injury</span>
                  )}
                </span>
                <span className="font-semibold" style={{ color: "var(--color-text)" }}>Adjusted: {isRotoMode ? adjusted.toFixed(2) : adjusted.toFixed(1)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="text-sm font-semibold mt-4 mb-1" style={{ color: "var(--color-text)" }}>{label} — Picks</h3>
      <p className="text-xs mb-1" style={{ color: "var(--color-muted)" }}>
        Enter as <span className="font-mono">round.slot</span> (e.g. <span className="font-mono">1.01</span>).
        Optionally prefix with year: <span className="font-mono">2027 1.01</span>.
      </p>
      <textarea
        className="form-input h-14 text-sm"
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
              <span className="font-mono" style={{ color: "var(--color-text)" }}>{pk.raw}</span>
              <span className="text-red-700">{pk.error}</span>
            </div>
          );
        }
        const value = valueForPick(pk, talentRanking, teams, keepersPerTeam);
        return (
          <div key={idx} className="card text-xs flex justify-between" style={{ padding: "0.5rem" }}>
            <span className="font-mono font-semibold" style={{ color: "var(--color-text)" }}>
              {pk.year ? `${pk.year} ` : ""}
              {pk.round}.{pk.slot.toString().padStart(2, "0")}
            </span>
            <span style={{ color: "var(--color-muted)" }}>
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
        type="text" className="form-input text-sm"
        placeholder={placeholder} value={query} disabled={dbStatus !== "ready"}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlightIdx(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-10 mt-1 w-full border rounded-xl shadow-lg max-h-64 overflow-auto" style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}>
          {matches.map((p, i) => (
            <div
              key={p.id}
              className={`px-3 py-2 text-sm cursor-pointer flex justify-between items-center ${i === highlightIdx ? "bg-blue-50" : ""}`}
              style={i !== highlightIdx ? { background: "transparent" } : undefined}
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={(e) => { e.preventDefault(); onSelect(p); setQuery(""); setHighlightIdx(0); }}
            >
              <span className="font-medium" style={{ color: "var(--color-text)" }}>{p.name}</span>
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
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
          <span className="shrink-0" style={{ color: "var(--color-muted)" }}>{dateStr} {timeStr}</span>
          {entry.leagueName && <span className="shrink-0 font-medium" style={{ color: "var(--color-muted)" }}>{entry.leagueName}</span>}
          <span className="truncate hidden sm:block" style={{ color: "var(--color-muted)" }}>{sendSummary} → {recvSummary}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="font-semibold" style={{ color: "var(--color-text)" }}>{entry.score.toFixed(1)} / 100</span>
          <button className="text-red-400 hover:text-red-600 px-1" onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }} title="Remove">×</button>
          <span style={{ color: "var(--color-muted)" }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-3 border-t border-inherit pt-2 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="font-semibold mb-1" style={{ color: "var(--color-text)" }}>You Gave</div>
              {entry.sendPlayerNames.length > 0 && <div className="mb-1" style={{ color: "var(--color-text)" }}>{entry.sendPlayerNames.join(", ")}</div>}
              {entry.sendPicks && <div style={{ color: "var(--color-muted)" }}>Picks: {entry.sendPicks}</div>}
              <div className="mt-1" style={{ color: "var(--color-muted)" }}>Value: <span className="font-medium" style={{ color: "var(--color-text)" }}>{entry.sendValue.toFixed(1)}</span></div>
            </div>
            <div>
              <div className="font-semibold mb-1" style={{ color: "var(--color-text)" }}>You Got</div>
              {entry.recvPlayerNames.length > 0 && <div className="mb-1" style={{ color: "var(--color-text)" }}>{entry.recvPlayerNames.join(", ")}</div>}
              {entry.recvPicks && <div style={{ color: "var(--color-muted)" }}>Picks: {entry.recvPicks}</div>}
              <div className="mt-1" style={{ color: "var(--color-muted)" }}>Value: <span className="font-medium" style={{ color: "var(--color-text)" }}>{entry.recvValue.toFixed(1)}</span></div>
            </div>
          </div>
          <div className="italic" style={{ color: "var(--color-text)" }}>{entry.verdict}</div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TIER-GATED NAV
// ============================================================

