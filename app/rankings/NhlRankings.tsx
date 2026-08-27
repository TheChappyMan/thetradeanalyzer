"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLeagueContext } from "@/lib/league-context";
import { loadSessionLeague, saveSessionLeague } from "@/lib/session-league";
import { useUser } from "@clerk/nextjs";
import {
  DEFAULT_LEAGUE,
  SKATER_STATS,
  GOALIE_STATS,
  emptyPositionBonuses,
  type League,
  type SkaterStatKey,
  type GoalieStatKey,
} from "@/lib/types";
import {
  buildPlayerDatabase,
  normalizePlayerTo82,
  projectedSeasonValue,
  computePoolStats,
  zScoreValue,
  computeNhlReplacement,
  softReplacementValue,
  type DbPlayer,
} from "@/lib/nhl-valuation";
import { draftRounds, generateDraftPicks, parseDraftPick } from "@/lib/draft";

// ── NHL tab of the /rankings page ────────────────────────────
// Ranks every player under the user's league settings: categories
// leagues rank by positional replacement-adjusted z (the analyzer's
// display basis); points leagues rank by projected points. Highlights
// stats that beat the draftable-pool average at the player's position.

type DataMode  = "thisTotal" | "thisAvg" | "lastTotal" | "lastAvg";
type DbStatus  = "loading" | "ready" | "error";
type LeagueRow = { id: string; name: string; sport: string; settings: unknown };

const LS_DATA_MODE = "fta-data-mode"; // shared with the NHL analyzer

type StatColumn = { key: SkaterStatKey | GoalieStatKey; label: string; neg?: boolean; decimals?: number };

const SKATER_COLUMNS: StatColumn[] = [
  { key: "G", label: "G" }, { key: "A", label: "A" }, { key: "P", label: "P" },
  { key: "PM", label: "+/-" }, { key: "PIM", label: "PIM" }, { key: "PPP", label: "PPP" },
  { key: "SOG", label: "SOG" }, { key: "HIT", label: "HIT" }, { key: "BLK", label: "BLK" },
];
const GOALIE_COLUMNS: StatColumn[] = [
  { key: "W", label: "W" }, { key: "SO", label: "SO" }, { key: "SV", label: "SV" },
  { key: "GA", label: "GA", neg: true },
  { key: "GAA", label: "GAA", neg: true, decimals: 2 },
  { key: "SV%", label: "SV%", decimals: 3 },
];

const POSITIONS = ["C", "LW", "RW", "D", "G"] as const;

// ── Draft Mode recommendation tiers ──────────────────────────
// Fixed brand hexes per the design spec; every color also carries a text
// badge for colorblind accessibility. Amber and orange always use dark text.
const REC_STYLES: Record<1 | 2 | 3, { row: string; badgeBg: string; badgeText: string; label: string }> = {
  1: { row: "rgba(45, 134, 89, 0.16)",  badgeBg: "#2D8659", badgeText: "#FFFFFF", label: "Top pick" },
  2: { row: "rgba(233, 180, 76, 0.16)", badgeBg: "#E9B44C", badgeText: "#1A1A1A", label: "2nd option" },
  3: { row: "rgba(212, 132, 59, 0.16)", badgeBg: "#D4843B", badgeText: "#1A1A1A", label: "3rd option" },
};

// A player at a position the roster already covers is only recommended when
// its value overwhelms the best need-filling option by this factor.
const OVERWHELM = 1.5;

type TakenMap = Record<number, "league" | "mine">;

function mergeLeague(saved: League): League {
  return {
    ...DEFAULT_LEAGUE,
    ...saved,
    roster:           { ...DEFAULT_LEAGUE.roster,           ...saved.roster },
    skaterWeights:    { ...DEFAULT_LEAGUE.skaterWeights,    ...saved.skaterWeights },
    goalieWeights:    { ...DEFAULT_LEAGUE.goalieWeights,    ...saved.goalieWeights },
    skaterCategories: { ...DEFAULT_LEAGUE.skaterCategories, ...saved.skaterCategories },
    goalieCategories: { ...DEFAULT_LEAGUE.goalieCategories, ...saved.goalieCategories },
    positionBonuses:  saved.positionBonuses ?? emptyPositionBonuses(),
  };
}

