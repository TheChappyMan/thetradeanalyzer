"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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
  | "G" | "A" | "P" | "+/-" | "PIM"
  | "PPG" | "PPA" | "PPP"
  | "SHG" | "SHA" | "SHP"
  | "GWG" | "SOG" | "HIT" | "BLK" | "FW" | "FL"
  | "TOI" | "ATOI";

type GoalieStatKey = "W" | "L" | "OTL" | "SO" | "SV" | "GA" | "GAA" | "SV%";

type SkaterWeights = Record<SkaterStatKey, number>;
type GoalieWeights = Record<GoalieStatKey, number>;

type RosterKey =
  | "C" | "LW" | "RW" | "W" | "F" | "D" | "U" | "G" | "B" | "IR" | "IRplus";
type Roster = Record<RosterKey, number>;

type League = {
  name: string;
  teams: number;
  leagueType: "redraft" | "keeper";
  keepersPerTeam: number;
  roster: Roster;
  skaterWeights: SkaterWeights;
  goalieWeights: GoalieWeights;
};

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

type DbMeta = { seasonUsed: string | null; isFallback: boolean };

// ============================================================
// DATA LAYER – NHL API (via server proxy to avoid CORS)
// ============================================================

function currentSeasonId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 9 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}

function priorSeasonId(): string {
  const cur = currentSeasonId();
  const start = parseInt(cur.slice(0, 4), 10) - 1;
  return `${start}${start + 1}`;
}

async function fetchJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

type NhlApiResponse<T> = { data?: T[] };

async function fetchSkaterSummary(seasonId: string) {
  const url = `/api/nhl?endpoint=skater-summary&season=${seasonId}`;
  const json = await fetchJson<NhlApiResponse<Record<string, unknown>>>(url);
  return json.data || [];
}

async function fetchSkaterRealtime(seasonId: string) {
  const url = `/api/nhl?endpoint=skater-realtime&season=${seasonId}`;
  const json = await fetchJson<NhlApiResponse<Record<string, unknown>>>(url);
  return json.data || [];
}

async function fetchSkaterFaceoffs(seasonId: string) {
  const url = `/api/nhl?endpoint=skater-faceoffs&season=${seasonId}`;
  const json = await fetchJson<NhlApiResponse<Record<string, unknown>>>(url);
  return json.data || [];
}

async function fetchGoalieSummary(seasonId: string) {
  const url = `/api/nhl?endpoint=goalie-summary&season=${seasonId}`;
  const json = await fetchJson<NhlApiResponse<Record<string, unknown>>>(url);
  return json.data || [];
}

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
        "+/-": asNumber(s.plusMinus),
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

