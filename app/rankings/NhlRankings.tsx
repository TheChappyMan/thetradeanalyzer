"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  const isTier2 = tier === "tier2" || tier === "tier3";

  // ── League settings ───────────────────────────────────────
  const [league, setLeague] = useState<League>(DEFAULT_LEAGUE);
  const [t2Leagues, setT2Leagues] = useState<LeagueRow[]>([]);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

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
          setActiveLeagueId(rows[0]?.id ?? null);
        } else if (rows[0]?.settings) {
          setLeague(mergeLeague(rows[0].settings as League));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [clerkLoaded, isPro, isTier2]);

  useEffect(() => {
    if (!isTier2 || !activeLeagueId) return;
    const row = t2Leagues.find((r) => r.id === activeLeagueId);
    if (row?.settings) setLeague(mergeLeague(row.settings as League));
  }, [isTier2, activeLeagueId, t2Leagues]);

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
    return rows;
  }, [ranked, posFilter, search]);

  const activeSeason = (dataMode === "thisTotal" || dataMode === "thisAvg")
    ? currentSeasonId : priorSeasonId;
  const seasonLabel = activeSeason
    ? `${activeSeason.slice(0, 4)}-${activeSeason.slice(6)}` : "";

  const columns: StatColumn[] =
    posFilter === "ALL" ? [] : posFilter === "G" ? GOALIE_COLUMNS : SKATER_COLUMNS;
  const avgForPos = posFilter === "ALL" ? undefined : poolAverages.get(posFilter);
  const valueLabel = isCatMode ? "Value" : "Proj Pts";

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

      {isTier2 && t2Leagues.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs" style={{ color: "var(--color-muted)" }}>League:</span>
          <select
            className="form-input text-xs max-w-xs"
            style={{ paddingTop: "0.25rem", paddingBottom: "0.25rem" }}
            value={activeLeagueId ?? ""}
            onChange={(e) => setActiveLeagueId(e.target.value)}
          >
            {t2Leagues.map((l) => (
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
              {visible.map((r) => {
                const undraftable = r.rank > draftableN;
                return (
                  <tr
                    key={r.p.id}
                    className="border-t"
                    style={{ borderColor: "var(--color-border)", opacity: undraftable ? 0.55 : 1 }}
                  >
                    <td className="px-2 py-1" style={{ color: "var(--color-muted)" }}>{r.rank}</td>
                    <td className="px-2 py-1 font-medium whitespace-nowrap">{r.p.name}</td>
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
                );
              })}
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
