"use client";

import ClearableSearch from "@/app/components/ClearableSearch";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLeagueContext } from "@/lib/league-context";
import { loadSessionLeague, saveSessionLeague } from "@/lib/session-league";
import { useUser } from "@clerk/nextjs";
import {
  DEFAULT_NFL_LEAGUE,
  type NflLeague,
  type NflDbPlayer,
  type NflPlayerPosition,
  type NflPlayerStats,
  type NflRoster,
} from "@/lib/nfl-types";
import {
  projectedNflValue,
  replacementLevelValue,
  valueAboveReplacement,
  rbScarcityMultiplier,
  teScarcityMultiplier,
} from "@/lib/nfl-valuation";
import { draftRounds } from "@/lib/draft";
import {
  REC_STYLES, OVERWHELM, recTiersFor, useDraftState, computeNextPick, computeMarkerIndex,
  DraftToggleRow, DraftPanel, MarkerRow, RecBadge, DraftCells, DraftConsistencyNotice,
} from "./draft-shared";

// ============================================================
// NFL LEAGUE RANKINGS
// ============================================================
// Available to ALL signed-in users (free and paid). Ranks every player by
// projected points under the user's own league settings (paid users load
// their saved league; free users get the standard defaults), and highlights
// the stats where a player beats the average of the DRAFTABLE pool — the
// top (teams × roster spots) players — at his position.

// Data modes: two actuals seasons plus two Sleeper-projection modes.
// Projections are raw stat lines scored under the user's league settings,
// exactly like real stats — see /api/nfl?endpoint=projections.
type DataMode  = "lastTotal" | "thisTotal" | "thisProj" | "restProj";
type DbStatus  = "loading" | "ready" | "error";
type LeagueRow = { id: string; name: string; sport: string; settings: unknown };

// The rankings mode set diverges from the analyzer's (projection modes),
// so it gets its own storage key rather than sharing fta-nfl-data-mode.
const LS_NFL_RANKINGS_MODE = "fta-nfl-rankings-mode";

type ProjPayload = {
  seasonId: string;
  week: number; // completed regular-season weeks (0 in pre-season)
  players: NflDbPlayer[];
  restOfSeason: NflDbPlayer[];
  source: "sleeper" | "cache" | "fallback";
  fetchedAt: string | null;
  fallbackGeneratedAt?: string | null;
};

const NFL_POSITIONS: NflPlayerPosition[] = ["QB", "RB", "WR", "TE", "K", "DST"];

// Stat columns shown per position. `perGame: true` displays total/GP
// (used for DST points allowed, which is unreadable as a season total).
type StatColumn = { key: keyof NflPlayerStats; label: string; perGame?: boolean };

const POSITION_COLUMNS: Record<NflPlayerPosition, StatColumn[]> = {
  QB: [
    { key: "passYds", label: "Pass Yds" }, { key: "passTDs", label: "Pass TD" },
    { key: "passInt", label: "INT" }, { key: "rushYds", label: "Rush Yds" },
    { key: "rushTDs", label: "Rush TD" },
  ],
  RB: [
    { key: "rushAtt", label: "Att" }, { key: "rushYds", label: "Rush Yds" },
    { key: "rushTDs", label: "Rush TD" }, { key: "rec", label: "Rec" },
    { key: "recYds", label: "Rec Yds" }, { key: "recTDs", label: "Rec TD" },
    { key: "fumblesLost", label: "Fum" },
  ],
  WR: [
    { key: "rec", label: "Rec" }, { key: "recYds", label: "Rec Yds" },
    { key: "recTDs", label: "Rec TD" }, { key: "rushYds", label: "Rush Yds" },
    { key: "rushTDs", label: "Rush TD" },
  ],
  TE: [
    { key: "rec", label: "Rec" }, { key: "recYds", label: "Rec Yds" },
    { key: "recTDs", label: "Rec TD" },
  ],
  K: [
    { key: "fgMade0to39", label: "FG 0–39" }, { key: "fgMade40to49", label: "FG 40–49" },
    { key: "fgMade50plus", label: "FG 50+" }, { key: "fgMissed", label: "FG Miss" },
    { key: "patMade", label: "PAT" },
  ],
  DST: [
    { key: "sacks", label: "Sacks" }, { key: "ints", label: "INT" },
    { key: "fumbRec", label: "Fum Rec" }, { key: "defTDs", label: "TD" },
    { key: "ptsAllowed", label: "PA/G", perGame: true },
  ],
};

