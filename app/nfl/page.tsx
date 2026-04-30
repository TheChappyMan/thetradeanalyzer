"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import {
  DEFAULT_NFL_LEAGUE,
  type NflLeague,
  type NflDbPlayer,
  type NflPlayerPosition,
  type NflScoringWeights,
  type NflRoster,
} from "@/lib/nfl-types";
import {
  projectedNflValue,
  replacementLevelValue,
  valueAboveReplacement,
} from "@/lib/nfl-valuation";

// ============================================================
// TYPES
// ============================================================

type NflTradePlayer = {
  id: number;
  name: string;
  team: string;
  position: NflPlayerPosition;
};

type ParsedPick = {
  raw: string;
  round: number;
  slot: number;
  year: number | null;
  overall: number;
  error: string | null;
};

type DbStatus = "loading" | "ready" | "error";

type HistoryEntry = {
  id: string;
  savedAt: string;
  leagueName: string;
  sendPlayerNames: string[];
  recvPlayerNames: string[];
  sendPicks: string;
  recvPicks: string;
  sendValue: number;
  recvValue: number;
  score: number;
  verdict: string;
};

// ============================================================
// PERSISTENCE – localStorage helpers
// ============================================================

const LS_NFL_CURRENT = "fta-nfl-current-league";
const LS_NFL_HISTORY  = "fta-nfl-trade-history";
const MAX_HISTORY = 50;

function loadNflLeague(): NflLeague | null {
  try {
    const raw = localStorage.getItem(LS_NFL_CURRENT);
    return raw ? (JSON.parse(raw) as NflLeague) : null;
  } catch { return null; }
}

function saveNflLeague(league: NflLeague) {
  try { localStorage.setItem(LS_NFL_CURRENT, JSON.stringify(league)); } catch {}
}

function loadNflHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_NFL_HISTORY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch { return []; }
}

function saveNflHistory(entries: HistoryEntry[]) {
  try { localStorage.setItem(LS_NFL_HISTORY, JSON.stringify(entries)); } catch {}
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

function tradeRatingLabel(rating: number): string {
  if (rating >= 90) return "Perfect Trade";
  if (rating >= 70) return "Excellent Trade";
  if (rating >= 60) return "Good Trade";
  if (rating >= 41) return "Uneven Trade";
  if (rating >= 21) return "Bad Trade";
  return "Severely Lopsided";
}

// ============================================================
// PICK HELPERS (same logic as NHL)
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
      return { raw, round: 0, slot: 0, year, overall: 0,
        error: "Invalid format. Use round.slot (e.g., 1.01)" };
    }
    const round = parseInt(pickMatch[1], 10);
    const slot  = parseInt(pickMatch[2], 10);
    if (round < 1) return { raw, round, slot, year, overall: 0, error: "Round must be 1 or higher" };
    if (slot < 1 || slot > teams) {
      return { raw, round, slot, year, overall: 0,
        error: `Slot must be between 1 and ${teams} (your league size)` };
    }
    return { raw, round, slot, year, overall: (round - 1) * teams + slot, error: null };
  });
}

function valueForPick(
  pick: ParsedPick,
  talentRanking: number[],
  teams: number,
  keepersPerTeam: number,
): number {
  if (pick.error) return 0;
  const keeperOffset = teams * keepersPerTeam;
  const idx = keeperOffset + pick.overall - 1;
  if (idx < 0) return 0;
  if (idx >= talentRanking.length) return talentRanking[talentRanking.length - 1] || 0;
  return talentRanking[idx] || 0;
}

// ============================================================
// NFL POSITIONS ORDER
// ============================================================

const NFL_POSITIONS: NflPlayerPosition[] = ["QB", "RB", "WR", "TE", "K", "DST"];

// ============================================================
// SCORING WEIGHT LABELS
// ============================================================

type WeightKey = keyof NflScoringWeights;

type WeightGroup = { heading: string; keys: WeightKey[] };