async function loadPlayerDatabase(): Promise<{
  players: DbPlayer[];
  seasonUsed: string;
  isFallback: boolean;
}> {
  const curSeason = currentSeasonId();
  try {
    const [summary, realtime, faceoffs, goalies] = await Promise.all([
      fetchSkaterSummary(curSeason),
      fetchSkaterRealtime(curSeason),
      fetchSkaterFaceoffs(curSeason),
      fetchGoalieSummary(curSeason),
    ]);

    const significantPlayers = summary.filter(
      (s) => asNumber(s.gamesPlayed) >= 10
    ).length;
    if (significantPlayers < 100) throw new Error("sparse");

    const players = buildPlayerDatabase({ summary, realtime, faceoffs, goalies });
    return { players, seasonUsed: curSeason, isFallback: false };
  } catch {
    const priorSeason = priorSeasonId();
    const [summary, realtime, faceoffs, goalies] = await Promise.all([
      fetchSkaterSummary(priorSeason),
      fetchSkaterRealtime(priorSeason),
      fetchSkaterFaceoffs(priorSeason),
      fetchGoalieSummary(priorSeason),
    ]);
    const players = buildPlayerDatabase({ summary, realtime, faceoffs, goalies });
    return { players, seasonUsed: priorSeason, isFallback: true };
  }
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
  goalieWeights: GoalieWeights
): number[] {
  return playerDb
    .map((p) => projectedSeasonValue(p, skaterWeights, goalieWeights))
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
// CONSTANTS
// ============================================================

const SKATER_STATS: SkaterStatKey[] = [
  "G", "A", "P", "+/-", "PIM",
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

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function TradeAnalyzer() {
  const [league, setLeague] = useState<League>({
    name: "",
    teams: 12,
    leagueType: "redraft",
    keepersPerTeam: 0,
    roster: {
      C: 2, LW: 2, RW: 2, W: 0, F: 0,
      D: 4, U: 2, G: 2, B: 4, IR: 1, IRplus: 0,
    },
    skaterWeights: emptySkaterWeights(),
    goalieWeights: emptyGoalieWeights(),
  });

  const [playerDb, setPlayerDb] = useState<DbPlayer[]>([]);
  const [dbStatus, setDbStatus] = useState<DbStatus>("loading");
  const [dbMeta, setDbMeta] = useState<DbMeta>({ seasonUsed: null, isFallback: false });

  useEffect(() => {
    let cancelled = false;
    loadPlayerDatabase()
      .then(({ players, seasonUsed, isFallback }) => {
        if (cancelled) return;
        setPlayerDb(players);
        setDbMeta({ seasonUsed, isFallback });
        setDbStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("NHL API load failed:", err);
        setDbStatus("error");
      });
    return () => { cancelled = true; };
  }, []);

  const [sendPlayers, setSendPlayers] = useState<TradePlayer[]>([]);
  const [recvPlayers, setRecvPlayers] = useState<TradePlayer[]>([]);
  const [sendPicks, setSendPicks] = useState("");
  const [recvPicks, setRecvPicks] = useState("");

  // League-specific talent ranking — sorted projected values for every NHL player,
  // using this league's scoring weights. Used for pick valuation.
  const talentRanking = useMemo(() => {
    if (playerDb.length === 0) return [];
    return buildTalentRanking(playerDb, league.skaterWeights, league.goalieWeights);
  }, [playerDb, league.skaterWeights, league.goalieWeights]);

  // Parsed picks with errors flagged
  const sendPicksParsed = useMemo(
    () => parsePicks(sendPicks, league.teams),
    [sendPicks, league.teams]
  );
  const recvPicksParsed = useMemo(
    () => parsePicks(recvPicks, league.teams),
    [recvPicks, league.teams]
  );

  const sendValue = useMemo(() => {
    const playerTotal = sendPlayers.reduce((sum, p) => {
      const dbEntry = playerDb.find((x) => x.id === p.id);
      if (!dbEntry) return sum;
      const base = projectedSeasonValue(dbEntry, league.skaterWeights, league.goalieWeights);
      const mult = positionMultiplier(p.positions, league.roster);
      return sum + base * mult;
    }, 0);
    const keepers = league.leagueType === "keeper" ? league.keepersPerTeam : 0;
    const pickTotal = sendPicksParsed.reduce(
      (sum, pk) => sum + valueForPick(pk, talentRanking, league.teams, keepers),
      0
    );
    return playerTotal + pickTotal;
  }, [sendPlayers, sendPicksParsed, talentRanking, playerDb, league]);

  const recvValue = useMemo(() => {
    const playerTotal = recvPlayers.reduce((sum, p) => {
      const dbEntry = playerDb.find((x) => x.id === p.id);
      if (!dbEntry) return sum;
      const base = projectedSeasonValue(dbEntry, league.skaterWeights, league.goalieWeights);
      const mult = positionMultiplier(p.positions, league.roster);
      return sum + base * mult;
    }, 0);
    const keepers = league.leagueType === "keeper" ? league.keepersPerTeam : 0;
    const pickTotal = recvPicksParsed.reduce(
      (sum, pk) => sum + valueForPick(pk, talentRanking, league.teams, keepers),
      0
    );
    return playerTotal + pickTotal;
  }, [recvPlayers, recvPicksParsed, talentRanking, playerDb, league]);

  const totalRosterSize = useMemo(() => {
    return Object.values(league.roster).reduce((a, b) => a + b, 0);
  }, [league.roster]);

  const score = useMemo(() => fairnessScore(sendValue, recvValue), [sendValue, recvValue]);

  const updateLeague = (patch: Partial<League>) =>
    setLeague((prev) => ({ ...prev, ...patch }));
  const updateRoster = (pos: RosterKey, val: number) =>
    setLeague((prev) => ({ ...prev, roster: { ...prev.roster, [pos]: val } }));
  const updateSkaterWeight = (stat: SkaterStatKey, val: number) =>
    setLeague((prev) => ({ ...prev, skaterWeights: { ...prev.skaterWeights, [stat]: val } }));
  const updateGoalieWeight = (stat: GoalieStatKey, val: number) =>
    setLeague((prev) => ({ ...prev, goalieWeights: { ...prev.goalieWeights, [stat]: val } }));

  const addPlayer = (side: "send" | "recv", dbEntry: DbPlayer) => {
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    const list = side === "send" ? sendPlayers : recvPlayers;
    if (list.find((p) => p.id === dbEntry.id)) return;
    const newEntry: TradePlayer = {
      id: dbEntry.id,
      name: dbEntry.name,
      team: dbEntry.team,
      primaryPosition: dbEntry.position,
      positions: [dbEntry.position],
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Fantasy Trade Analyzer (NHL) — V3</h1>
        <ApiStatus status={dbStatus} meta={dbMeta} playerCount={playerDb.length} />
      </div>

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
          <h2 className="font-medium mb-2">Scoring Weights</h2>
          <p className="text-xs text-gray-600 mb-2">
            If your league scores both G+A and P, you&apos;re counting goals twice. Set G/A to 0 if you
            only score P, or leave P at 0 if you score G and A separately.
          </p>

          <h3 className="text-sm font-semibold mt-1 mb-1">Skaters</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
            {SKATER_STATS.map((stat) => (
              <div key={stat} className="flex items-center justify-between gap-2">
                <label className="text-sm w-16">{stat}</label>
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
        </div>
      </div>

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
            onAdd={(p) => addPlayer("recv", p)}
            onRemove={(id) => removePlayer("recv", id)}
            onTogglePos={(id, pos) => togglePosition("recv", id, pos)}
          />
        </div>
      </div>

      <div className="border rounded-2xl p-4">
        <h2 className="font-medium mb-3">Fairness Result</h2>
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <div className="text-xs text-gray-600">You Give (projected pts)</div>
            <div className="text-lg font-semibold">{sendValue.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-600">You Get (projected pts)</div>
            <div className="text-lg font-semibold">{recvValue.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-600">Fairness</div>
            <div className="text-lg font-semibold">{score.toFixed(1)} / 100</div>
          </div>
        </div>
        <div className="text-sm text-gray-700">{fairnessDescription(score)}</div>
        <div className="text-xs text-gray-500 mt-2">
          Any score over 50 leans towards you gaining more value than the other person in the
          trade. Any score below 50 means you lose value compared to the other person in the trade.
        </div>
        {(sendValue === 0 && recvValue === 0) && (
          <div className="text-xs text-amber-700 mt-2">
            All values are 0 — make sure you&apos;ve set scoring weights above and added players below.
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function ApiStatus({
  status, meta, playerCount,
}: { status: DbStatus; meta: DbMeta; playerCount: number }) {
  if (status === "loading") {
    return <div className="text-xs text-gray-500">Loading NHL data…</div>;
  }
  if (status === "error") {
    return <div className="text-xs text-red-600">NHL API unavailable — please refresh</div>;
  }
  const seasonDisplay = meta.seasonUsed
    ? `${meta.seasonUsed.slice(0, 4)}-${meta.seasonUsed.slice(6)}`
    : "";
  return (
    <div className="text-xs text-gray-600 text-right">
      <div>{playerCount} players loaded</div>
      <div>
        Season: {seasonDisplay}
        {meta.isFallback && <span className="text-amber-700"> (prior — current too sparse)</span>}
      </div>
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
  onAdd: (p: DbPlayer) => void;
  onRemove: (id: number) => void;
  onTogglePos: (id: number, pos: string) => void;
};

function TradeSide({
  label, players, picks, setPicks, parsedPicks, talentRanking, teams, keepersPerTeam,
  playerDb, dbStatus,
  roster, skaterWeights, goalieWeights,
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
  onRemove: () => void;
  onTogglePos: (pos: string) => void;
};

function PlayerRow({
  player, dbEntry, roster, skaterWeights, goalieWeights, onRemove, onTogglePos,
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
        <span className="text-gray-600">Base value: {baseValue.toFixed(1)}</span>
        <span className="font-semibold">Adjusted: {adjValue.toFixed(1)}</span>
      </div>
    </div>
  );
}