// Stats where LOWER is better — highlight when below the pool average
const NEGATIVE_STATS = new Set<keyof NflPlayerStats>([
  "passInt", "fumblesLost", "fgMissed", "patMissed", "ptsAllowed",
]);

const DATA_MODES: DataMode[] = ["lastTotal", "thisTotal", "thisProj", "restProj"];

export default function NflRankings() {
  const { user, isLoaded: clerkLoaded } = useUser();
  const tier    = (user?.publicMetadata?.tier as string) ?? "free";
  const isPro   = tier === "tier1" || tier === "tier2" || tier === "tier3";
  const { selectedLeagueId: ctxLeagueIds } = useLeagueContext();

  // ── League settings ───────────────────────────────────────
  // Every premium user gets a league selector; the initial selection
  // follows the league chosen on the dashboard (league context).
  const [league, setLeague] = useState<NflLeague>(DEFAULT_NFL_LEAGUE);
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

  useEffect(() => {
    if (!clerkLoaded || !isPro) return;
    let cancelled = false;
    fetch("/api/leagues?sport=nfl")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data: LeagueRow[] } | null) => {
        if (cancelled) return;
        const rows = json?.data ?? [];
        setLeagues(rows);
        const ctxId = ctxLeagueIds["nfl"];
        setActiveLeagueId(rows.find((r) => r.id === ctxId)?.id ?? rows[0]?.id ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clerkLoaded, isPro]); // eslint-disable-line react-hooks/exhaustive-deps

  // Free users: pick up the session-scoped settings configured on the
  // analyzer page (Pro users load their saved leagues above instead).
  useEffect(() => {
    if (!clerkLoaded || isPro) return;
    const saved = loadSessionLeague<NflLeague>("nfl");
    if (saved) applySettings(saved);
  }, [clerkLoaded, isPro]);

  useEffect(() => {
    if (!activeLeagueId) return;
    const row = leagues.find((r) => r.id === activeLeagueId);
    if (row?.settings) applySettings(row.settings as NflLeague);
  }, [activeLeagueId, leagues]);

  function applySettings(settings: NflLeague) {
    setLeague({
      ...DEFAULT_NFL_LEAGUE,
      ...settings,
      roster:         { ...DEFAULT_NFL_LEAGUE.roster,         ...settings.roster },
      scoringWeights: { ...DEFAULT_NFL_LEAGUE.scoringWeights, ...settings.scoringWeights },
    });
  }

  // ── Player data (live via /api/nfl) ───────────────────────
  const [currentSeasonDb, setCurrentSeasonDb] = useState<NflDbPlayer[]>([]);
  const [priorSeasonDb,   setPriorSeasonDb]   = useState<NflDbPlayer[]>([]);
  const [currentSeasonId, setCurrentSeasonId] = useState("");
  const [priorSeasonId,   setPriorSeasonId]   = useState("");
  const [dbStatus, setDbStatus] = useState<DbStatus>("loading");
  const [projections, setProjections] = useState<ProjPayload | null>(null);
  const [projStatus, setProjStatus] = useState<DbStatus>("loading");
  const [dataMode, setDataModeState] = useState<DataMode>(() => {
    try {
      const v = localStorage.getItem(LS_NFL_RANKINGS_MODE) as DataMode | null;
      if (v && DATA_MODES.includes(v)) return v;
    } catch {}
    return "thisProj"; // pre-season/draft default; corrected below if unavailable
  });
  const setDataMode = (m: DataMode) => {
    setDataModeState(m);
    try { localStorage.setItem(LS_NFL_RANKINGS_MODE, m); } catch {}
  };

  useEffect(() => {
    type SeasonPayload = { seasonId: string; players: NflDbPlayer[]; hasData: boolean };
    let cancelled = false;
    fetch("/api/nfl?endpoint=all-seasons")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: { currentSeason: SeasonPayload; priorSeason: SeasonPayload }) => {
        if (cancelled) return;
        setCurrentSeasonDb(json.currentSeason.players);
        setPriorSeasonDb(json.priorSeason.players);
        setCurrentSeasonId(json.currentSeason.seasonId);
        setPriorSeasonId(json.priorSeason.seasonId);
        setDbStatus("ready");
      })
      .catch(() => { if (!cancelled) setDbStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/nfl?endpoint=projections")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json: ProjPayload) => {
        if (cancelled) return;
        // Shape check: the upstream endpoints are undocumented, so never
        // trust the payload blindly.
        if (!Array.isArray(json.players) || !Array.isArray(json.restOfSeason)) throw new Error();
        setProjections(json);
        setProjStatus(json.players.length > 0 ? "ready" : "error");
      })
      .catch(() => { if (!cancelled) setProjStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  const projAvailable = projStatus === "ready" && (projections?.players.length ?? 0) > 0;

  // "This year" is the projection season. Before the September data
  // rollover the stats route's "current" season is still last year's, so
  // map seasons by id instead of trusting current/prior labels.
  const thisYearId = projections?.seasonId || currentSeasonId;
  const lastYearId = thisYearId ? String(Number(thisYearId) - 1) : priorSeasonId;
  const dbFor = (id: string): NflDbPlayer[] =>
    id === currentSeasonId ? currentSeasonDb : id === priorSeasonId ? priorSeasonDb : [];
  const thisYearDb = dbFor(thisYearId);
  const lastYearDb = dbFor(lastYearId).length > 0 ? dbFor(lastYearId) : currentSeasonDb;
  const hasThisYearData = thisYearDb.length > 0;

  // Kick the mode off unavailable choices once both fetches settle.
  useEffect(() => {
    if (dbStatus !== "ready" || projStatus === "loading") return;
    setDataModeState((prev) => {
      if ((prev === "thisProj" || prev === "restProj") && !projAvailable) return "lastTotal";
      if (prev === "thisTotal" && !hasThisYearData) return projAvailable ? "thisProj" : "lastTotal";
      return prev;
    });
  }, [dbStatus, projStatus, projAvailable, hasThisYearData]);

  const playerDb = useMemo(() => {
    switch (dataMode) {
      case "thisProj": return projections?.players ?? [];
      case "restProj": return projections?.restOfSeason ?? [];
      case "thisTotal": return thisYearDb;
      default: return lastYearDb;
    }
  }, [dataMode, projections, thisYearDb, lastYearDb]);

  // All four modes are season-shaped totals (projections included), so the
  // engine never per-game normalizes here.
  const useRates = false;
  const isProjMode = dataMode === "thisProj" || dataMode === "restProj";

  // ── Rankings ──────────────────────────────────────────────
  const replacementLevels = useMemo(() => {
    const map = new Map<NflPlayerPosition, number>();
    if (playerDb.length === 0) return map;
    for (const pos of NFL_POSITIONS) {
      map.set(pos, replacementLevelValue(
        pos, playerDb, league.scoringWeights,
        league.roster as NflRoster, league.teams, league.qbFormat, useRates,
      ));
    }
    return map;
  }, [playerDb, league.scoringWeights, league.roster, league.teams, league.qbFormat, useRates]);

  type RankedPlayer = { p: NflDbPlayer; proj: number; var_: number; rank: number };

  // Rank by VAR, not raw projected points — QBs out-point every other
  // position raw, which floated all QBs to the top even in 1QB leagues
  // while the recommendation engine (correctly) favored RBs. Ties at 0 VAR
  // (below-replacement players) break by projection.
  const ranked: RankedPlayer[] = useMemo(() => {
    return playerDb
      .map((p) => {
        const proj = projectedNflValue(p, league.scoringWeights, useRates);
        const repl = replacementLevels.get(p.position) ?? 0;
        return { p, proj, var_: valueAboveReplacement(proj, repl), rank: 0 };
      })
      .sort((a, b) => b.var_ - a.var_ || b.proj - a.proj)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [playerDb, league.scoringWeights, replacementLevels, useRates]);

  // ── Draftable pool + per-position stat averages ───────────
  // Draftable = top (teams × roster spots excl. IR) players by VAR.
  const draftableN = useMemo(() => {
    const r = league.roster;
    const spots = (r.QB ?? 0) + (r.RB ?? 0) + (r.WR ?? 0) + (r.TE ?? 0) +
                  (r.FLEX ?? 0) + (r.K ?? 0) + (r.DST ?? 0) + (r.BN ?? 0);
    return league.teams * spots;
  }, [league.roster, league.teams]);

  const poolAverages = useMemo(() => {
    const draftable = ranked.slice(0, draftableN);
    const byPos = new Map<NflPlayerPosition, Record<string, number>>();
    for (const pos of NFL_POSITIONS) {
      const members = draftable.filter((r) => r.p.position === pos);
      if (members.length === 0) continue;
      const avg: Record<string, number> = {};
      for (const col of POSITION_COLUMNS[pos]) {
        const values = members.map((m) => {
          const raw = m.p.stats[col.key] ?? 0;
          return col.perGame ? raw / Math.max(1, m.p.gamesPlayed) : raw;
        });
        avg[col.key as string] = values.reduce((a, b) => a + b, 0) / values.length;
      }
      byPos.set(pos, avg);
    }
    return byPos;
  }, [ranked, draftableN]);

  // ── Draft Mode (shared state/UI in ./draft-shared) ────────
  const {
    draftOn, setDraftOn: setDraftOnRaw, taken, setPlayerTaken, resetTaken,
    hideDrafted, setHideDrafted, confirmReset, setConfirmReset,
    takenCount, mineCount,
  } = useDraftState("nfl", activeLeagueId);
  const draftActive = draftOn && isPro;
  const setDraftOn = (on: boolean) => {
    setDraftOnRaw(on);
    // Projections are the default basis whenever Draft Mode is on.
    if (on && projAvailable) setDataMode("thisProj");
  };

  // ── Next-pick marker ──────────────────────────────────────
  const nextPick = useMemo(() => {
    if (!draftActive) return null;
    return computeNextPick(league.draftPicks, league.teams, draftRounds(league.roster), takenCount, mineCount);
  }, [draftActive, league.draftPicks, league.teams, league.roster, takenCount, mineCount]);

  // ── Recommendations: recomputed on every checkbox change ──
  // Same VAR engine as the table, but priced against the AVAILABLE pool
  // only (bars shift as players come off the board), with RB/TE scarcity
  // multipliers applied and roster-need awareness for my picks.
  const draftRec = useMemo(() => {
    if (!draftActive || playerDb.length === 0) return null;
    const available = playerDb.filter((p) => taken[p.id] === undefined);
    if (available.length === 0) return null;
    const weights = league.scoringWeights;
    const roster = league.roster as NflRoster;

    const repl = new Map<NflPlayerPosition, number>();
    for (const pos of NFL_POSITIONS) {
      repl.set(pos, replacementLevelValue(
        pos, available, weights, roster, league.teams, league.qbFormat, useRates));
    }
    const projOf = new Map(available.map((p) => [p.id, projectedNflValue(p, weights, useRates)]));
    const baseVar = (p: NflDbPlayer) =>
      valueAboveReplacement(projOf.get(p.id) ?? 0, repl.get(p.position) ?? 0);

    // RB/TE scarcity multipliers by VAR rank among available at the position
    const scarcityRank = new Map<number, number>();
    for (const pos of ["RB", "TE", "QB"] as const) {
      available
        .filter((p) => p.position === pos)
        .sort((a, b) => baseVar(b) - baseVar(a))
        .forEach((p, i) => scarcityRank.set(p.id, i + 1));
    }
    // Superflex/2QB: QBs are the scarcest superflex asset, but raw VAR
    // against the QB pool alone leaves them behind scarcity-boosted RBs.
    // Mirror the RB/TE market-calibration tiers so top QBs surface early
    // the way superflex drafts actually run. Recommendation layer only —
    // the shared engine and trade values are untouched, and 1QB leagues
    // never apply it.
    const qbSuperflexMultiplier = (rank: number): number =>
      rank <= 5 ? 1.40 : rank <= 10 ? 1.25 : rank <= 15 ? 1.10 : 1.0;
    const adjVar = (p: NflDbPlayer) => {
      const v = baseVar(p);
      const rank = scarcityRank.get(p.id);
      if (!rank) return v;
      if (p.position === "RB") return v * rbScarcityMultiplier(rank);
      if (p.position === "TE") return v * teScarcityMultiplier(rank);
      if (p.position === "QB" && league.qbFormat === "2QB") return v * qbSuperflexMultiplier(rank);
      return v;
    };

    // Fill my roster slots with my drafted players, best first. Dedicated
    // slots fill first; FLEX only once a skill player's dedicated slots are
    // full; in 2QB/Superflex the second QB slot prefers QBs by value (mine
    // are processed in value order). Everything else lands on the bench.
    const qbSlots = league.qbFormat === "2QB" ? Math.max(roster.QB ?? 1, 2) : (roster.QB ?? 1);
    const open: Record<string, number> = {
      QB: qbSlots, RB: roster.RB ?? 0, WR: roster.WR ?? 0, TE: roster.TE ?? 0,
      K: roster.K ?? 0, DST: roster.DST ?? 0, FLEX: roster.FLEX ?? 0, BN: roster.BN ?? 0,
    };
    const slotOrder = (pos: NflPlayerPosition): string[] =>
      pos === "QB" ? ["QB", "BN"]
      : pos === "K" || pos === "DST" ? [pos, "BN"]
      : [pos, "FLEX", "BN"];
    const mine = playerDb.filter((p) => taken[p.id] === "mine");
    const mineByValue = [...mine].sort(
      (a, b) => projectedNflValue(b, weights, useRates) - projectedNflValue(a, weights, useRates));
    for (const p of mineByValue) {
      for (const s of slotOrder(p.position)) {
        if (open[s] > 0) { open[s]--; break; }
      }
    }

    // Positional targets: starters + bench share, mirroring the engine's
    // bench-aware replacement (1 bench to QB, rest proportional RB/WR/TE).
    const bench = roster.BN ?? 0;
    const qbBench = Math.min(1, bench);
    const remainingBench = Math.max(0, bench - qbBench);
    const flex = roster.FLEX ?? 0;
    const rbSF = (roster.RB ?? 0) + flex * 0.5;
    const wrSF = (roster.WR ?? 0) + flex * 0.4;
    const teSF = (roster.TE ?? 0) + flex * 0.1;
    const sfTotal = rbSF + wrSF + teSF;
    const benchFor = (sf: number) => (sfTotal > 0 ? remainingBench * (sf / sfTotal) : 0);
    const target: Record<NflPlayerPosition, number> = {
      QB: qbSlots + qbBench,
      RB: rbSF + benchFor(rbSF),
      WR: wrSF + benchFor(wrSF),
      TE: teSF + benchFor(teSF),
      K: roster.K ?? 0,
      DST: roster.DST ?? 0,
    };
    const myCount: Record<string, number> = {};
    for (const p of mine) myCount[p.position] = (myCount[p.position] ?? 0) + 1;
    const needs = (pos: NflPlayerPosition) => (myCount[pos] ?? 0) < target[pos] - 1e-9;

    // K/DST suppression: never recommend until my final two owned picks,
    // unless every skill-position need is already fully covered.
    const skillNeedsRemain = (["QB", "RB", "WR", "TE"] as const).some(needs);
    const picksRemaining = nextPick?.picksRemaining ?? 0;
    const allowKDst = picksRemaining > 0 && (picksRemaining <= 2 || !skillNeedsRemain);

    const candidates = available.filter((p) =>
      p.position === "K" || p.position === "DST" ? allowKDst : true);
    const scored = candidates
      .map((p) => ({ p, value: adjVar(p), need: needs(p.position) }))
      .sort((a, b) => b.value - a.value);
    const bestNeed = scored.find((s) => s.need)?.value ?? 0;
    let recs = scored.filter((s) => s.need || s.value >= bestNeed * OVERWHELM).slice(0, 5);

    // Final two owned picks: unfilled K/DST slots lead the recommendations
    // (raw VAR would keep burying them under leftover skill players).
    if (picksRemaining > 0 && picksRemaining <= 2) {
      const kdBest = (["K", "DST"] as const)
        .filter(needs)
        .map((pos) => scored.find((s) => s.p.position === pos))
        .filter((s): s is NonNullable<typeof s> => s !== undefined);
      if (kdBest.length > 0) {
        const rest = recs.filter((r) => !kdBest.includes(r));
        recs = [...kdBest, ...rest].slice(0, 5);
      }
    }
    return recTiersFor(recs.map((r) => r.p.id));
  }, [draftActive, playerDb, taken, league, useRates, nextPick]);

  // ── Filters ───────────────────────────────────────────────
  const [posFilter, setPosFilter] = useState<NflPlayerPosition | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    let rows = ranked;
    if (posFilter !== "ALL") rows = rows.filter((r) => r.p.position === posFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.p.name.toLowerCase().includes(q));
    if (draftActive && hideDrafted) rows = rows.filter((r) => taken[r.p.id] === undefined);
    return rows;
  }, [ranked, posFilter, search, draftActive, hideDrafted, taken]);

  const seasonLabel =
    dataMode === "thisProj" ? `${thisYearId} projections`
    : dataMode === "restProj" ? `${thisYearId} rest of season`
    : dataMode === "thisTotal" ? thisYearId
    : lastYearId;

  // Projection modes gate on the projections fetch; actuals on the stats fetch.
  const activeStatus: DbStatus = isProjMode
    ? (projStatus === "ready" && !projAvailable ? "error" : projStatus)
    : dbStatus;

  const columns = posFilter === "ALL" ? [] : POSITION_COLUMNS[posFilter];
  const avgForPos = posFilter === "ALL" ? undefined : poolAverages.get(posFilter);
  const colCount =
    (draftActive ? 2 : 0) + 6 + (posFilter === "ALL" ? 1 : 0) + columns.length;

  // Marker only renders on the unfiltered list — a filtered or searched view
  // hides players, so "N available players from the top" would be misleading.
  const showMarker = draftActive && nextPick !== null && posFilter === "ALL" && !search.trim();
  const markerBeforeIdx = showMarker && nextPick
    ? computeMarkerIndex(visible.map((r) => taken[r.p.id] !== undefined), nextPick.availableBefore)
    : null;
  const markerRow = showMarker && nextPick
    ? <MarkerRow colCount={colCount} label={nextPick.label} />
    : null;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
        <div />
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-muted)" }}>
          {activeStatus === "ready" && <span>{playerDb.length} players · {seasonLabel}</span>}
          <select
            className="form-input text-xs"
            style={{ paddingTop: "0.25rem", paddingBottom: "0.25rem" }}
            value={dataMode}
            onChange={(e) => setDataMode(e.target.value as DataMode)}
          >
            <option value="lastTotal">Last Year – Total</option>
            <option value="thisTotal" disabled={!hasThisYearData}>
              This Year – Total{!hasThisYearData ? " (season not started)" : ""}
            </option>
            <option value="thisProj" disabled={!projAvailable}>
              This Year – Projected{!projAvailable && projStatus !== "loading" ? " (unavailable)" : ""}
            </option>
            <option value="restProj" disabled={!projAvailable}>
              Rest of Season{!projAvailable && projStatus !== "loading" ? " (unavailable)" : ""}
            </option>
          </select>
        </div>
      </div>

      {/* Staleness warning: projections come from undocumented Sleeper
          endpoints, so a failed or shape-changed fetch serves the stamped
          snapshot instead. */}
      {isProjMode && projections && projections.source !== "sleeper" && (
        <p
          className="text-xs mb-2 rounded-lg border px-3 py-2"
          style={{ borderColor: "#D4843B", color: "#D4843B" }}
        >
          ⚠ Live Sleeper projections are unavailable: showing the saved snapshot
          {projections.source === "fallback" && projections.fallbackGeneratedAt
            ? ` from ${projections.fallbackGeneratedAt}`
            : projections.fetchedAt
              ? ` from ${projections.fetchedAt.slice(0, 10)}`
              : ""}. Values may be stale.
        </p>
      )}

      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
        Ranked by value above replacement (VAR) under {isPro ? "your saved league settings" : "standard league settings"}
        {" "}({league.teams} teams, {league.qbFormat}, {league.pprFormat === "standard" ? "non-PPR" : league.pprFormat === "half" ? "half-PPR" : "full PPR"}).
        {" "}The draftable pool is the top {draftableN} players (teams × roster spots).
        {" "}<span
          className="px-1 rounded"
          style={{ background: "var(--color-success-subtle)", color: "var(--color-success)" }}
        >Highlighted</span> stats beat the draftable-pool average at that position.
        {!isPro && <> Set up your own scoring in the <Link href="/nfl" className="link-primary">analyzer</Link> with a Pro plan.</>}
      </p>

      {/* ── Draft Mode toggle + panel (shared UI) ─────────── */}
      <DraftToggleRow
        isPro={isPro}
        checked={draftActive}
        onChange={setDraftOn}
        proDescription="Track your draft live: check players off the board and get roster-aware pick recommendations under your scoring format."
      />
      {draftActive && (
        <DraftPanel
          unconfiguredWarning={!!nextPick && !nextPick.configured}
          hideDrafted={hideDrafted}
          setHideDrafted={setHideDrafted}
          takenCount={takenCount}
          mineCount={mineCount}
          confirmReset={confirmReset}
          setConfirmReset={setConfirmReset}
          onReset={resetTaken}
        />
      )}

      {/* Tier 2/3: league selector */}
      {isPro && leagues.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>League:</span>
          <select
            className="form-input text-xs max-w-xs"
            style={{ paddingTop: "0.25rem", paddingBottom: "0.25rem" }}
            value={activeLeagueId ?? ""}
            onChange={(e) => setActiveLeagueId(e.target.value)}
          >
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(["ALL", ...NFL_POSITIONS] as const).map((pos) => (
          <button
            key={pos}
            className="px-2.5 py-1 rounded-full border text-xs font-medium transition-colors"
            style={posFilter === pos
              ? { background: "var(--color-primary)", color: "#fff", borderColor: "var(--color-primary)" }
              : { color: "var(--color-muted)", borderColor: "var(--color-border)" }}
            onClick={() => setPosFilter(pos as NflPlayerPosition | "ALL")}
          >
            {pos}
          </button>
        ))}
        <ClearableSearch value={search} onChange={setSearch} placeholder="Search players…" />
      </div>

      {draftActive && nextPick && <DraftConsistencyNotice kind={nextPick.mismatch} />}

      {activeStatus === "loading" && (
        <div className="text-sm" style={{ color: "var(--color-muted)" }}>Loading NFL data…</div>
      )}
      {activeStatus === "error" && (
        <div className="text-sm" style={{ color: "var(--color-danger)" }}>NFL API unavailable — please refresh</div>
      )}

      {activeStatus === "ready" && (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-xs" style={{ color: "var(--color-text)" }}>
            <thead>
              <tr
                className="text-left"
                style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}
              >
                {draftActive && <th className="px-2 py-1.5 font-medium text-center">League</th>}
                {draftActive && <th className="px-2 py-1.5 font-medium text-center">Mine</th>}
                <th className="px-2 py-1.5 font-medium">Rank</th>
                <th className="px-2 py-1.5 font-medium">Player</th>
                {posFilter === "ALL" && <th className="px-2 py-1.5 font-medium">Pos</th>}
                <th className="px-2 py-1.5 font-medium">Team</th>
                <th className="px-2 py-1.5 font-medium text-right">GP</th>
                <th className="px-2 py-1.5 font-medium text-right">Proj Pts</th>
                <th className="px-2 py-1.5 font-medium text-right">VAR</th>
                {columns.map((c) => (
                  <th key={c.key as string} className="px-2 py-1.5 font-medium text-right">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r, rowIdx) => {
                const undraftable = r.rank > draftableN;
                const isTaken = taken[r.p.id];
                // Highlights only apply to unchecked players
                const rec = draftActive && !isTaken ? draftRec?.get(r.p.id) : undefined;
                const recStyle = rec ? REC_STYLES[rec] : undefined;
                return (
                  <React.Fragment key={r.p.id}>
                    {markerBeforeIdx === rowIdx && markerRow}
                  <tr
                    className="border-t"
                    style={{
                      borderColor: "var(--color-border)",
                      opacity: undraftable && !recStyle ? 0.55 : draftActive && isTaken ? 0.45 : 1,
                      background: recStyle?.row,
                    }}
                  >
                    {draftActive && (
                      <DraftCells id={r.p.id} name={r.p.name} taken={taken} setPlayerTaken={setPlayerTaken} />
                    )}
                    <td className="px-2 py-1" style={{ color: "var(--color-muted)" }}>{r.rank}</td>
                    <td className="px-2 py-1 font-medium whitespace-nowrap">
                      {r.p.name}
                      {rec && <RecBadge tier={rec} />}
                    </td>
                    {posFilter === "ALL" && <td className="px-2 py-1">{r.p.position}</td>}
                    <td className="px-2 py-1" style={{ color: "var(--color-muted)" }}>{r.p.team}</td>
                    <td className="px-2 py-1 text-right" style={{ color: "var(--color-muted)" }}>{r.p.gamesPlayed}</td>
                    <td className="px-2 py-1 text-right font-semibold">{r.proj.toFixed(1)}</td>
                    <td className="px-2 py-1 text-right">{r.var_.toFixed(1)}</td>
                    {columns.map((c) => {
                      const raw = r.p.stats[c.key] ?? 0;
                      const value = c.perGame ? raw / Math.max(1, r.p.gamesPlayed) : raw;
                      const avg = avgForPos?.[c.key as string];
                      const better = avg !== undefined && (
                        NEGATIVE_STATS.has(c.key) ? value < avg : value > avg
                      );
                      return (
                        <td
                          key={c.key as string}
                          className="px-2 py-1 text-right"
                          style={better
                            ? { background: "var(--color-success-subtle)", color: "var(--color-success)", fontWeight: 600 }
                            : undefined}
                          title={avg !== undefined ? `Draftable-pool avg: ${avg.toFixed(1)}` : undefined}
                        >
                          {c.perGame ? value.toFixed(1) : Math.round(value)}
                        </td>
                      );
                    })}
                  </tr>
                  </React.Fragment>
                );
              })}
              {markerBeforeIdx === visible.length && markerRow}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] mt-2" style={{ color: "var(--color-muted)" }}>
        Dimmed rows fall outside the draftable pool for your league size. Pick a position
        tab to see per-stat comparisons; hover a highlighted cell for the pool average.
      </p>
    </div>
  );
}