export default function NhlRankings() {
  const { user, isLoaded: clerkLoaded } = useUser();
  const tier    = (user?.publicMetadata?.tier as string) ?? "free";
  const isPro   = tier === "tier1" || tier === "tier2" || tier === "tier3";
  const { selectedLeagueId: ctxLeagueIds } = useLeagueContext();

  // ── League settings ───────────────────────────────────────
  const [league, setLeague] = useState<League>(DEFAULT_LEAGUE);
  const [leagues, setLeagues] = useState<LeagueRow[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

  useEffect(() => {
    if (!clerkLoaded || !isPro) return;
    let cancelled = false;
    fetch("/api/leagues?sport=nhl")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data: LeagueRow[] } | null) => {
        if (cancelled) return;
        const rows = json?.data ?? [];
        setLeagues(rows);
        const ctxId = ctxLeagueIds["nhl"];
        setActiveLeagueId(rows.find((r) => r.id === ctxId)?.id ?? rows[0]?.id ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clerkLoaded, isPro]); // eslint-disable-line react-hooks/exhaustive-deps

  // Free users: pick up the session-scoped settings configured on the
  // analyzer page (Pro users load their saved leagues above instead).
  useEffect(() => {
    if (!clerkLoaded || isPro) return;
    const saved = loadSessionLeague<League>("nhl");
    if (saved) setLeague(mergeLeague(saved));
  }, [clerkLoaded, isPro]);

  useEffect(() => {
    if (!activeLeagueId) return;
    const row = leagues.find((r) => r.id === activeLeagueId);
    if (row?.settings) setLeague(mergeLeague(row.settings as League));
  }, [activeLeagueId, leagues]);

  // ── Player data ───────────────────────────────────────────
  const [currentSeasonDb, setCurrentSeasonDb] = useState<DbPlayer[]>([]);
  const [priorSeasonDb,   setPriorSeasonDb]   = useState<DbPlayer[]>([]);
  const [currentSeasonId, setCurrentSeasonId] = useState("");
  const [priorSeasonId,   setPriorSeasonId]   = useState("");
  const [dbStatus, setDbStatus] = useState<DbStatus>("loading");
  const [dataMode, setDataMode] = useState<DataMode>(() => {
    try { return (localStorage.getItem(LS_DATA_MODE) as DataMode) || "thisTotal"; }
    catch { return "thisTotal"; }
  });

  useEffect(() => {
    type SeasonPayload = {
      seasonId: string;
      summary: Record<string, unknown>[];
      realtime: Record<string, unknown>[];
      faceoffs: Record<string, unknown>[];
      goalies: Record<string, unknown>[];
    };
    let cancelled = false;
    fetch("/api/nhl?endpoint=all-seasons")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(({ currentSeason, priorSeason }: { currentSeason: SeasonPayload; priorSeason: SeasonPayload }) => {
        if (cancelled) return;
        setCurrentSeasonDb(buildPlayerDatabase(currentSeason));
        setPriorSeasonDb(buildPlayerDatabase(priorSeason));
        setCurrentSeasonId(currentSeason.seasonId);
        setPriorSeasonId(priorSeason.seasonId);
        setDbStatus("ready");
      })
      .catch(() => { if (!cancelled) setDbStatus("error"); });
    return () => { cancelled = true; };
  }, []);

  const playerDb = useMemo(() => {
    const base = (dataMode === "thisTotal" || dataMode === "thisAvg")
      ? currentSeasonDb : priorSeasonDb;
    return (dataMode === "thisAvg" || dataMode === "lastAvg")
      ? base.map(normalizePlayerTo82) : base;
  }, [dataMode, currentSeasonDb, priorSeasonDb]);

  const useRates = dataMode === "thisAvg" || dataMode === "lastAvg";
  const isCatMode = league.scoringType === "categories";

  // ── Value basis (matches the analyzer's display basis) ────
  const poolStats = useMemo(() => {
    if (playerDb.length === 0 || !isCatMode) return null;
    return computePoolStats(playerDb, league.teams, league.roster, SKATER_STATS, GOALIE_STATS, useRates);
  }, [playerDb, isCatMode, league.teams, league.roster, useRates]);

  const replacementZ = useMemo(() => {
    if (!poolStats) return null;
    const zOf = (p: DbPlayer) =>
      zScoreValue(p, league.skaterCategories, league.goalieCategories, poolStats, SKATER_STATS, GOALIE_STATS, useRates);
    return computeNhlReplacement(playerDb, league.teams, league.roster, zOf);
  }, [poolStats, playerDb, league.teams, league.roster, league.skaterCategories, league.goalieCategories, useRates]);

  type Ranked = { p: DbPlayer; value: number; rank: number };

  const ranked: Ranked[] = useMemo(() => {
    const valueOf = (p: DbPlayer): number => {
      if (isCatMode && poolStats && replacementZ) {
        const z = zScoreValue(p, league.skaterCategories, league.goalieCategories, poolStats, SKATER_STATS, GOALIE_STATS, useRates);
        const group = p.isGoalie ? "G" : p.position;
        return softReplacementValue(z - (replacementZ.byPosition[group] ?? 0));
      }
      return projectedSeasonValue(p, league.skaterWeights, league.goalieWeights, useRates, league.positionBonuses);
    };
    return playerDb
      .filter((p) => p.gamesPlayed > 0)
      .map((p) => ({ p, value: valueOf(p), rank: 0 }))
      .sort((a, b) => b.value - a.value)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }, [playerDb, isCatMode, poolStats, replacementZ, league, useRates]);

  // ── Draftable pool + per-position averages ────────────────
  const draftableN = useMemo(() => {
    const r = league.roster;
    const spots = (r.C ?? 0) + (r.LW ?? 0) + (r.RW ?? 0) + (r.W ?? 0) + (r.F ?? 0) +
                  (r.D ?? 0) + (r.U ?? 0) + (r.G ?? 0) + (r.B ?? 0);
    return league.teams * spots;
  }, [league.roster, league.teams]);

  const poolAverages = useMemo(() => {
    const draftable = ranked.slice(0, draftableN);
    const byPos = new Map<string, Record<string, number>>();
    for (const pos of POSITIONS) {
      const members = draftable.filter((r) => (r.p.isGoalie ? "G" : r.p.position) === pos);
      if (members.length === 0) continue;
      const columns = pos === "G" ? GOALIE_COLUMNS : SKATER_COLUMNS;
      const avg: Record<string, number> = {};
      for (const col of columns) {
        const values = members.map((m) => m.p.stats[col.key] ?? 0);
        avg[col.key as string] = values.reduce((a, b) => a + b, 0) / values.length;
      }
      byPos.set(pos, avg);
    }
    return byPos;
  }, [ranked, draftableN]);

  // ── Draft Mode ────────────────────────────────────────────
  // Paid tiers only. Checkbox state is stored per saved league so it
  // survives refreshes; writes happen inside the state updaters so a
  // league switch can never clobber another league's stored draft.
  const [draftOn, setDraftOnState] = useState(false);
  const [taken, setTaken] = useState<TakenMap>({});
  const [hideDrafted, setHideDrafted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const draftKey = `fta-draft-nhl-${activeLeagueId ?? "default"}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      const store = raw ? (JSON.parse(raw) as { on?: boolean; taken?: TakenMap }) : null;
      setTaken(store?.taken ?? {});
      setDraftOnState(!!store?.on);
    } catch {
      setTaken({});
      setDraftOnState(false);
    }
  }, [draftKey]);

  const persistDraft = (on: boolean, takenMap: TakenMap) => {
    try { localStorage.setItem(draftKey, JSON.stringify({ on, taken: takenMap })); } catch {}
  };
  const setDraftOn = (on: boolean) => {
    setDraftOnState(on);
    persistDraft(on, taken);
  };
  const mutateTaken = (updater: (prev: TakenMap) => TakenMap) =>
    setTaken((prev) => {
      const next = updater(prev);
      persistDraft(draftOn, next);
      return next;
    });
  const setPlayerTaken = (id: number, kind: "league" | "mine", checked: boolean) =>
    mutateTaken((prev) => {
      const next = { ...prev };
      if (checked) next[id] = kind;           // checking one side unchecks the other
      else if (next[id] === kind) delete next[id];
      return next;
    });

  const draftActive = draftOn && isPro;
  const takenCount = Object.keys(taken).length;
  const mineCount = Object.values(taken).filter((k) => k === "mine").length;

  // ── Recommendations: recomputed on every checkbox change ──
  // Values come from the SAME engine as the analyzer, but priced against
  // the available pool only, so positional replacement bars shift as
  // players come off the board. "Mine" players fill my roster slots
  // (specific position → narrower flex → U → bench); positions I've fully
  // covered are only recommended on overwhelming value.
  const draftRec = useMemo(() => {
    if (!draftActive || playerDb.length === 0) return null;
    const group = (p: DbPlayer) => (p.isGoalie ? "G" : p.position);
    const available = playerDb.filter((p) => p.gamesPlayed > 0 && taken[p.id] === undefined);
    if (available.length === 0) return null;

    let basis: (p: DbPlayer) => number;
    if (isCatMode) {
      const pool = computePoolStats(available, league.teams, league.roster, SKATER_STATS, GOALIE_STATS, useRates);
      basis = (p) =>
        zScoreValue(p, league.skaterCategories, league.goalieCategories, pool, SKATER_STATS, GOALIE_STATS, useRates);
    } else {
      basis = (p) =>
        projectedSeasonValue(p, league.skaterWeights, league.goalieWeights, useRates, league.positionBonuses);
    }
    const repl = computeNhlReplacement(available, league.teams, league.roster, basis);
    const valueOf = (p: DbPlayer) => softReplacementValue(basis(p) - (repl.byPosition[group(p)] ?? 0));

    // Fill my roster slots with my drafted players, best first.
    const open: Record<string, number> = {
      C: league.roster.C ?? 0, LW: league.roster.LW ?? 0, RW: league.roster.RW ?? 0,
      D: league.roster.D ?? 0, G: league.roster.G ?? 0,
      W: league.roster.W ?? 0, F: league.roster.F ?? 0, U: league.roster.U ?? 0,
      B: league.roster.B ?? 0,
    };
    const slotOrder = (g: string): string[] =>
      g === "G" ? ["G", "B"]
      : g === "D" ? ["D", "U", "B"]
      : g === "C" ? ["C", "F", "U", "B"]
      : [g, "W", "F", "U", "B"]; // LW / RW
    const mine = playerDb
      .filter((p) => taken[p.id] === "mine")
      .sort((a, b) => basis(b) - basis(a));
    for (const p of mine) {
      for (const s of slotOrder(group(p))) {
        if (open[s] > 0) { open[s]--; break; }
      }
    }
    const startersLeft = open.C + open.LW + open.RW + open.D + open.G + open.W + open.F + open.U;
    const fillsNeed = (p: DbPlayer) => {
      if (startersLeft === 0) return true; // only bench spots left — everyone qualifies
      return slotOrder(group(p)).some((s) => s !== "B" && open[s] > 0);
    };

    const scored = available
      .map((p) => ({ p, value: valueOf(p), need: fillsNeed(p) }))
      .sort((a, b) => b.value - a.value);
    const bestNeed = scored.find((s) => s.need)?.value ?? 0;
    const recs = scored.filter((s) => s.need || s.value >= bestNeed * OVERWHELM).slice(0, 5);

    const tiers = new Map<number, 1 | 2 | 3>();
    recs.forEach((r, i) => tiers.set(r.p.id, i === 0 ? 1 : i <= 2 ? 2 : 3));
    return tiers;
  }, [draftActive, playerDb, taken, isCatMode, league, useRates]);

  // ── Next-pick marker ──────────────────────────────────────
  // Picks that happen before my next owned pick = overall − 1 − players
  // already checked; the marker sits after that many available players.
  const nextPick = useMemo(() => {
    if (!draftActive) return null;
    const cfg = league.draftPicks;
    const configured = !!cfg?.picks?.length;
    const teams = (configured ? cfg.teams : league.teams) || league.teams;
    const pickStrs = configured
      ? cfg.picks
      : generateDraftPicks(league.teams, 1, "snake", draftRounds(league.roster)); // placeholder until configured
    const parsed = pickStrs
      .map((s) => parseDraftPick(s, teams))
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => a.overall - b.overall);
    const next = parsed.find((pk) => pk.overall > takenCount);
    if (!next) return null;
    return {
      label: next.raw,
      availableBefore: Math.max(0, next.overall - 1 - takenCount),
      configured,
    };
  }, [draftActive, league.draftPicks, league.teams, league.roster, takenCount]);

  // ── Filters ───────────────────────────────────────────────
  const [posFilter, setPosFilter] = useState<(typeof POSITIONS)[number] | "ALL">("ALL");
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    let rows = ranked;
    if (posFilter !== "ALL") {
      rows = rows.filter((r) => (r.p.isGoalie ? "G" : r.p.position) === posFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.p.name.toLowerCase().includes(q));
    if (draftActive && hideDrafted) rows = rows.filter((r) => taken[r.p.id] === undefined);
    return rows;
  }, [ranked, posFilter, search, draftActive, hideDrafted, taken]);

  const activeSeason = (dataMode === "thisTotal" || dataMode === "thisAvg")
    ? currentSeasonId : priorSeasonId;
  const seasonLabel = activeSeason
    ? `${activeSeason.slice(0, 4)}-${activeSeason.slice(6)}` : "";

  const columns: StatColumn[] =
    posFilter === "ALL" ? [] : posFilter === "G" ? GOALIE_COLUMNS : SKATER_COLUMNS;
  const avgForPos = posFilter === "ALL" ? undefined : poolAverages.get(posFilter);
  const valueLabel = isCatMode ? "Value" : "Proj Pts";
  const colCount =
    (draftActive ? 2 : 0) + 5 + (posFilter === "ALL" ? 1 : 0) + columns.length;

  // Marker only renders on the unfiltered list — a filtered or searched view
  // hides players, so "N available players from the top" would be misleading.
  const showMarker = draftActive && nextPick !== null && posFilter === "ALL" && !search.trim();
  let markerBeforeIdx: number | null = null;
  if (showMarker && nextPick) {
    markerBeforeIdx = visible.length; // fall back to the end of the list
    let availableSeen = 0;
    for (let i = 0; i < visible.length; i++) {
      if (taken[visible[i].p.id] === undefined) {
        if (availableSeen === nextPick.availableBefore) { markerBeforeIdx = i; break; }
        availableSeen++;
      }
    }
  }
  const markerRow = showMarker && nextPick && (
    <tr key="next-pick-marker">
      <td colSpan={colCount} className="px-2 py-1">
        <div
          className="flex items-center gap-2 text-xs font-semibold whitespace-nowrap"
          style={{ color: "var(--color-primary)" }}
        >
          <span className="flex-1 border-t-2" style={{ borderColor: "var(--color-primary)" }} />
          Your next pick: {nextPick.label}
          <span className="flex-1 border-t-2" style={{ borderColor: "var(--color-primary)" }} />
        </div>
      </td>
    </tr>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
        <div />
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--color-muted)" }}>
          {dbStatus === "ready" && <span>{playerDb.length} players · Season {seasonLabel}</span>}
          <select
            className="form-input text-xs"
            style={{ paddingTop: "0.25rem", paddingBottom: "0.25rem" }}
            value={dataMode}
            onChange={(e) => {
              const m = e.target.value as DataMode;
              setDataMode(m);
              try { localStorage.setItem(LS_DATA_MODE, m); } catch {}
            }}
          >
            <option value="thisTotal">This Year – Total</option>
            <option value="thisAvg">This Year – Per-Game Proj.</option>
            <option value="lastTotal">Last Year – Total</option>
            <option value="lastAvg">Last Year – Per-Game Proj.</option>
          </select>
        </div>
      </div>

      <p className="text-xs mb-3" style={{ color: "var(--color-muted)" }}>
        Ranked by {isCatMode ? "category value (replacement-adjusted z-score)" : "projected points"} under
        {" "}{isPro ? "your saved league settings" : "standard league settings"}
        {" "}({league.teams} teams, {isCatMode ? "categories" : "points"}).
        {" "}The draftable pool is the top {draftableN} players (teams × roster spots).
        {" "}<span
          className="px-1 rounded"
          style={{ background: "var(--color-success-subtle)", color: "var(--color-success)" }}
        >Highlighted</span> stats beat the draftable-pool average at that position.
        {!isPro && <> Configure scoring in the <Link href="/nhl" className="link-primary">analyzer</Link> with a Pro plan.</>}
      </p>

      {/* ── Draft Mode toggle ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <label
          className={`flex items-center gap-2 text-sm font-medium ${isPro ? "cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
          style={{ color: "var(--color-text)" }}
        >
          <input
            type="checkbox"
            disabled={!isPro}
            checked={draftActive}
            onChange={(e) => setDraftOn(e.target.checked)}
          />
          Turn on Draft Mode
          {!isPro && <span aria-hidden>🔒</span>}
        </label>
        <span className="text-xs" style={{ color: "var(--color-muted)" }}>
          {isPro ? (
            "Track your draft live — check players off the board and get roster-aware pick recommendations."
          ) : (
            <>
              Draft Mode is a paid feature —{" "}
              <a href="https://thetradeanalyzer.com/pricing/" className="link-primary">
                upgrade to unlock it
              </a>.
            </>
          )}
        </span>
      </div>

      {/* ── Draft Mode instructions + controls ────────────── */}
      {draftActive && (
        <div
          className="rounded-xl border px-4 py-3 mb-3 text-xs"
          style={{ borderColor: "var(--color-primary)", background: "var(--color-surface)", color: "var(--color-muted)" }}
        >
          <p className="font-semibold mb-1" style={{ color: "var(--color-text)" }}>
            How Draft Mode works
          </p>
          <ul className="list-disc ml-4 space-y-0.5">
            <li>Check <span className="font-semibold">League</span> when another manager drafts a player.</li>
            <li>Check <span className="font-semibold">Mine</span> when you draft a player.</li>
            <li>Keepers get checked the same way before the draft starts.</li>
            <li>The colored highlights show your recommended picks — green is the top pick, amber and orange are ranked fallbacks likely to still be available later.</li>
          </ul>
          {nextPick && !nextPick.configured && (
            <p className="mt-2" style={{ color: "#D4843B" }}>
              No draft picks configured for this league — using slot 1 (snake) as a placeholder.
              Set your picks under Draft Picks in <Link href="/settings" className="link-primary">Settings</Link>.
            </p>
          )}
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 pt-2 border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ color: "var(--color-text)" }}>
              <input
                type="checkbox"
                checked={hideDrafted}
                onChange={(e) => setHideDrafted(e.target.checked)}
              />
              Hide drafted players
            </label>
            <span>{takenCount} drafted · {mineCount} mine</span>
            {confirmReset ? (
              <span className="flex items-center gap-2">
                Clear all checkboxes?
                <button
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-90"
                  style={{ background: "var(--color-danger)", color: "#fff" }}
                  onClick={() => { mutateTaken(() => ({})); setConfirmReset(false); }}
                >
                  Yes, uncheck all
                </button>
                <button
                  className="rounded-lg border px-2.5 py-1 text-xs font-medium"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className="rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors"
                style={{ borderColor: "var(--color-danger)", color: "var(--color-danger)" }}
                onClick={() => setConfirmReset(true)}
              >
                Reset draft — uncheck all
              </button>
            )}
          </div>
        </div>
      )}

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

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(["ALL", ...POSITIONS] as const).map((pos) => (
          <button
            key={pos}
            className="px-2.5 py-1 rounded-full border text-xs font-medium transition-colors"
            style={posFilter === pos
              ? { background: "var(--color-primary)", color: "#fff", borderColor: "var(--color-primary)" }
              : { color: "var(--color-muted)", borderColor: "var(--color-border)" }}
            onClick={() => setPosFilter(pos)}
          >
            {pos}
          </button>
        ))}
        <input
          type="text"
          className="form-input text-xs ml-auto"
          style={{ maxWidth: "14rem", paddingTop: "0.25rem", paddingBottom: "0.25rem" }}
          placeholder="Search players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {dbStatus === "loading" && (
        <div className="text-sm" style={{ color: "var(--color-muted)" }}>Loading NHL data…</div>
      )}
      {dbStatus === "error" && (
        <div className="text-sm" style={{ color: "var(--color-danger)" }}>NHL API unavailable — please refresh</div>
      )}

      {dbStatus === "ready" && (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--color-border)" }}>
          <table className="w-full text-xs" style={{ color: "var(--color-text)" }}>
            <thead>
              <tr className="text-left" style={{ background: "var(--color-surface)", color: "var(--color-muted)" }}>
                {draftActive && <th className="px-2 py-1.5 font-medium text-center">League</th>}
                {draftActive && <th className="px-2 py-1.5 font-medium text-center">Mine</th>}
                <th className="px-2 py-1.5 font-medium">Rank</th>
                <th className="px-2 py-1.5 font-medium">Player</th>
                {posFilter === "ALL" && <th className="px-2 py-1.5 font-medium">Pos</th>}
                <th className="px-2 py-1.5 font-medium">Team</th>
                <th className="px-2 py-1.5 font-medium text-right">GP</th>
                <th className="px-2 py-1.5 font-medium text-right">{valueLabel}</th>
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
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={isTaken === "league"}
                          onChange={(e) => setPlayerTaken(r.p.id, "league", e.target.checked)}
                          aria-label={`${r.p.name} drafted by another team`}
                        />
                      </td>
                    )}
                    {draftActive && (
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={isTaken === "mine"}
                          onChange={(e) => setPlayerTaken(r.p.id, "mine", e.target.checked)}
                          aria-label={`${r.p.name} on my roster`}
                        />
                      </td>
                    )}
                    <td className="px-2 py-1" style={{ color: "var(--color-muted)" }}>{r.rank}</td>
                    <td className="px-2 py-1 font-medium whitespace-nowrap">
                      {r.p.name}
                      {recStyle && (
                        <span
                          className="ml-1.5 rounded px-1 py-0.5 text-[10px] font-semibold align-middle whitespace-nowrap"
                          style={{ background: recStyle.badgeBg, color: recStyle.badgeText }}
                        >
                          {recStyle.label}
                        </span>
                      )}
                    </td>
                    {posFilter === "ALL" && <td className="px-2 py-1">{r.p.isGoalie ? "G" : r.p.position}</td>}
                    <td className="px-2 py-1" style={{ color: "var(--color-muted)" }}>{r.p.team}</td>
                    <td className="px-2 py-1 text-right" style={{ color: "var(--color-muted)" }}>{r.p.gamesPlayed}</td>
                    <td className="px-2 py-1 text-right font-semibold">{r.value.toFixed(isCatMode ? 2 : 1)}</td>
                    {columns.map((c) => {
                      const value = r.p.stats[c.key] ?? 0;
                      const avg = avgForPos?.[c.key as string];
                      const better = avg !== undefined && (c.neg ? value < avg : value > avg);
                      return (
                        <td
                          key={c.key as string}
                          className="px-2 py-1 text-right"
                          style={better
                            ? { background: "var(--color-success-subtle)", color: "var(--color-success)", fontWeight: 600 }
                            : undefined}
                          title={avg !== undefined ? `Draftable-pool avg: ${avg.toFixed(c.decimals ?? 1)}` : undefined}
                        >
                          {c.decimals !== undefined ? value.toFixed(c.decimals) : Math.round(value)}
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