const LEFT_WEIGHT_GROUPS: WeightGroup[] = [
  { heading: "Passing",   keys: ["passYds", "passTDs", "passInt"] },
  { heading: "Rushing",   keys: ["rushYds", "rushTDs"] },
  { heading: "Receiving", keys: ["rec", "recYds", "recTDs"] },
  { heading: "Misc",      keys: ["fumblesLost"] },
  { heading: "Kicker",    keys: ["fgMade0to39", "fgMade40to49", "fgMade50plus", "fgMissed", "patMade", "patMissed"] },
];

const RIGHT_WEIGHT_GROUPS: WeightGroup[] = [
  { heading: "Defense / ST", keys: ["sacks", "ints", "fumbRec", "defTDs"] },
  { heading: "DST Pts Allowed", keys: [
    "ptsAllowed0", "ptsAllowed1to6", "ptsAllowed7to13",
    "ptsAllowed14to20", "ptsAllowed21to27", "ptsAllowed28to34", "ptsAllowed35plus",
  ]},
];

const WEIGHT_LABELS: Record<WeightKey, string> = {
  passYds:          "Pass Yds (per yd)",
  passTDs:          "Pass TDs",
  passInt:          "Pass INTs",
  rushYds:          "Rush Yds (per yd)",
  rushTDs:          "Rush TDs",
  rec:              "Reception",
  recYds:           "Rec Yds (per yd)",
  recTDs:           "Rec TDs",
  fumblesLost:      "Fumbles Lost",
  fgMade0to39:      "FG 0–39 yds",
  fgMade40to49:     "FG 40–49 yds",
  fgMade50plus:     "FG 50+ yds",
  fgMissed:         "FG Missed",
  patMade:          "PAT Made",
  patMissed:        "PAT Missed",
  sacks:            "Sacks",
  ints:             "DEF INTs",
  fumbRec:          "Fumble Rec",
  defTDs:           "DEF/ST TDs",
  ptsAllowed0:      "Pts Allowed: 0",
  ptsAllowed1to6:   "Pts Allowed: 1–6",
  ptsAllowed7to13:  "Pts Allowed: 7–13",
  ptsAllowed14to20: "Pts Allowed: 14–20",
  ptsAllowed21to27: "Pts Allowed: 21–27",
  ptsAllowed28to34: "Pts Allowed: 28–34",
  ptsAllowed35plus: "Pts Allowed: 35+",
};

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function NflTradeAnalyzer() {
  const { user, isLoaded: clerkLoaded } = useUser();
  const tier  = (user?.publicMetadata?.tier as string) ?? "free";
  const isPro = tier === "tier1" || tier === "tier2";

  // ── League state ──────────────────────────────────────────
  const [league, setLeague] = useState<NflLeague>(() => {
    const saved = loadNflLeague();
    if (!saved) return DEFAULT_NFL_LEAGUE;
    return {
      ...DEFAULT_NFL_LEAGUE,
      ...saved,
      roster:         { ...DEFAULT_NFL_LEAGUE.roster,         ...saved.roster },
      scoringWeights: { ...DEFAULT_NFL_LEAGUE.scoringWeights, ...saved.scoringWeights },
    };
  });

  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "saved">("idle");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Player database ───────────────────────────────────────
  const [playerDb,  setPlayerDb]  = useState<NflDbPlayer[]>([]);
  const [dbStatus,  setDbStatus]  = useState<DbStatus>("loading");
  const [dbSource,  setDbSource]  = useState<"espn" | "fallback" | null>(null);

  // ── Trade state ───────────────────────────────────────────
  const [sendPlayers, setSendPlayers] = useState<NflTradePlayer[]>([]);
  const [recvPlayers, setRecvPlayers] = useState<NflTradePlayer[]>([]);
  const [sendPicks, setSendPicks] = useState("");
  const [recvPicks, setRecvPicks] = useState("");

  // ── History (free users only, local) ─────────────────────
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadNflHistory());

  // ── Load NFL player DB ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/nfl")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(({ data, source }: { data: NflDbPlayer[]; source: "espn" | "fallback" }) => {
        if (cancelled) return;
        setPlayerDb(data);
        setDbSource(source);
        setDbStatus("ready");
      })
      .catch(() => { if (!cancelled) setDbStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  // ── Auto-save league settings to localStorage (free only) ─
  useEffect(() => {
    if (isPro) return;
    saveNflLeague(league);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus("saved");
    saveTimerRef.current = setTimeout(() => setSaveStatus("idle"), 1500);
  }, [league, isPro]);

  // ── Load Pro settings from Supabase ──────────────────────
  useEffect(() => {
    if (!clerkLoaded || !isPro) return;
    let cancelled = false;
    fetch("/api/leagues?sport=nfl")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data: { settings: unknown } | null } | null) => {
        if (cancelled) return;
        const settings = json?.data?.settings;
        if (!settings) return;
        const saved = settings as NflLeague;
        setLeague({
          ...DEFAULT_NFL_LEAGUE,
          ...saved,
          roster:         { ...DEFAULT_NFL_LEAGUE.roster,         ...saved.roster },
          scoringWeights: { ...DEFAULT_NFL_LEAGUE.scoringWeights, ...saved.scoringWeights },
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isPro, clerkLoaded]);

  // ── Replacement levels per position ───────────────────────
  const replacementLevels = useMemo(() => {
    const map = new Map<NflPlayerPosition, number>();
    if (playerDb.length === 0) return map;
    for (const pos of NFL_POSITIONS) {
      map.set(pos, replacementLevelValue(
        pos, playerDb, league.scoringWeights,
        league.roster as NflRoster, league.teams, league.qbFormat,
      ));
    }
    return map;
  }, [playerDb, league.scoringWeights, league.roster, league.teams, league.qbFormat]);

  // ── Talent ranking (VAR desc) for pick valuation ──────────
  const talentRanking = useMemo(() => {
    if (playerDb.length === 0) return [];
    return playerDb
      .map((p) => {
        const proj = projectedNflValue(p, league.scoringWeights);
        const repl = replacementLevels.get(p.position) ?? 0;
        return valueAboveReplacement(proj, repl);
      })
      .sort((a, b) => b - a);
  }, [playerDb, league.scoringWeights, replacementLevels]);

  // ── Parsed picks ───────────────────────────────────────────
  const sendPicksParsed = useMemo(
    () => parsePicks(sendPicks, league.teams), [sendPicks, league.teams]);
  const recvPicksParsed = useMemo(
    () => parsePicks(recvPicks, league.teams), [recvPicks, league.teams]);

  // ── Trade values ───────────────────────────────────────────
  const keepersPerTeam = league.leagueType === "keeper" ? league.keepersPerTeam : 0;

  const sendValue = useMemo(() => {
    const playerTotal = sendPlayers.reduce((sum, p) => {
      const db = playerDb.find((x) => x.id === p.id);
      if (!db) return sum;
      const proj = projectedNflValue(db, league.scoringWeights);
      const repl = replacementLevels.get(p.position) ?? 0;
      return sum + valueAboveReplacement(proj, repl);
    }, 0);
    const pickTotal = sendPicksParsed.reduce(
      (sum, pk) => sum + valueForPick(pk, talentRanking, league.teams, keepersPerTeam), 0);
    return playerTotal + pickTotal;
  }, [sendPlayers, sendPicksParsed, talentRanking, playerDb, league.scoringWeights,
      replacementLevels, league.teams, keepersPerTeam]);

  const recvValue = useMemo(() => {
    const playerTotal = recvPlayers.reduce((sum, p) => {
      const db = playerDb.find((x) => x.id === p.id);
      if (!db) return sum;
      const proj = projectedNflValue(db, league.scoringWeights);
      const repl = replacementLevels.get(p.position) ?? 0;
      return sum + valueAboveReplacement(proj, repl);
    }, 0);
    const pickTotal = recvPicksParsed.reduce(
      (sum, pk) => sum + valueForPick(pk, talentRanking, league.teams, keepersPerTeam), 0);
    return playerTotal + pickTotal;
  }, [recvPlayers, recvPicksParsed, talentRanking, playerDb, league.scoringWeights,
      replacementLevels, league.teams, keepersPerTeam]);

  const score = useMemo(() => fairnessScore(sendValue, recvValue), [sendValue, recvValue]);

  const minVal = Math.min(sendValue, recvValue);
  const maxVal = Math.max(sendValue, recvValue);
  const tradeRating = (minVal === 0 || maxVal === 0)
    ? 0
    : Math.round(100 * Math.exp(-2.5 * (maxVal / minVal - 1)) * 10) / 10;

  const ratio = (minVal === 0 || maxVal === 0) ? Infinity : maxVal / minVal;
  const youWin = recvValue >= sendValue;
  const ratioDistance = Math.min(50, (1 - Math.exp(-2.5 * (ratio - 1))) * 50);
  const displayScore = youWin ? 50 + ratioDistance : 50 - ratioDistance;

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

  // ── Auto-save trades for Pro users (5s debounce) ──────────
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
        leagueName: league.name.trim() || "Unnamed NFL League",
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
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [isPro, sendPlayers, recvPlayers, sendPicks, recvPicks]);

  // ── Updaters ───────────────────────────────────────────────
  const updateLeague = (patch: Partial<NflLeague>) =>
    setLeague((prev) => ({ ...prev, ...patch }));

  const updateRoster = (pos: keyof NflRoster, val: number) =>
    setLeague((prev) => ({ ...prev, roster: { ...prev.roster, [pos]: val } }));

  const updateWeight = (key: WeightKey, val: number) =>
    setLeague((prev) => ({
      ...prev,
      scoringWeights: { ...prev.scoringWeights, [key]: val },
    }));

  const updatePprFormat = (pprFormat: "standard" | "half" | "full") => {
    const rec = pprFormat === "standard" ? 0 : pprFormat === "half" ? 0.5 : 1.0;
    setLeague((prev) => ({
      ...prev,
      pprFormat,
      scoringWeights: { ...prev.scoringWeights, rec },
    }));
  };

  const addPlayer = (side: "send" | "recv", dbEntry: NflDbPlayer) => {
    const list = side === "send" ? sendPlayers : recvPlayers;
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    if (list.find((p) => p.id === dbEntry.id)) return;
    setter([...list, {
      id: dbEntry.id,
      name: dbEntry.name,
      team: dbEntry.team,
      position: dbEntry.position,
    }]);
  };

  const removePlayer = (side: "send" | "recv", id: number) => {
    const setter = side === "send" ? setSendPlayers : setRecvPlayers;
    setter((prev) => prev.filter((p) => p.id !== id));
  };

  const saveToHistory = useCallback(() => {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: new Date().toISOString(),
      leagueName: league.name.trim() || "Unnamed NFL League",
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
      fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      }).catch(() => {});
    } else {
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(updated);
      saveNflHistory(updated);
    }
  }, [isPro, league.name, sendPlayers, recvPlayers, sendPicks, recvPicks,
      sendValue, recvValue, score, history]);

  const deleteHistoryEntry = useCallback((id: string) => {
    const updated = history.filter((e) => e.id !== id);
    setHistory(updated);
    saveNflHistory(updated);
  }, [history]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveNflHistory([]);
  }, []);

  const hasAnything = sendPlayers.length > 0 || recvPlayers.length > 0 ||
    sendPicks.trim() !== "" || recvPicks.trim() !== "";

  const totalRosterSize = useMemo(
    () => Object.values(league.roster).reduce((a, b) => a + b, 0),
    [league.roster]
  );

  if (!clerkLoaded) return <div className="p-6 max-w-6xl mx-auto" />;

  return (
    <>
      {isPro && <ProNav />}
      {!isPro && (
        <div style={{ background: "#f3f4f6", padding: "0.5rem 1rem", fontSize: "0.75rem", marginBottom: "0.5rem" }}>
          💡 Save your settings and trade history — upgrade to Pro
        </div>
      )}
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold">NFL Trade Analyzer</h1>
          <NflApiStatus status={dbStatus} source={dbSource} playerCount={playerDb.length} />
        </div>

        {/* ── League Settings + Scoring (free only) ─────────── */}
        {!isPro && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

            {/* League Settings */}
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
                type="number" min={2}
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
                    type="number" min={0}
                    className="border rounded-xl p-2 w-full mb-2"
                    value={league.keepersPerTeam}
                    onChange={(e) => updateLeague({ keepersPerTeam: parseInt(e.target.value || "0", 10) })}
                  />
                </>
              )}

              <label className="text-sm">QB Format</label>
              <select
                className="border rounded-xl p-2 w-full mb-2"
                value={league.qbFormat}
                onChange={(e) => updateLeague({ qbFormat: e.target.value as "1QB" | "2QB" })}
              >
                <option value="1QB">1QB</option>
                <option value="2QB">2QB / Superflex</option>
              </select>

              <label className="text-sm">PPR Format</label>
              <select
                className="border rounded-xl p-2 w-full mb-2"
                value={league.pprFormat}
                onChange={(e) => updatePprFormat(e.target.value as "standard" | "half" | "full")}
              >
                <option value="standard">Standard (non-PPR)</option>
                <option value="half">Half PPR (0.5)</option>
                <option value="full">Full PPR (1.0)</option>
              </select>

              <h3 className="text-sm font-semibold mt-3 mb-2">Roster Slots</h3>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(league.roster) as (keyof NflRoster)[]).map((pos) => (
                  <label key={pos} className="text-xs flex items-center gap-2">
                    <span className="w-12">{pos}</span>
                    <input
                      type="number" min={0}
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

              {saveStatus === "saved" && (
                <div className="text-xs text-green-600 mt-2">✓ Auto-saved</div>
              )}
            </div>

            {/* Scoring */}
            <div className="border rounded-2xl p-4">
              <h2 className="font-medium mb-2">Scoring Weights</h2>
              <p className="text-xs text-gray-600 mb-3">
                Changing PPR Format above auto-updates the Reception weight.
                Adjust any weight to match your league exactly.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {/* Left column */}
                <div>
                  {LEFT_WEIGHT_GROUPS.map(({ heading, keys }) => (
                    <div key={heading} className="mb-3">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        {heading}
                      </h3>
                      <div className="space-y-1">
                        {keys.map((key) => (
                          <div key={key} className="flex items-center justify-between gap-2">
                            <label className="text-xs text-gray-700 flex-1">
                              {WEIGHT_LABELS[key]}
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              className="border rounded-xl p-1 w-20 text-sm"
                              value={league.scoringWeights[key]}
                              onChange={(e) => updateWeight(key, parseFloat(e.target.value || "0"))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Right column */}
                <div>
                  {RIGHT_WEIGHT_GROUPS.map(({ heading, keys }) => (
                    <div key={heading} className="mb-3">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                        {heading}
                      </h3>
                      <div className="space-y-1">
                        {keys.map((key) => (
                          <div key={key} className="flex items-center justify-between gap-2">
                            <label className="text-xs text-gray-700 flex-1">
                              {WEIGHT_LABELS[key]}
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              className="border rounded-xl p-1 w-20 text-sm"
                              value={league.scoringWeights[key]}
                              onChange={(e) => updateWeight(key, parseFloat(e.target.value || "0"))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Trade Panel ────────────────────────────────────── */}
        <div className="border rounded-2xl p-4 mb-6">
          <h2 className="font-medium mb-3">Trade Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NflTradeSide
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
              scoringWeights={league.scoringWeights}
              replacementLevels={replacementLevels}
              onAdd={(p) => addPlayer("send", p)}
              onRemove={(id) => removePlayer("send", id)}
            />
            <NflTradeSide
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
              scoringWeights={league.scoringWeights}
              replacementLevels={replacementLevels}
              onAdd={(p) => addPlayer("recv", p)}
              onRemove={(id) => removePlayer("recv", id)}
            />
          </div>
        </div>

        {/* ── Fairness Result ────────────────────────────────── */}
        <div className="border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Fairness Result</h2>
            {isPro ? (
              autoSaveStatus === "saved" && (
                <span className="text-xs text-green-600">✓ Auto-saved</span>
              )
            ) : (
              <button
                className="text-xs bg-blue-600 text-white rounded-lg px-3 py-1 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={!hasAnything}
                onClick={saveToHistory}
              >
                Save to History
              </button>
            )}
          </div>

          <div className="grid grid-cols-4 gap-4 mb-3">
            <div>
              <div className="text-xs text-gray-600">You Give (VAR pts)</div>
              <div className="text-lg font-semibold">{sendValue.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">You Get (VAR pts)</div>
              <div className="text-lg font-semibold">{recvValue.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Trade Rating</div>
              <div className="text-lg font-semibold">{tradeRating.toFixed(1)} / 100</div>
            </div>
            <div>
              <div className="text-xs text-gray-600">Trade Outline</div>
              <div className="text-sm font-medium text-gray-800">{tradeOutline(displayScore)}</div>
            </div>
          </div>

          {/* Fairness Scale Bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Opponent Wins</span>
              <span className="font-medium text-gray-600">Fairness Scale</span>
              <span>You Win Too Much</span>
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
                style={{ left: `${displayScore}%` }}
              />
            </div>
          </div>

          {sendValue === 0 && recvValue === 0 && (
            <div className="text-xs text-amber-700 mt-2">
              All values are 0 — make sure you&apos;ve set scoring weights and added players.
            </div>
          )}
        </div>

        {/* ── Local trade history (free users) ──────────────── */}
        {history.length > 0 && (
          <div className="border rounded-2xl p-4 mt-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-medium">Trade History</h2>
              <button
                className="text-xs text-red-500 hover:text-red-700"
                onClick={clearHistory}
              >
                Clear All
              </button>
            </div>
            <div className="space-y-2">
              {history.map((entry) => (
                <NflHistoryRow key={entry.id} entry={entry} onDelete={deleteHistoryEntry} />
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

function NflApiStatus({
  status, source, playerCount,
}: { status: DbStatus; source: "espn" | "fallback" | null; playerCount: number }) {
  if (status === "loading") return <div className="text-xs text-gray-500">Loading NFL data…</div>;
  if (status === "error")   return <div className="text-xs text-red-600">NFL API unavailable — please refresh</div>;
  return (
    <div className="text-xs text-gray-600 text-right">
      <div>{playerCount} players loaded</div>
      {source === "fallback" && (
        <div className="text-amber-700">Using curated fallback data</div>
      )}
      {source === "espn" && <div>Live ESPN data</div>}
    </div>
  );
}

// ── Trade side ────────────────────────────────────────────────

type NflTradeSideProps = {
  label: string;
  players: NflTradePlayer[];
  picks: string;
  setPicks: (v: string) => void;
  parsedPicks: ParsedPick[];
  talentRanking: number[];
  teams: number;
  keepersPerTeam: number;
  playerDb: NflDbPlayer[];
  dbStatus: DbStatus;
  scoringWeights: NflScoringWeights;
  replacementLevels: Map<NflPlayerPosition, number>;
  onAdd: (p: NflDbPlayer) => void;
  onRemove: (id: number) => void;
};

function NflTradeSide({
  label, players, picks, setPicks, parsedPicks, talentRanking, teams, keepersPerTeam,
  playerDb, dbStatus, scoringWeights, replacementLevels, onAdd, onRemove,
}: NflTradeSideProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{label} — Players</h3>
      <NflPlayerTypeahead
        playerDb={playerDb}
        dbStatus={dbStatus}
        existingIds={players.map((p) => p.id)}
        onSelect={onAdd}
      />
      <div className="mt-2 space-y-2">
        {players.map((p) => (
          <NflPlayerRow
            key={p.id}
            player={p}
            dbEntry={playerDb.find((x) => x.id === p.id)}
            scoringWeights={scoringWeights}
            replacementLevels={replacementLevels}
            onRemove={() => onRemove(p.id)}
          />
        ))}
      </div>

      <h3 className="text-sm font-semibold mt-4 mb-1">{label} — Picks</h3>
      <p className="text-xs text-gray-600 mb-1">
        Enter picks as <span className="font-mono">round.slot</span> (e.g.,{" "}
        <span className="font-mono">1.01</span> = first round, first overall).
        Separate multiple picks with commas or new lines.
        Optionally prefix with a year (e.g., <span className="font-mono">2026 1.01</span>).
      </p>
      <textarea
        className="border rounded-xl p-2 w-full h-14 text-sm"
        placeholder="1.01, 2.05"
        value={picks}
        onChange={(e) => setPicks(e.target.value)}
      />
      <NflParsedPicksList
        parsedPicks={parsedPicks}
        talentRanking={talentRanking}
        teams={teams}
        keepersPerTeam={keepersPerTeam}
      />
    </div>
  );
}

// ── Player row ────────────────────────────────────────────────

type NflPlayerRowProps = {
  player: NflTradePlayer;
  dbEntry: NflDbPlayer | undefined;
  scoringWeights: NflScoringWeights;
  replacementLevels: Map<NflPlayerPosition, number>;
  onRemove: () => void;
};

function NflPlayerRow({
  player, dbEntry, scoringWeights, replacementLevels, onRemove,
}: NflPlayerRowProps) {
  if (!dbEntry) return null;
  const projected = projectedNflValue(dbEntry, scoringWeights);
  const repl      = replacementLevels.get(player.position) ?? 0;
  const varValue  = valueAboveReplacement(projected, repl);

  return (
    <div className="border rounded-xl p-2 bg-gray-50 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-semibold">{player.name}</span>
          <span className="text-gray-500 ml-2">
            {dbEntry.team} · {player.position} · {dbEntry.gamesPlayed} GP
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
      <div className="mt-1 flex justify-between text-gray-600">
        <span>Projected: {projected.toFixed(1)}</span>
        <span className="font-semibold text-gray-800">VAR: {varValue.toFixed(1)}</span>
      </div>
    </div>
  );
}

// ── Parsed picks list ─────────────────────────────────────────

function NflParsedPicksList({
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
              talent rank {talentRank} · VAR {value.toFixed(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Player typeahead ──────────────────────────────────────────

type NflPlayerTypeaheadProps = {
  playerDb: NflDbPlayer[];
  dbStatus: DbStatus;
  existingIds: number[];
  onSelect: (p: NflDbPlayer) => void;
};

function NflPlayerTypeahead({ playerDb, dbStatus, existingIds, onSelect }: NflPlayerTypeaheadProps) {
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
      .filter((p) => !existingIds.includes(p.id) && p.name.toLowerCase().includes(q))
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
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((i) => (i + 1) % matches.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((i) => (i - 1 + matches.length) % matches.length); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const selected = matches[highlightIdx];
      if (selected) { onSelect(selected); setQuery(""); setHighlightIdx(0); }
    } else if (e.key === "Escape") { setOpen(false); }
  };

  const placeholder = dbStatus === "loading" ? "Loading players…"
    : dbStatus === "error" ? "Player data unavailable"
    : "Search for a player…";

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

// ── ProNav ────────────────────────────────────────────────────

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
        <Link key={href} href={href} className="text-gray-200 hover:text-white transition-colors">
          {label}
        </Link>
      ))}
    </nav>
  );
}

// ── History row ───────────────────────────────────────────────

function NflHistoryRow({
  entry, onDelete,
}: { entry: HistoryEntry; onDelete: (id: string) => void }) {
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
          >×</button>
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
              <div className="text-gray-600 mt-1">VAR: <span className="font-medium">{entry.sendValue.toFixed(1)}</span></div>
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-1">You Got</div>
              {entry.recvPlayerNames.length > 0 && <div className="mb-1">{entry.recvPlayerNames.join(", ")}</div>}
              {entry.recvPicks && <div className="text-gray-500">Picks: {entry.recvPicks}</div>}
              <div className="text-gray-600 mt-1">VAR: <span className="font-medium">{entry.recvValue.toFixed(1)}</span></div>
            </div>
          </div>
          <div className="text-gray-700 italic">{entry.verdict}</div>
        </div>
      )}
    </div>
  );
}
